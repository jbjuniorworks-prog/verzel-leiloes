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

describe('cancelamento × liquidação disputando o mesmo lote', () => {
  beforeEach(resetDatabase);

  // Relógios na fronteira: o pedido de cancelamento é de um instante antes do fim e a liquidação
  // roda um instante depois — os dois são elegíveis e disputam a trava da mesma linha.
  const cancelNow = at(4.99);
  const settleNow = at(5.01);

  it('só uma transição vence: nunca estorno e cobrança juntos, no máximo um comprovante, e repetir não move saldo', async () => {
    const seller = await createUser('AUCTIONEER');
    const ana = await createUser('BIDDER', 10_000);
    const bruno = await createUser('BIDDER', 10_000);
    const modes = [...Array<'concorrente'>(8).fill('concorrente'), 'cancela-primeiro', 'liquida-primeiro'] as const;

    for (const mode of modes) {
      const lot = await createTestLot(seller.id, { end: 5 });
      await placeBid({ lotId: lot.id, bidderId: ana.id, amountCents: 10_000, now: at(1) });
      await placeBid({ lotId: lot.id, bidderId: bruno.id, amountCents: 15_000, now: at(2) });

      const cancel = () => cancelLot(seller.id, lot.id, null, cancelNow);
      const settle = () => settleLot(lot.id, settleNow);
      if (mode === 'concorrente') await Promise.allSettled([cancel(), settle()]);
      else if (mode === 'cancela-primeiro') {
        await cancel();
        expect(await settle()).toBe(false);
      } else {
        expect(await settle()).toBe(true);
        expect(await rejectionCode(cancel())).toBe('LOT_ENDED');
      }

      const final = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id }, include: { receipt: true } });
      const cancelled = final.cancelledAt !== null;
      expect(cancelled).toBe(final.closedAt === null); // exatamente uma das duas

      // Nos lances: HOLD da Ana, HOLD do Bruno e RELEASE da Ana (superada). O resto depende de quem venceu.
      const moves = await prisma.walletTransaction.groupBy({ by: ['type'], where: { lotId: lot.id }, _count: true });
      const byType = Object.fromEntries(moves.map((move) => [move.type, move._count]));
      expect(byType).toEqual(cancelled ? { HOLD: 2, RELEASE: 2 } : { HOLD: 2, RELEASE: 1, PAYMENT: 1, PAYOUT: 1 });
      expect(final.receipt === null).toBe(cancelled);

      const audit = await getLotAudit(lot.id);
      expect(audit.server.valid).toBe(true);
      expect(audit.events.filter((event) => event.type === 'LOT_CLOSED' || event.type === 'LOT_CANCELLED')).toHaveLength(1);

      // Repetir as duas operações depois não movimenta nada.
      const before = await Promise.all([wallet(ana.id), wallet(bruno.id), wallet(seller.id)]);
      expect(await settleLot(lot.id, at(6))).toBe(false);
      expect(await rejectionCode(cancel())).toBe(cancelled ? 'ALREADY_CANCELLED' : 'LOT_ENDED');
      expect(await Promise.all([wallet(ana.id), wallet(bruno.id), wallet(seller.id)])).toEqual(before);
      expect(await prisma.receipt.count({ where: { lotId: lot.id } })).toBe(cancelled ? 0 : 1);
    }

    // Ao fim, ninguém fica com valor preso: todo comprometido foi estornado ou cobrado.
    expect((await wallet(ana.id)).committed).toBe(0);
    expect((await wallet(bruno.id)).committed).toBe(0);
  });
});
