import { formatBRL, validateBid, type PublicBidDTO } from '@leilao/shared';
import { forbidden, notFound, unprocessable } from '../../lib/errors';
import { centsToNumber } from '../../lib/money';
import { LOCKING_TX_OPTIONS, prisma } from '../../lib/prisma';
import { realtime } from '../../realtime/emitter';
import { insertEvent, sealNextEvent, type NewLotEvent } from '../audit/chain';
import { pseudonymFor } from '../audit/signer';
import { buildLotUpdate, toPublicBid, toRuleLot } from '../lots/lots.mapper';
import { applyWalletChange, broadcastWallets, lockWallets, toBalanceDTO } from '../wallet/wallet.service';

/**
 * Coração do leilão. Tudo acontece numa transação que começa travando a linha do
 * lote (SELECT ... FOR UPDATE): lances concorrentes no mesmo lote entram em fila e
 * cada um valida as regras contra o estado já atualizado pelo anterior. Sem isso,
 * dois lances simultâneos poderiam passar na validação com o mesmo "lance atual".
 *
 * Dentro da transação:
 *  1. trava lote e depois carteiras (ordem fixa → sem deadlock);
 *  2. valida as regras (janela, mínimo, líder, saldo disponível);
 *  3. compromete o valor do novo líder e devolve o do líder anterior;
 *  4. anexa o evento assinado na cadeia de auditoria;
 *  5. atualiza o lote (preço, líder, prorrogação anti-sniping, cabeça da cadeia).
 * Só depois do COMMIT o lance é anunciado em tempo real.
 *
 * `now` é injetável para testes e seed; em produção é o relógio do servidor
 * lido depois de obter os locks.
 */
export async function placeBid(params: { lotId: string; bidderId: string; amountCents: number; now?: Date }) {
  const { lotId, bidderId, amountCents } = params;

  const outcome = await prisma.$transaction(async (tx) => {
    // A rota já exige papel de licitante; aqui é a segunda barreira (seed, scripts, testes).
    const bidder = await tx.user.findUnique({ where: { id: bidderId }, select: { role: true } });
    if (bidder?.role !== 'BIDDER') throw forbidden('ROLE_NOT_ALLOWED', 'Apenas licitantes podem dar lances.');

    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM lots WHERE id = ${lotId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw notFound('Lote não encontrado.');

    const lot = await tx.lot.findUniqueOrThrow({ where: { id: lotId } });
    const previousLeaderId = lot.leaderId;
    const previousPrice = lot.currentPriceCents;

    await lockWallets(tx, [bidderId, previousLeaderId]);
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: bidderId } });
    const now = params.now ?? new Date();

    const validation = validateBid({
      lot: toRuleLot(lot),
      bidderId,
      amountCents,
      availableCents: centsToNumber(wallet.balanceCents - wallet.committedCents),
      now,
    });
    if (!validation.ok) throw unprocessable(validation.code, validation.message, validation.details);

    const amount = BigInt(amountCents);
    const bidderWallet = await applyWalletChange(tx, {
      userId: bidderId,
      type: 'HOLD',
      amountCents: amount,
      committedDelta: amount,
      description: `Lance de ${formatBRL(amountCents)} no lote #${lot.number} — valor comprometido`,
      lotId,
      at: now,
    });
    if (previousLeaderId && previousPrice !== null) {
      await applyWalletChange(tx, {
        userId: previousLeaderId,
        type: 'RELEASE',
        amountCents: previousPrice,
        committedDelta: -previousPrice,
        description: `Lance superado no lote #${lot.number} — valor liberado`,
        lotId,
        at: now,
      });
    }

    const endsAt = validation.extendedEndsAt ?? lot.endsAt;
    const eventInput: NewLotEvent = {
      type: 'BID_PLACED',
      occurredAt: now,
      actorId: bidderId,
      actor: pseudonymFor(lot.id, bidderId),
      amountCents: amount,
      data: { endsAt: endsAt.toISOString(), extended: validation.extendedEndsAt !== null },
    };
    const { event, head } = sealNextEvent(lot, eventInput);
    await insertEvent(tx, event, eventInput);

    const updated = await tx.lot.update({
      where: { id: lot.id },
      data: {
        currentPriceCents: amount,
        leaderId: bidderId,
        bidCount: { increment: 1 },
        endsAt,
        ...(validation.extendedEndsAt ? { extensionCount: { increment: 1 } } : {}),
        ...head,
      },
    });

    const bid: PublicBidDTO = toPublicBid({ ...event, amountCents: amount, occurredAt: now, data: event.data });
    return { lot: updated, bid, previousLeaderId, previousPrice, wallet: toBalanceDTO(bidderWallet), now };
  }, LOCKING_TX_OPTIONS);

  // Pós-commit: anúncios em tempo real.
  const update = await buildLotUpdate(outcome.lot, outcome.bid, outcome.now);
  realtime.lotUpdated(update);
  realtime.lotsChanged();
  await broadcastWallets([bidderId, outcome.previousLeaderId]);
  if (outcome.previousLeaderId && outcome.previousPrice !== null) {
    realtime.notify(outcome.previousLeaderId, {
      kind: 'OUTBID',
      lotId,
      title: outcome.lot.title,
      message: `Seu lance de ${formatBRL(centsToNumber(outcome.previousPrice))} no lote #${outcome.lot.number} foi superado. Novo lance: ${formatBRL(amountCents)}.`,
    });
  }

  return { bid: outcome.bid, lot: update, wallet: outcome.wallet };
}
