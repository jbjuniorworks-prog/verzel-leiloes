import { formatBRL } from './money';

/** Janela de prorrogação: lance aceito nos últimos 2 minutos estende o lote. */
export const ANTI_SNIPING_WINDOW_MS = 2 * 60 * 1000;
/** Após um lance na janela, o lote passa a terminar 2 minutos depois do lance. */
export const ANTI_SNIPING_EXTENSION_MS = 2 * 60 * 1000;

export interface BidRuleLot {
  startsAt: Date;
  endsAt: Date;
  cancelledAt: Date | null;
  closedAt: Date | null;
  startingPriceCents: number;
  minIncrementCents: number;
  currentPriceCents: number | null;
  leaderId: string | null;
}

export type BidRejectionCode = 'LOT_CANCELLED' | 'LOT_NOT_STARTED' | 'LOT_ENDED' | 'ALREADY_WINNING' | 'BELOW_MINIMUM' | 'INSUFFICIENT_FUNDS';

export type BidValidation =
  { ok: true; extendedEndsAt: Date | null } | { ok: false; code: BidRejectionCode; message: string; details: Record<string, unknown> };

/** Primeiro lance: ≥ lance inicial. Demais: ≥ lance atual + incremento mínimo. */
export function minimumNextBid(lot: Pick<BidRuleLot, 'startingPriceCents' | 'minIncrementCents' | 'currentPriceCents'>): number {
  return lot.currentPriceCents === null ? lot.startingPriceCents : lot.currentPriceCents + lot.minIncrementCents;
}

/**
 * Se o lance cair nos últimos 2 minutos, o fim passa a ser "momento do lance + 2 min".
 * Retorna null quando não há prorrogação.
 */
export function antiSnipingExtension(endsAt: Date, bidAt: Date): Date | null {
  const remaining = endsAt.getTime() - bidAt.getTime();
  if (remaining > ANTI_SNIPING_WINDOW_MS) return null;
  const extended = bidAt.getTime() + ANTI_SNIPING_EXTENSION_MS;
  return extended > endsAt.getTime() ? new Date(extended) : null;
}

const formatDateBR = (date: Date) => date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

/**
 * Regras de lance puras (sem banco). O back-end chama esta função com o lote e a
 * carteira já travados (SELECT ... FOR UPDATE), então o resultado é definitivo.
 * O front usa a mesma função só para avisar antes de enviar.
 */
export function validateBid(input: { lot: BidRuleLot; bidderId: string; amountCents: number; availableCents: number; now: Date }): BidValidation {
  const { lot, bidderId, amountCents, availableCents, now } = input;

  if (lot.cancelledAt) {
    return { ok: false, code: 'LOT_CANCELLED', message: 'Este lote foi cancelado pelo leiloeiro e não aceita lances.', details: {} };
  }
  if (now < lot.startsAt) {
    return {
      ok: false,
      code: 'LOT_NOT_STARTED',
      message: `Lote ainda não iniciado. Os lances abrem em ${formatDateBR(lot.startsAt)} (horário de Brasília).`,
      details: { startsAt: lot.startsAt.toISOString() },
    };
  }
  if (lot.closedAt || now >= lot.endsAt) {
    return { ok: false, code: 'LOT_ENDED', message: 'Lote encerrado: o prazo para lances já terminou.', details: { endsAt: lot.endsAt.toISOString() } };
  }
  if (lot.leaderId === bidderId) {
    return {
      ok: false,
      code: 'ALREADY_WINNING',
      message: 'Você já está ganhando este lote. Não é possível cobrir o próprio lance.',
      details: { currentPriceCents: lot.currentPriceCents },
    };
  }

  const minimum = minimumNextBid(lot);
  if (amountCents < minimum) {
    const message =
      lot.currentPriceCents === null
        ? `Lance abaixo do mínimo. O primeiro lance deve ser de pelo menos ${formatBRL(minimum)} (lance inicial).`
        : `Lance abaixo do mínimo. O próximo lance deve ser de pelo menos ${formatBRL(minimum)} ` +
          `(lance atual ${formatBRL(lot.currentPriceCents)} + incremento de ${formatBRL(lot.minIncrementCents)}).`;
    return { ok: false, code: 'BELOW_MINIMUM', message, details: { minimumCents: minimum } };
  }

  if (amountCents > availableCents) {
    return {
      ok: false,
      code: 'INSUFFICIENT_FUNDS',
      message: `Saldo insuficiente. Seu saldo disponível é ${formatBRL(availableCents)} e o lance é de ${formatBRL(amountCents)}.`,
      details: { availableCents, amountCents },
    };
  }

  return { ok: true, extendedEndsAt: antiSnipingExtension(lot.endsAt, now) };
}
