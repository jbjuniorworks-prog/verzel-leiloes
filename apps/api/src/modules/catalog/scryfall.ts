import type { CatalogItemDTO, ItemAttribute } from '@leilao/shared';
import { env } from '../../config/env';
import { CircuitBreaker } from './circuit-breaker';

// Documentação: https://scryfall.com/docs/api — pede User-Agent/Accept explícitos
// e no máximo ~10 requisições por segundo (50–100 ms entre chamadas).
const HEADERS = { 'User-Agent': 'MarteloLeiloes/1.0 (teste tecnico Verzel)', Accept: 'application/json' };
const MIN_INTERVAL_MS = 100;
const TIMEOUT_MS = 6_000;
const MAX_ATTEMPTS = 3;

export class ExternalApiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ExternalApiError';
  }
}

/** Busca inválida do usuário (ex.: sintaxe errada) — não conta como falha da API. */
export class InvalidQueryError extends Error {}

interface ScryfallImageUris {
  small?: string;
  normal?: string;
  large?: string;
}

interface ScryfallCard {
  id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  type_line?: string;
  mana_cost?: string;
  oracle_text?: string;
  artist?: string;
  released_at?: string;
  lang?: string;
  finishes?: string[];
  scryfall_uri?: string;
  image_uris?: ScryfallImageUris;
  card_faces?: Array<{ image_uris?: ScryfallImageUris; oracle_text?: string; mana_cost?: string }>;
  prices?: { usd?: string | null; usd_foil?: string | null };
}

interface ScryfallList {
  data: ScryfallCard[];
  has_more: boolean;
  total_cards?: number;
}

const RARITY: Record<string, string> = {
  common: 'Comum',
  uncommon: 'Incomum',
  rare: 'Rara',
  mythic: 'Mítica',
  special: 'Especial',
  bonus: 'Bônus',
};

const FINISH: Record<string, string> = { nonfoil: 'Normal', foil: 'Foil', etched: 'Etched', glossy: 'Glossy' };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function usdToCents(value: string | null | undefined): number | null {
  if (!value) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isFinite(cents) ? cents : null;
}

export function normalizeCard(card: ScryfallCard): CatalogItemDTO {
  const face = card.card_faces?.[0];
  const images = card.image_uris ?? face?.image_uris;
  const rarity = RARITY[card.rarity] ?? card.rarity;
  const usd = usdToCents(card.prices?.usd ?? card.prices?.usd_foil);
  const oracle =
    card.oracle_text ??
    card.card_faces
      ?.map((f) => f.oracle_text)
      .filter(Boolean)
      .join('\n//\n');

  const attributes: ItemAttribute[] = [
    { label: 'Coleção', value: `${card.set_name} (${card.set.toUpperCase()})` },
    { label: 'Número', value: card.collector_number },
    { label: 'Raridade', value: rarity },
  ];
  if (card.type_line) attributes.push({ label: 'Tipo', value: card.type_line });
  const manaCost = card.mana_cost ?? face?.mana_cost;
  if (manaCost) attributes.push({ label: 'Custo de mana', value: manaCost });
  if (card.artist) attributes.push({ label: 'Artista', value: card.artist });
  if (card.released_at) attributes.push({ label: 'Lançamento', value: card.released_at.split('-').reverse().join('/') });
  if (card.finishes?.length) attributes.push({ label: 'Acabamento', value: card.finishes.map((f) => FINISH[f] ?? f).join(', ') });
  if (card.lang) attributes.push({ label: 'Idioma', value: card.lang.toUpperCase() });
  if (usd !== null) {
    attributes.push({ label: 'Referência de mercado', value: `US$ ${(usd / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` });
  }

  return {
    source: 'scryfall',
    externalId: card.id,
    title: card.name,
    subtitle: `${card.set_name} · #${card.collector_number}`,
    description: oracle || null,
    category: rarity,
    attributes,
    imageUrl: images?.normal ?? images?.large ?? images?.small ?? null,
    externalUrl: card.scryfall_uri?.split('?')[0] ?? null,
    referencePriceUsdCents: usd,
  };
}

class ScryfallClient {
  readonly breaker = new CircuitBreaker(3, 30_000);
  private nextSlot = 0;

  /** Fila simples: garante o intervalo mínimo entre chamadas, mesmo concorrentes. */
  private async throttle() {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + MIN_INTERVAL_MS;
    if (slot > now) await sleep(slot - now);
  }

  /** GET com timeout e retry com backoff exponencial + jitter (respeita Retry-After). */
  private async get<T>(path: string, { notFoundAsNull = false } = {}): Promise<T | null> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(250 * 2 ** attempt + Math.random() * 200);
      await this.throttle();
      try {
        const response = await fetch(`${env.SCRYFALL_BASE_URL}${path}`, {
          headers: HEADERS,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (response.status === 404 && notFoundAsNull) return null;
        if (response.status === 400 || response.status === 422) {
          const body = (await response.json().catch(() => null)) as { details?: string } | null;
          throw new InvalidQueryError(body?.details ?? 'Busca inválida.');
        }
        if (response.status === 429 || response.status >= 500) {
          const retryAfter = Number(response.headers.get('retry-after'));
          if (retryAfter > 0) await sleep(Math.min(retryAfter, 5) * 1000);
          lastError = new ExternalApiError(`Scryfall respondeu ${response.status}`, true, response.status);
          continue;
        }
        if (!response.ok) throw new ExternalApiError(`Scryfall respondeu ${response.status}`, false, response.status);
        return (await response.json()) as T;
      } catch (error) {
        if (error instanceof InvalidQueryError) throw error;
        if (error instanceof ExternalApiError && !error.retryable) throw error;
        lastError = error; // timeout, DNS, conexão recusada...
      }
    }
    throw lastError instanceof Error ? lastError : new ExternalApiError('Falha ao consultar o Scryfall', true);
  }

  /**
   * Busca impressões (unique=prints) ordenadas pelo valor de mercado: as cartas mais
   * valiosas, que são as que fazem sentido leiloar, aparecem primeiro.
   */
  async search(query: string, page: number) {
    const params = new URLSearchParams({
      q: `${query} game:paper`,
      unique: 'prints',
      order: 'usd',
      dir: 'desc',
      page: String(page),
    });
    // InvalidQueryError não abre o circuito: a API respondeu, a busca é que era ruim.
    const list = await this.breaker.run(
      () => this.get<ScryfallList>(`/cards/search?${params}`, { notFoundAsNull: true }),
      (error) => !(error instanceof InvalidQueryError),
    );
    if (!list) return { items: [], hasMore: false, total: 0 };
    return { items: list.data.map(normalizeCard), hasMore: list.has_more, total: list.total_cards ?? list.data.length };
  }

  async getCard(id: string): Promise<CatalogItemDTO | null> {
    const card = await this.breaker.run(() => this.get<ScryfallCard>(`/cards/${encodeURIComponent(id)}`, { notFoundAsNull: true }));
    return card ? normalizeCard(card) : null;
  }

  /** Baixa a imagem para guardar no banco. Falha aqui não impede criar o lote. */
  async downloadImage(url: string): Promise<{ data: Uint8Array<ArrayBuffer>; mime: string } | null> {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] }, signal: AbortSignal.timeout(10_000) });
      const mime = response.headers.get('content-type') ?? '';
      if (!response.ok || !mime.startsWith('image/')) return null;
      const data = new Uint8Array(await response.arrayBuffer());
      return data.length > 0 && data.length <= 5 * 1024 * 1024 ? { data, mime } : null;
    } catch {
      return null;
    }
  }
}

export const scryfall = new ScryfallClient();
