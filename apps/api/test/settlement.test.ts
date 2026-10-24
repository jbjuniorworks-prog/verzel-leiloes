import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { getLotAudit, getReceipt } from '../src/modules/audit/audit.service';
import { placeBid } from '../src/modules/bids/bids.service';
import { cancelLot } from '../src/modules/lots/lots.service';
import { settleDueLots, settleLot } from '../src/modules/settlement/settlement.service';
import { at, createTestLot, createUser, rejectionCode, resetDatabase, wallet } from './helpers';

describe('liquidação', () => {
  beforeEach(resetDatabase);

  it('debita o vencedor, credita o leiloeiro e emite comprovante assinado', async () => {
    const seller = await createUser('AUCTIONEER');
    const ana = await createUser('BIDDER', 1_000);
    const bruno = await createUser('BIDDER', 1_000);
    const lot = await createTestLot(seller.id, { end: 30 });
    await placeBid({ lotId: lot.id, bidderId: ana.id, amountCents: 10_000, now: at(0) });
    await placeBid({ lotId: lot.id, bidderId: bruno.id, amountCents: 25_000, now: at(1) });

    expect(await settleLot(lot.id, at(29))).toBe(false); // ainda não acabou
    expect(await settleLot(lot.id, at(30))).toBe(true);
    expect(await settleLot(lot.id, at(31))).toBe(false); // idempotente

    expect(await wallet(bruno.id)).toEqual({ balance: 750, committed: 0, available: 750 });
    expect(await wallet(ana.id)).toEqual({ balance: 1_000, committed: 0, available: 1_000 });
    expect(await wallet(seller.id)).toMatchObject({ balance: 250 });

    const closed = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id }, include: { receipt: true } });
    expect(closed.winnerId).toBe(bruno.id);
    expect(closed.finalPriceCents).toBe(25_000n);

    const receipt = await getReceipt(closed.receipt!.code);
    expect(receipt.server).toEqual({ valid: true, hashValid: true, signatureValid: true });
    expect(receipt.lot.chainValid).toBe(true);
    expect(receipt.receipt.amountCents).toBe('25000');
    // Privacidade: o comprovante identifica o vencedor só por pseudônimo.
    expect(JSON.stringify(receipt)).not.toContain(bruno.email);
    expect(JSON.stringify(receipt)).not.toContain(bruno.id);
    expect(receipt.receipt.winner).toMatch(/^L-[0-9A-F]{8}$/);
  });

  it('lote sem lances fecha sem vencedor', async () => {
    const seller = await createUser('AUCTIONEER');
    const lot = await createTestLot(seller.id, { end: 5 });
    expect(await settleDueLots(at(6))).toBe(1);
    const closed = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id }, include: { receipt: true } });
    expect(closed.closedAt).not.toBeNull();
    expect(closed.winnerId).toBeNull();
    expect(closed.receipt).toBeNull();
    expect((await getLotAudit(lot.id)).events.map((e) => e.type)).toEqual(['LOT_CREATED', 'LOT_CLOSED']);
  });

  it('lance depois do encerramento é recusado mesmo antes da liquidação rodar', async () => {
    const seller = await createUser('AUCTIONEER');
    const ana = await createUser('BIDDER', 1_000);
    const lot = await createTestLot(seller.id, { end: 5 });
    expect(await rejectionCode(placeBid({ lotId: lot.id, bidderId: ana.id, amountCents: 10_000, now: at(5) }))).toBe('LOT_ENDED');
  });
});

describe('cancelamento', () => {
  beforeEach(resetDatabase);

  it('lote sem lances: cancela e sai da vitrine', async () => {
    const seller = await createUser('AUCTIONEER');
    const lot = await createTestLot(seller.id);
    expect(await cancelLot(seller.id, lot.id, 'teste', at(0))).toEqual({ refundedCents: 0 });
    const audit = await getLotAudit(lot.id, at(1));
    expect(audit.lot.status).toBe('CANCELLED');
    expect(audit.server.valid).toBe(true);
  });

  it('lote com lances: estorna automaticamente o valor comprometido do líder', async () => {
    const seller = await createUser('AUCTIONEER');
    const ana = await createUser('BIDDER', 1_000);
    const lot = await createTestLot(seller.id);
    await placeBid({ lotId: lot.id, bidderId: ana.id, amountCents: 40_000, now: at(0) });
    expect(await wallet(ana.id)).toMatchObject({ committed: 400 });

    expect(await cancelLot(seller.id, lot.id, null, at(1))).toEqual({ refundedCents: 40_000 });
    expect(await wallet(ana.id)).toEqual({ balance: 1_000, committed: 0, available: 1_000 });
    // Cancelado não é liquidado.
    expect(await settleLot(lot.id, at(120))).toBe(false);
  });

  it('só o dono cancela, e nunca um lote encerrado', async () => {
    const seller = await createUser('AUCTIONEER');
    const other = await createUser('AUCTIONEER');
    const lot = await createTestLot(seller.id, { end: 5 });
    expect(await rejectionCode(cancelLot(other.id, lot.id, null, at(0)))).toBe('NOT_OWNER');
    expect(await rejectionCode(cancelLot(seller.id, lot.id, null, at(6)))).toBe('LOT_ENDED');
  });
});
