import type { CatalogItemDTO, CatalogSearchDTO } from '@leilao/shared';
import { badRequest, notFound, serviceUnavailable } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { InvalidQueryError, scryfall } from './scryfall';

const SOURCE = 'scryfall';
/** Dentro dessa janela a busca é respondida do cache sem chamar a API (economiza cota). */
const FRESH_CACHE_MS = 10 * 60 * 1000;

type StoredSearch = Pick<CatalogSearchDTO, 'items' | 'hasMore' | 'total'>;

const formatDate = (date: Date) => date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

async function saveSearch(key: string, result: StoredSearch) {
  const fetchedAt = new Date();
  const ids = result.items.map((item) => item.externalId);
  try {
    await prisma.$transaction([
      prisma.catalogSearchCache.upsert({
        where: { key },
        create: { key, response: result as object, fetchedAt },
        update: { response: result as object, fetchedAt },
      }),
      prisma.catalogItemCache.deleteMany({ where: { source: SOURCE, externalId: { in: ids } } }),
      prisma.catalogItemCache.createMany({
        data: result.items.map((item) => ({ source: SOURCE, externalId: item.externalId, data: item as object, fetchedAt })),
      }),
    ]);
  } catch (error) {
    // Falha ao gravar cache não pode derrubar uma busca que deu certo.
    logger.warn('Falha ao salvar cache do catálogo', error);
  }
}

async function searchKnownItems(query: string): Promise<CatalogItemDTO[]> {
  const pattern = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const rows = await prisma.$queryRaw<Array<{ data: CatalogItemDTO }>>`
    SELECT data FROM catalog_item_cache
    WHERE data->>'title' ILIKE ${pattern}
    ORDER BY fetched_at DESC
    LIMIT 60`;
  return rows.map((row) => row.data);
}

/**
 * Busca com degradação graciosa:
 *  1. cache fresco (< 10 min) → responde sem chamar a API;
 *  2. API (com retry, timeout e circuit breaker);
 *  3. API falhou → cache antigo da mesma busca;
 *  4. sem cache da busca → itens já vistos com título parecido;
 *  5. nada disso → 503 com mensagem clara (o resto do sistema segue normal).
 */
export async function searchCatalog(rawQuery: string, page: number): Promise<CatalogSearchDTO> {
  const query = rawQuery.trim().replace(/\s+/g, ' ');
  if (query.length < 2) throw badRequest('QUERY_TOO_SHORT', 'Digite pelo menos 2 caracteres para buscar.');

  const key = `${SOURCE}:${query.toLowerCase()}:${page}`;
  const cached = await prisma.catalogSearchCache.findUnique({ where: { key } });
  if (cached && Date.now() - cached.fetchedAt.getTime() < FRESH_CACHE_MS) {
    return { ...(cached.response as unknown as StoredSearch), page, source: 'live', notice: null };
  }

  try {
    const result = await scryfall.search(query, page);
    await saveSearch(key, result);
    return { ...result, page, source: 'live', notice: null };
  } catch (error) {
    if (error instanceof InvalidQueryError) throw badRequest('INVALID_QUERY', `Busca inválida: ${error.message}`);
    logger.warn(`Scryfall indisponível (circuito: ${scryfall.breaker.state})`, error instanceof Error ? error.message : error);

    if (cached) {
      return {
        ...(cached.response as unknown as StoredSearch),
        page,
        source: 'cache',
        notice: `A API de cartas está instável. Mostrando o resultado salvo em ${formatDate(cached.fetchedAt)}.`,
      };
    }
    const known = await searchKnownItems(query);
    if (known.length > 0) {
      return {
        items: known,
        page: 1,
        hasMore: false,
        total: known.length,
        source: 'cache',
        notice: 'A API de cartas está instável. Mostrando cartas já consultadas antes que combinam com a busca.',
      };
    }
    throw serviceUnavailable(
      'CATALOG_UNAVAILABLE',
      'A API de cartas está fora do ar e não há resultados salvos para essa busca. Vitrine, lances e auditoria continuam funcionando; tente buscar de novo em instantes.',
    );
  }
}

/** Grava a cópia definitiva do item (dados + imagem) que o lote vai usar para sempre. */
export async function snapshotItem(item: CatalogItemDTO, raw: object | null = null) {
  const image = item.imageUrl ? await scryfall.downloadImage(item.imageUrl) : null;
  return prisma.catalogItem.upsert({
    where: { source_externalId: { source: item.source, externalId: item.externalId } },
    update: {},
    create: {
      source: item.source,
      externalId: item.externalId,
      title: item.title,
      subtitle: item.subtitle,
      description: item.description,
      category: item.category,
      attributes: item.attributes as object[],
      externalUrl: item.externalUrl,
      imageUrl: item.imageUrl,
      imageData: image?.data ?? null,
      imageMime: image?.mime ?? null,
      referencePriceUsdCents: item.referencePriceUsdCents,
      raw: raw ?? undefined,
      fetchedAt: new Date(),
    },
    select: { id: true, title: true, externalId: true },
  });
}

/** Item para um novo lote: snapshot existente → API → cache de buscas. */
export async function ensureItemSnapshot(externalId: string) {
  const existing = await prisma.catalogItem.findUnique({
    where: { source_externalId: { source: SOURCE, externalId } },
    select: { id: true, title: true, externalId: true },
  });
  if (existing) return existing;

  let item: CatalogItemDTO | null = null;
  let apiFailed = false;
  try {
    item = await scryfall.getCard(externalId);
  } catch (error) {
    apiFailed = true;
    logger.warn('Scryfall indisponível ao buscar item; tentando cache', error instanceof Error ? error.message : error);
  }
  if (!item) {
    const cached = await prisma.catalogItemCache.findUnique({ where: { source_externalId: { source: SOURCE, externalId } } });
    item = (cached?.data as unknown as CatalogItemDTO | undefined) ?? null;
  }
  if (!item) {
    if (apiFailed) {
      throw serviceUnavailable('CATALOG_UNAVAILABLE', 'A API de cartas está fora do ar e este item não está no cache. Tente de novo em instantes.');
    }
    throw notFound('Item não encontrado na API de cartas.');
  }
  return snapshotItem(item);
}

export const catalogHealth = () => ({ source: SOURCE, circuit: scryfall.breaker.state });
