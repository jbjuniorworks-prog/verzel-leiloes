import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogItemDTO } from '@leilao/shared';
import { prisma } from '../src/lib/prisma';
import { ensureItemSnapshot, searchCatalog } from '../src/modules/catalog/catalog.service';
import { CircuitBreaker, CircuitOpenError } from '../src/modules/catalog/circuit-breaker';
import { scryfall } from '../src/modules/catalog/scryfall';
import { rejectionCode, resetDatabase } from './helpers';

// Nos testes a API externa aponta para uma porta fechada (vitest.config.ts):
// tudo aqui roda como se o Scryfall estivesse fora do ar.

const item = (title: string): CatalogItemDTO => ({
  source: 'scryfall',
  externalId: crypto.randomUUID(),
  title,
  subtitle: 'Alpha · #1',
  description: null,
  category: 'Rara',
  attributes: [],
  imageUrl: null,
  externalUrl: null,
  referencePriceUsdCents: null,
});

describe('API externa fora do ar', () => {
  beforeEach(async () => {
    await resetDatabase();
    scryfall.breaker.reset();
  });

  it('busca cai para o último resultado salvo da mesma busca', async () => {
    const cached = { items: [item('Black Lotus')], hasMore: false, total: 1 };
    await prisma.catalogSearchCache.create({
      data: { key: 'scryfall:black lotus:1', response: cached as object, fetchedAt: new Date(Date.now() - 24 * 60 * 60_000) },
    });
    const result = await searchCatalog('Black Lotus', 1);
    expect(result.source).toBe('cache');
    expect(result.items[0]!.title).toBe('Black Lotus');
    expect(result.notice).toMatch(/instável/);
  });

  it('sem cache da busca, procura entre itens já vistos', async () => {
    const known = item('Shivan Dragon');
    await prisma.catalogItemCache.create({ data: { source: 'scryfall', externalId: known.externalId, data: known as object, fetchedAt: new Date() } });
    const result = await searchCatalog('shivan', 1);
    expect(result).toMatchObject({ source: 'cache', items: [{ title: 'Shivan Dragon' }] });
  });

  it('sem nada em cache, responde 503 com mensagem clara', async () => {
    expect(await rejectionCode(searchCatalog('qualquer coisa', 1))).toBe('CATALOG_UNAVAILABLE');
  });

  it('cria o snapshot do item a partir do cache, sem a API', async () => {
    const known = item('Time Walk');
    await prisma.catalogItemCache.create({ data: { source: 'scryfall', externalId: known.externalId, data: known as object, fetchedAt: new Date() } });
    const snapshot = await ensureItemSnapshot(known.externalId);
    expect(snapshot.title).toBe('Time Walk');
  });

  it('depois de falhas seguidas o circuito abre e para de chamar a API', async () => {
    for (let i = 0; i < 3; i++) await rejectionCode(searchCatalog(`busca ${i}`, 1));
    expect(scryfall.breaker.state).toBe('open');
    const started = Date.now();
    expect(await rejectionCode(searchCatalog('outra busca', 1))).toBe('CATALOG_UNAVAILABLE');
    expect(Date.now() - started).toBeLessThan(500); // nem tentou: resposta imediata
  });
});

describe('CircuitBreaker', () => {
  it('ignora erros que não indicam API doente', async () => {
    const breaker = new CircuitBreaker(1, 1_000);
    await expect(
      breaker.run(
        () => Promise.reject(new TypeError('busca inválida')),
        () => false,
      ),
    ).rejects.toThrow(TypeError);
    expect(breaker.state).toBe('closed');
    await expect(breaker.run(() => Promise.reject(new Error('timeout')))).rejects.toThrow('timeout');
    expect(breaker.state).toBe('open');
    await expect(breaker.run(() => Promise.resolve(1))).rejects.toBeInstanceOf(CircuitOpenError);
  });
});
