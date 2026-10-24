import { describe, expect, it } from 'vitest';
import { antiSnipingExtension, minimumNextBid, validateBid, type BidRuleLot } from '../src/bid-rules';
import { computeLotStatus } from '../src/lot-status';
import { parseBRLToCents } from '../src/money';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

const lot = (overrides: Partial<BidRuleLot> = {}): BidRuleLot => ({
  startsAt: minutes(-60),
  endsAt: minutes(60),
  cancelledAt: null,
  closedAt: null,
  startingPriceCents: 10_000,
  minIncrementCents: 500,
  currentPriceCents: null,
  leaderId: null,
  ...overrides,
});

const bid = (overrides: Partial<Parameters<typeof validateBid>[0]> = {}) =>
  validateBid({ lot: lot(), bidderId: 'ana', amountCents: 10_000, availableCents: 1_000_000, now: NOW, ...overrides });

describe('validateBid', () => {
  it('aceita primeiro lance igual ao lance inicial', () => {
    expect(bid()).toEqual({ ok: true, extendedEndsAt: null });
  });

  it('recusa primeiro lance abaixo do lance inicial', () => {
    expect(bid({ amountCents: 9_999 })).toMatchObject({ ok: false, code: 'BELOW_MINIMUM', details: { minimumCents: 10_000 } });
  });

  it('exige lance atual + incremento a partir do segundo lance', () => {
    const withLeader = lot({ currentPriceCents: 10_000, leaderId: 'bruno' });
    expect(bid({ lot: withLeader, amountCents: 10_499 })).toMatchObject({ ok: false, code: 'BELOW_MINIMUM', details: { minimumCents: 10_500 } });
    expect(bid({ lot: withLeader, amountCents: 10_500 })).toMatchObject({ ok: true });
  });

  it('impede o líder de cobrir o próprio lance', () => {
    expect(bid({ lot: lot({ currentPriceCents: 10_000, leaderId: 'ana' }), amountCents: 20_000 })).toMatchObject({
      ok: false,
      code: 'ALREADY_WINNING',
    });
  });

  it('recusa lance maior que o saldo disponível', () => {
    expect(bid({ availableCents: 9_000 })).toMatchObject({ ok: false, code: 'INSUFFICIENT_FUNDS' });
  });

  it('recusa lances fora da janela do lote', () => {
    expect(bid({ lot: lot({ startsAt: minutes(5) }) })).toMatchObject({ ok: false, code: 'LOT_NOT_STARTED' });
    expect(bid({ lot: lot({ endsAt: NOW }) })).toMatchObject({ ok: false, code: 'LOT_ENDED' });
    expect(bid({ lot: lot({ closedAt: minutes(-1) }) })).toMatchObject({ ok: false, code: 'LOT_ENDED' });
    expect(bid({ lot: lot({ cancelledAt: minutes(-1) }) })).toMatchObject({ ok: false, code: 'LOT_CANCELLED' });
  });

  it('prorroga o lote quando o lance chega nos últimos 2 minutos', () => {
    const result = bid({ lot: lot({ endsAt: minutes(1) }) });
    expect(result).toEqual({ ok: true, extendedEndsAt: minutes(2) });
  });
});

describe('antiSnipingExtension', () => {
  it('não prorroga fora da janela de 2 minutos', () => {
    expect(antiSnipingExtension(minutes(2.5), NOW)).toBeNull();
  });
  it('com exatamente 2 minutos restantes não há o que estender', () => {
    expect(antiSnipingExtension(minutes(2), NOW)).toBeNull();
  });
  it('estende para 2 minutos após o lance', () => {
    expect(antiSnipingExtension(minutes(0.5), NOW)).toEqual(minutes(2));
  });
});

describe('minimumNextBid / computeLotStatus', () => {
  it('calcula o mínimo do próximo lance', () => {
    expect(minimumNextBid(lot())).toBe(10_000);
    expect(minimumNextBid(lot({ currentPriceCents: 12_000 }))).toBe(12_500);
  });

  it('deriva o status a partir dos horários', () => {
    expect(computeLotStatus({ startsAt: minutes(1), endsAt: minutes(5) }, NOW)).toBe('SCHEDULED');
    expect(computeLotStatus({ startsAt: minutes(-1), endsAt: minutes(5) }, NOW)).toBe('LIVE');
    expect(computeLotStatus({ startsAt: minutes(-5), endsAt: NOW }, NOW)).toBe('ENDED');
    expect(computeLotStatus({ startsAt: minutes(-5), endsAt: minutes(5), cancelledAt: NOW }, NOW)).toBe('CANCELLED');
  });
});

describe('parseBRLToCents', () => {
  it.each([
    ['1.234,56', 123_456],
    ['R$ 10', 1_000],
    ['1234.5', 123_450],
    ['1.234', 123_400],
    ['0,01', 1],
  ])('%s → %i centavos', (input, expected) => {
    expect(parseBRLToCents(input)).toBe(expected);
  });

  it.each(['', 'abc', '0', '-5', '1,234'])('recusa "%s"', (input) => {
    expect(parseBRLToCents(input)).toBeNull();
  });
});
