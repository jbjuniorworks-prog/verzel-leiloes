import { randomBytes } from 'node:crypto';
import { formatBRL, type ReceiptContent } from '@leilao/shared';
import { logger } from '../../lib/logger';
import { centsToNumber } from '../../lib/money';
import { LOCKING_TX_OPTIONS, prisma } from '../../lib/prisma';
import { realtime } from '../../realtime/emitter';
import { insertEvent, sealNextEvent, type NewLotEvent } from '../audit/chain';
import { auditSigner, pseudonymFor } from '../audit/signer';
import { applyWalletChange, broadcastWallets, lockWallets } from '../wallet/wallet.service';

/**
 * Liquida um lote vencido: debita o vencedor (saldo e comprometido), credita o
 * leiloeiro, sela o evento LOT_CLOSED na cadeia e emite o comprovante assinado.
 * Lote sem lances fecha sem vencedor.
 *
 * O `FOR UPDATE SKIP LOCKED` + as condições no WHERE tornam a operação idempotente
 * e segura com mais de uma instância: se outra transação já está liquidando (ou se
 * um lance de última hora prorrogou o fim), esta simplesmente não faz nada.
 */
export async function settleLot(lotId: string, now = new Date()): Promise<boolean> {
  const outcome = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM lots
      WHERE id = ${lotId}::uuid AND closed_at IS NULL AND cancelled_at IS NULL AND ends_at <= ${now}
      FOR UPDATE SKIP LOCKED`;
    if (locked.length === 0) return null;

    const lot = await tx.lot.findUniqueOrThrow({ where: { id: lotId } });
    const winnerId = lot.leaderId;
    const price = lot.currentPriceCents;
    const sold = winnerId !== null && price !== null;

    if (sold) {
      await lockWallets(tx, [winnerId, lot.sellerId]);
      await applyWalletChange(tx, {
        userId: winnerId,
        type: 'PAYMENT',
        amountCents: price,
        balanceDelta: -price,
        committedDelta: -price,
        description: `Arremate do lote #${lot.number} — ${lot.title}`,
        lotId,
        at: now,
      });
      await applyWalletChange(tx, {
        userId: lot.sellerId,
        type: 'PAYOUT',
        amountCents: price,
        balanceDelta: price,
        description: `Venda do lote #${lot.number} — ${lot.title}`,
        lotId,
        at: now,
      });
    }

    const winnerPseudonym = sold ? pseudonymFor(lot.id, winnerId) : null;
    const eventInput: NewLotEvent = {
      type: 'LOT_CLOSED',
      occurredAt: now,
      actorId: winnerId,
      actor: winnerPseudonym,
      amountCents: sold ? price : null,
      data: { result: sold ? 'SOLD' : 'UNSOLD', bidCount: lot.bidCount, endedAt: lot.endsAt.toISOString() },
    };
    const { event, head } = sealNextEvent(lot, eventInput);
    await insertEvent(tx, event, eventInput);

    await tx.lot.update({
      where: { id: lot.id },
      data: { closedAt: now, winnerId: sold ? winnerId : null, finalPriceCents: sold ? price : null, ...head },
    });

    let receiptCode: string | null = null;
    if (sold) {
      receiptCode = randomBytes(12).toString('base64url');
      const content: ReceiptContent = {
        code: receiptCode,
        lotId: lot.id,
        lotNumber: lot.number,
        itemTitle: lot.title,
        winner: winnerPseudonym!,
        amountCents: price.toString(),
        currency: 'BRL',
        closedAt: now.toISOString(),
        closeEventSeq: event.seq,
        closeEventHash: event.hash,
        issuedAt: now.toISOString(),
      };
      const sealed = auditSigner.sealReceipt(content);
      await tx.receipt.create({
        data: { code: receiptCode, lotId: lot.id, winnerId, content: { ...content }, hash: sealed.hash, signature: sealed.signature, issuedAt: now },
      });
    }

    return { lot, winnerId: sold ? winnerId : null, price, winnerPseudonym, receiptCode };
  }, LOCKING_TX_OPTIONS);

  if (!outcome) return false;
  const { lot, winnerId, price, winnerPseudonym } = outcome;
  const finalPrice = winnerId && price !== null ? centsToNumber(price) : null;

  realtime.lotClosed({ lotId: lot.id, result: winnerId ? 'SOLD' : 'UNSOLD', finalPriceCents: finalPrice, winnerPseudonym });
  realtime.lotsChanged();

  if (winnerId && finalPrice !== null) {
    await broadcastWallets([winnerId, lot.sellerId]);
    realtime.notify(winnerId, {
      kind: 'WON',
      lotId: lot.id,
      title: lot.title,
      message: `Você arrematou o lote #${lot.number} por ${formatBRL(finalPrice)}! O comprovante já está em "Meus arremates".`,
    });
    realtime.notify(lot.sellerId, {
      kind: 'SOLD',
      lotId: lot.id,
      title: lot.title,
      message: `O lote #${lot.number} foi arrematado por ${formatBRL(finalPrice)}.`,
    });
    const losers = await prisma.lotEvent.findMany({
      where: { lotId: lot.id, type: 'BID_PLACED', actorId: { not: winnerId } },
      distinct: ['actorId'],
      select: { actorId: true },
    });
    for (const { actorId } of losers) {
      if (actorId) {
        realtime.notify(actorId, { kind: 'LOST', lotId: lot.id, title: lot.title, message: `O lote #${lot.number} foi encerrado e outro licitante venceu.` });
      }
    }
  } else {
    realtime.notify(lot.sellerId, {
      kind: 'UNSOLD',
      lotId: lot.id,
      title: lot.title,
      message: `O lote #${lot.number} foi encerrado sem lances.`,
    });
  }
  return true;
}

export async function settleDueLots(now = new Date()): Promise<number> {
  const due = await prisma.lot.findMany({
    where: { closedAt: null, cancelledAt: null, endsAt: { lte: now } },
    select: { id: true },
    orderBy: { endsAt: 'asc' },
    take: 50,
  });
  let settled = 0;
  for (const { id } of due) {
    try {
      if (await settleLot(id, now)) settled++;
    } catch (error) {
      logger.error(`Falha ao liquidar o lote ${id}`, error);
    }
  }
  return settled;
}
