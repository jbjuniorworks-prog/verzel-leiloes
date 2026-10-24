import type { Lot, Prisma } from '@prisma/client';
import { computeLotStatus, minimumNextBid, type LotRealtimeUpdate, type LotSummaryDTO, type PublicBidDTO } from '@leilao/shared';
import { centsToNumber, nullableCents } from '../../lib/money';
import { prisma } from '../../lib/prisma';

export const lotInclude = {
  item: { select: { id: true, subtitle: true, category: true } },
  seller: { select: { name: true } },
} satisfies Prisma.LotInclude;

export type LotRow = Prisma.LotGetPayload<{ include: typeof lotInclude }>;

/** Sempre servida pela nossa API (cópia no banco), com fallback para a URL original. */
export const imageUrlFor = (itemId: string) => `/api/images/${itemId}`;

export function toLotSummary(lot: LotRow, now: Date): LotSummaryDTO {
  return {
    id: lot.id,
    number: lot.number,
    title: lot.title,
    subtitle: lot.item.subtitle,
    category: lot.item.category,
    imageUrl: imageUrlFor(lot.item.id),
    status: computeLotStatus(lot, now),
    startsAt: lot.startsAt.toISOString(),
    endsAt: lot.endsAt.toISOString(),
    startingPriceCents: centsToNumber(lot.startingPriceCents),
    minIncrementCents: centsToNumber(lot.minIncrementCents),
    currentPriceCents: nullableCents(lot.currentPriceCents),
    bidCount: lot.bidCount,
    sellerName: lot.seller.name,
    result: lot.closedAt ? (lot.winnerId ? 'SOLD' : 'UNSOLD') : null,
  };
}

export const toRuleLot = (lot: Lot) => ({
  startsAt: lot.startsAt,
  endsAt: lot.endsAt,
  cancelledAt: lot.cancelledAt,
  closedAt: lot.closedAt,
  startingPriceCents: centsToNumber(lot.startingPriceCents),
  minIncrementCents: centsToNumber(lot.minIncrementCents),
  currentPriceCents: nullableCents(lot.currentPriceCents),
  leaderId: lot.leaderId,
});

export function toPublicBid(row: {
  seq: number;
  actor: string | null;
  amountCents: bigint | null;
  occurredAt: Date;
  data: Prisma.JsonValue;
  hash: string;
}): PublicBidDTO {
  const data = (row.data ?? {}) as { extended?: boolean; endsAt?: string };
  return {
    seq: row.seq,
    bidder: row.actor ?? '?',
    amountCents: nullableCents(row.amountCents) ?? 0,
    placedAt: row.occurredAt.toISOString(),
    extendedEndsAt: data.extended ? (data.endsAt ?? null) : null,
    hash: row.hash,
  };
}

export async function countDistinctBidders(lotId: string): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(DISTINCT actor_id)::int AS count FROM lot_events WHERE lot_id = ${lotId}::uuid AND type = 'BID_PLACED'`;
  return row?.count ?? 0;
}

export async function buildLotUpdate(lot: Lot, bid: PublicBidDTO | null, now = new Date()): Promise<LotRealtimeUpdate> {
  const lastBid =
    bid ??
    (await prisma.lotEvent
      .findFirst({ where: { lotId: lot.id, type: 'BID_PLACED' }, orderBy: { seq: 'desc' } })
      .then((row) => (row ? toPublicBid(row) : null)));
  return {
    lotId: lot.id,
    status: computeLotStatus(lot, now),
    currentPriceCents: nullableCents(lot.currentPriceCents),
    minimumNextBidCents: minimumNextBid(toRuleLot(lot)),
    leaderPseudonym: lot.leaderId ? (lastBid?.bidder ?? null) : null,
    bidCount: lot.bidCount,
    distinctBidders: await countDistinctBidders(lot.id),
    endsAt: lot.endsAt.toISOString(),
    bid,
    serverTime: now.toISOString(),
  };
}
