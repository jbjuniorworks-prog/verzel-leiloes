import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { placeBid } from '../src/modules/bids/bids.service';
import { cancelLot } from '../src/modules/lots/lots.service';
import { at, createTestLot, createUser, rejectionCode, resetDatabase, wallet } from './helpers';

const bid = (lotId: string, bidderId: string, reais: number, minute = 0) => placeBid({ lotId, bidderId, amountCents: reais * 100, now: at(minute) });

describe('regras de lance', () => {
  let seller: Awaited<ReturnType<typeof createUser>>;
  let ana: Awaited<ReturnType<typeof createUser>>;
  let bruno: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    await resetDatabase();
    seller = await createUser('AUCTIONEER');
    ana = await createUser('BIDDER', 1_000);
    bruno = await createUser('BIDDER', 1_000);
  });

  it('primeiro lance ≥ lance inicial; seguintes ≥ atual + incremento', async () => {
    const lot = await createTestLot(seller.id, { startingReais: 100, incrementReais: 10 });
    expect(await rejectionCode(bid(lot.id, ana.id, 99))).toBe('BELOW_MINIMUM');
    await bid(lot.id, ana.id, 100);
    expect(await rejectionCode(bid(lot.id, bruno.id, 109))).toBe('BELOW_MINIMUM');
    await bid(lot.id, bruno.id, 110);

    const updated = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(updated.currentPriceCents).toBe(11_000n);
    expect(updated.leaderId).toBe(bruno.id);
    expect(updated.bidCount).toBe(2);
  });

  it('o líder não pode cobrir o próprio lance', async () => {
    const lot = await createTestLot(seller.id);
    await bid(lot.id, ana.id, 100);
    expect(await rejectionCode(bid(lot.id, ana.id, 200))).toBe('ALREADY_WINNING');
  });

  it('só aceita lances com o lote ao vivo', async () => {
    const scheduled = await createTestLot(seller.id, { start: 10, end: 60, createdAt: 0 });
    expect(await rejectionCode(bid(scheduled.id, ana.id, 100, 5))).toBe('LOT_NOT_STARTED');

    const live = await createTestLot(seller.id, { start: -60, end: 30 });
    expect(await rejectionCode(bid(live.id, ana.id, 100, 30))).toBe('LOT_ENDED');
    expect(await rejectionCode(bid(live.id, ana.id, 100, 31))).toBe('LOT_ENDED');

    await cancelLot(seller.id, live.id, null, at(0));
    expect(await rejectionCode(bid(live.id, ana.id, 100, 1))).toBe('LOT_CANCELLED');
  });

  it('compromete o valor do líder e devolve na hora quando ele é superado', async () => {
    const lot = await createTestLot(seller.id);
    await bid(lot.id, ana.id, 300);
    expect(await wallet(ana.id)).toEqual({ balance: 1_000, committed: 300, available: 700 });

    await bid(lot.id, bruno.id, 310);
    expect(await wallet(ana.id)).toEqual({ balance: 1_000, committed: 0, available: 1_000 });
    expect(await wallet(bruno.id)).toEqual({ balance: 1_000, committed: 310, available: 690 });
  });

  it('o lance só é aceito se couber no saldo disponível (considerando outros lotes)', async () => {
    const lotA = await createTestLot(seller.id);
    const lotB = await createTestLot(seller.id);
    await bid(lotA.id, ana.id, 700);
    expect(await rejectionCode(bid(lotB.id, ana.id, 301))).toBe('INSUFFICIENT_FUNDS');
    await bid(lotB.id, ana.id, 300);
    expect(await wallet(ana.id)).toMatchObject({ committed: 1_000, available: 0 });
  });

  it('lance recusado não altera nada (nem carteira, nem cadeia)', async () => {
    const lot = await createTestLot(seller.id);
    await bid(lot.id, ana.id, 100);
    const before = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
    await rejectionCode(bid(lot.id, bruno.id, 5_000));
    const after = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(after.chainLength).toBe(before.chainLength);
    expect(after.currentPriceCents).toBe(before.currentPriceCents);
    expect(await wallet(bruno.id)).toMatchObject({ committed: 0 });
  });

  it('anti-sniping: lance nos últimos 2 minutos estende o fim para 2 minutos após o lance', async () => {
    const lot = await createTestLot(seller.id, { start: -60, end: 10 });
    await bid(lot.id, ana.id, 100, 5); // faltam 5 min: sem prorrogação
    expect((await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).endsAt).toEqual(at(10));

    const result = await bid(lot.id, bruno.id, 110, 9); // falta 1 min
    expect(result.bid.extendedEndsAt).toBe(at(11).toISOString());
    const extended = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(extended.endsAt).toEqual(at(11));
    expect(extended.originalEndsAt).toEqual(at(10));
    expect(extended.extensionCount).toBe(1);

    // Depois do fim original o lote continua aceitando lances, porque foi prorrogado.
    await bid(lot.id, ana.id, 120, 10.5);
    expect((await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).endsAt).toEqual(at(12.5));
  });

  it('leiloeiro não dá lance (nem chamando o serviço direto)', async () => {
    const lot = await createTestLot(seller.id);
    expect(await rejectionCode(bid(lot.id, seller.id, 100))).toBe('ROLE_NOT_ALLOWED');
  });
});

describe('concorrência', () => {
  beforeEach(resetDatabase);

  it('lances simultâneos no mesmo lote: só um vence a corrida pelo mesmo valor', async () => {
    const seller = await createUser('AUCTIONEER');
    const bidders = await Promise.all(Array.from({ length: 8 }, () => createUser('BIDDER', 1_000)));
    const lot = await createTestLot(seller.id, { startingReais: 100 });

    const results = await Promise.all(bidders.map((b) => rejectionCode(bid(lot.id, b.id, 100))));
    expect(results.filter((r) => r === 'ACCEPTED')).toHaveLength(1);
    expect(results.filter((r) => r === 'BELOW_MINIMUM')).toHaveLength(7);

    const committed = await prisma.wallet.aggregate({ _sum: { committedCents: true } });
    expect(committed._sum.committedCents).toBe(10_000n);
  });

  it('lances crescentes simultâneos terminam com estado coerente', async () => {
    const seller = await createUser('AUCTIONEER');
    const bidders = await Promise.all(Array.from({ length: 6 }, () => createUser('BIDDER', 5_000)));
    const lot = await createTestLot(seller.id, { startingReais: 100, incrementReais: 10 });

    await Promise.all(bidders.map((b, i) => rejectionCode(bid(lot.id, b.id, 100 + i * 50))));
    const final = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
    const events = await prisma.lotEvent.findMany({ where: { lotId: lot.id, type: 'BID_PLACED' }, orderBy: { seq: 'asc' } });

    // Cada lance aceito é maior que o anterior e o lote aponta para o último.
    for (let i = 1; i < events.length; i++) expect(events[i]!.amountCents! > events[i - 1]!.amountCents!).toBe(true);
    expect(final.currentPriceCents).toBe(events.at(-1)!.amountCents);
    // Só o líder tem valor comprometido.
    const committed = await prisma.wallet.findMany({ where: { committedCents: { gt: 0 } } });
    expect(committed.map((w) => w.userId)).toEqual([final.leaderId]);
  });

  it('mesmo licitante em dois lotes ao mesmo tempo não compromete mais do que tem', async () => {
    const seller = await createUser('AUCTIONEER');
    const ana = await createUser('BIDDER', 100);
    const lotA = await createTestLot(seller.id, { startingReais: 80 });
    const lotB = await createTestLot(seller.id, { startingReais: 80 });

    const results = await Promise.all([rejectionCode(bid(lotA.id, ana.id, 80)), rejectionCode(bid(lotB.id, ana.id, 80))]);
    expect(results.sort()).toEqual(['ACCEPTED', 'INSUFFICIENT_FUNDS']);
    expect(await wallet(ana.id)).toEqual({ balance: 100, committed: 80, available: 20 });
  });
});
