import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  GENESIS_HASH,
  computeLotStatus,
  formatBRL,
  minimumNextBid,
  type AuctioneerDashboardDTO,
  type CreateLotInput,
  type ItemAttribute,
  type LotDetailDTO,
  type LotListDTO,
  type LotStatus,
  type ParticipationDTO,
  type ParticipationOutcome,
} from '@leilao/shared';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { centsToNumber, nullableCents } from '../../lib/money';
import { LOCKING_TX_OPTIONS, prisma } from '../../lib/prisma';
import { realtime } from '../../realtime/emitter';
import { insertEvent, sealNextEvent, type NewLotEvent } from '../audit/chain';
import { pseudonymFor } from '../audit/signer';
import type { AuthUser } from '../auth/session';
import { ensureItemSnapshot } from '../catalog/catalog.service';
import { applyWalletChange, broadcastWallets, lockWallets } from '../wallet/wallet.service';
import { lotInclude, toLotSummary, toPublicBid, toRuleLot } from './lots.mapper';

const MINUTE = 60_000;
const MAX_DURATION_MS = 90 * 24 * 60 * MINUTE;
const PAGE_SIZE = 24;

/* ------------------------------------------------------------------ criação */

export async function createLot(sellerId: string, input: CreateLotInput, now = new Date()) {
  let startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);

  // Tolerância de 1 min para "começar agora" (relógio do navegador x servidor).
  if (startsAt.getTime() < now.getTime() - MINUTE) {
    throw unprocessable('INVALID_SCHEDULE', 'O início do lote não pode estar no passado.');
  }
  if (startsAt < now) startsAt = now;
  if (endsAt.getTime() - startsAt.getTime() < MINUTE) {
    throw unprocessable('INVALID_SCHEDULE', 'O lote precisa durar pelo menos 1 minuto.');
  }
  if (endsAt.getTime() - now.getTime() > MAX_DURATION_MS) {
    throw unprocessable('INVALID_SCHEDULE', 'O lote deve terminar em no máximo 90 dias.');
  }

  // Snapshot do item (dados + imagem) ANTES da transação: chamada externa lenta
  // não deve segurar conexão nem lock no banco.
  const item = await ensureItemSnapshot(input.externalId);
  const id = randomUUID();
  const title = input.title?.trim() || item.title;
  const description = input.description?.trim() || null;

  const lot = await prisma.$transaction(async (tx) => {
    // Evento gênese: congela as condições do lote na cadeia de auditoria.
    const eventInput: NewLotEvent = {
      type: 'LOT_CREATED',
      occurredAt: now,
      actorId: sellerId,
      actor: pseudonymFor(id, sellerId, 'V'),
      amountCents: null,
      data: {
        item: { source: 'scryfall', externalId: item.externalId },
        title,
        description,
        startingPriceCents: String(input.startingPriceCents),
        minIncrementCents: String(input.minIncrementCents),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      },
    };
    const { event, head } = sealNextEvent({ id, chainLength: 0, chainHeadHash: GENESIS_HASH }, eventInput);
    const created = await tx.lot.create({
      data: {
        id,
        sellerId,
        itemId: item.id,
        title,
        description,
        startingPriceCents: BigInt(input.startingPriceCents),
        minIncrementCents: BigInt(input.minIncrementCents),
        startsAt,
        endsAt,
        originalEndsAt: endsAt,
        ...head,
      },
      include: lotInclude,
    });
    await insertEvent(tx, event, eventInput);
    return created;
  });

  realtime.lotsChanged();
  return toLotSummary(lot, now);
}

/* ------------------------------------------------------------- cancelamento */

/**
 * Sem lances: cancela direto. Com lances (opcional do desafio): cancela e estorna
 * na hora o valor comprometido do líder. Em ambos os casos o cancelamento entra
 * na cadeia de auditoria e o lote some da vitrine.
 */
export async function cancelLot(sellerId: string, lotId: string, reason: string | null, now = new Date()) {
  const outcome = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM lots WHERE id = ${lotId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw notFound('Lote não encontrado.');

    const lot = await tx.lot.findUniqueOrThrow({ where: { id: lotId } });
    if (lot.sellerId !== sellerId) throw forbidden('NOT_OWNER', 'Você só pode cancelar os seus próprios lotes.');
    if (lot.cancelledAt) throw conflict('ALREADY_CANCELLED', 'Este lote já foi cancelado.');
    if (lot.closedAt || now >= lot.endsAt) throw unprocessable('LOT_ENDED', 'Lotes encerrados não podem ser cancelados.');

    const refundedId = lot.leaderId;
    const refunded = lot.currentPriceCents;
    if (refundedId && refunded !== null) {
      await lockWallets(tx, [refundedId]);
      await applyWalletChange(tx, {
        userId: refundedId,
        type: 'RELEASE',
        amountCents: refunded,
        committedDelta: -refunded,
        description: `Lote #${lot.number} cancelado pelo leiloeiro — estorno do valor comprometido`,
        lotId,
        at: now,
      });
    }

    const eventInput: NewLotEvent = {
      type: 'LOT_CANCELLED',
      occurredAt: now,
      actorId: sellerId,
      actor: pseudonymFor(lot.id, sellerId, 'V'),
      amountCents: refunded,
      data: {
        reason,
        hadBids: lot.bidCount > 0,
        refundedTo: refundedId ? pseudonymFor(lot.id, refundedId) : null,
      },
    };
    const { event, head } = sealNextEvent(lot, eventInput);
    await insertEvent(tx, event, eventInput);
    await tx.lot.update({ where: { id: lot.id }, data: { cancelledAt: now, cancelReason: reason, ...head } });

    return { lot, refundedId, refunded };
  }, LOCKING_TX_OPTIONS);

  const { lot, refundedId, refunded } = outcome;
  realtime.lotCancelled(lot.id, reason);
  realtime.lotsChanged();
  if (refundedId) await broadcastWallets([refundedId]);

  const bidders = await prisma.lotEvent.findMany({
    where: { lotId: lot.id, type: 'BID_PLACED' },
    distinct: ['actorId'],
    select: { actorId: true },
  });
  for (const { actorId } of bidders) {
    if (!actorId) continue;
    const refundNote =
      actorId === refundedId && refunded !== null ? ` O valor de ${formatBRL(centsToNumber(refunded))} voltou para o seu saldo disponível.` : '';
    realtime.notify(actorId, {
      kind: 'LOT_CANCELLED',
      lotId: lot.id,
      title: lot.title,
      message: `O lote #${lot.number} foi cancelado pelo leiloeiro.${refundNote}`,
    });
  }
  return { refundedCents: refunded === null ? 0 : centsToNumber(refunded) };
}

/* ------------------------------------------------------------------ vitrine */

export interface LotFilters {
  status: 'live' | 'scheduled' | 'ended';
  q?: string;
  category?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  sort?: 'ending' | 'newest' | 'price_asc' | 'price_desc' | 'bids';
  page: number;
}

const effectivePrice = Prisma.sql`COALESCE(l.current_price_cents, l.starting_price_cents)`;

function statusCondition(status: LotFilters['status'], now: Date) {
  switch (status) {
    case 'live':
      return Prisma.sql`l.closed_at IS NULL AND l.starts_at <= ${now} AND l.ends_at > ${now}`;
    case 'scheduled':
      return Prisma.sql`l.starts_at > ${now}`;
    case 'ended':
      return Prisma.sql`(l.closed_at IS NOT NULL OR l.ends_at <= ${now})`;
  }
}

function orderBy(filters: LotFilters) {
  switch (filters.sort) {
    case 'newest':
      return Prisma.sql`l.created_at DESC`;
    case 'price_asc':
      return Prisma.sql`${effectivePrice} ASC, l.ends_at ASC`;
    case 'price_desc':
      return Prisma.sql`${effectivePrice} DESC, l.ends_at ASC`;
    case 'bids':
      return Prisma.sql`l.bid_count DESC, l.ends_at ASC`;
    default:
      if (filters.status === 'scheduled') return Prisma.sql`l.starts_at ASC`;
      if (filters.status === 'ended') return Prisma.sql`l.ends_at DESC`;
      return Prisma.sql`l.ends_at ASC`;
  }
}

/** Lotes cancelados nunca aparecem na vitrine. */
export async function listLots(filters: LotFilters, now = new Date()): Promise<LotListDTO> {
  const where: Prisma.Sql[] = [Prisma.sql`l.cancelled_at IS NULL`];
  if (filters.q) {
    const pattern = `%${filters.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    where.push(Prisma.sql`(l.title ILIKE ${pattern} OR i.subtitle ILIKE ${pattern} OR i.attributes::text ILIKE ${pattern})`);
  }
  if (filters.category) where.push(Prisma.sql`i.category = ${filters.category}`);
  if (filters.minPriceCents !== undefined) where.push(Prisma.sql`${effectivePrice} >= ${filters.minPriceCents}`);
  if (filters.maxPriceCents !== undefined) where.push(Prisma.sql`${effectivePrice} <= ${filters.maxPriceCents}`);
  const baseWhere = Prisma.join(where, ' AND ');

  const [ids, [counts]] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT l.id FROM lots l JOIN catalog_items i ON i.id = l.item_id
      WHERE ${baseWhere} AND ${statusCondition(filters.status, now)}
      ORDER BY ${orderBy(filters)}
      LIMIT ${PAGE_SIZE + 1} OFFSET ${(filters.page - 1) * PAGE_SIZE}`,
    prisma.$queryRaw<Array<{ live: number; scheduled: number; ended: number }>>`
      SELECT
        COUNT(*) FILTER (WHERE ${statusCondition('live', now)})::int AS live,
        COUNT(*) FILTER (WHERE ${statusCondition('scheduled', now)})::int AS scheduled,
        COUNT(*) FILTER (WHERE ${statusCondition('ended', now)})::int AS ended
      FROM lots l JOIN catalog_items i ON i.id = l.item_id
      WHERE ${baseWhere}`,
  ]);

  const pageIds = ids.slice(0, PAGE_SIZE).map((row) => row.id);
  const rows = await prisma.lot.findMany({ where: { id: { in: pageIds } }, include: lotInclude });
  const byId = new Map(rows.map((row) => [row.id, row]));

  return {
    lots: pageIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [toLotSummary(row, now)] : [];
    }),
    counts: counts ?? { live: 0, scheduled: 0, ended: 0 },
    page: filters.page,
    hasMore: ids.length > PAGE_SIZE,
    serverTime: now.toISOString(),
  };
}

/* ------------------------------------------------------------- sala do lote */

function cannotBidReason(viewer: AuthUser | undefined, status: LotStatus, isLeader: boolean): string | null {
  if (!viewer) return 'Entre como licitante para dar lances.';
  if (viewer.role !== 'BIDDER') return 'Leiloeiros não podem dar lances.';
  if (status === 'SCHEDULED') return 'O lote ainda não começou.';
  if (status === 'ENDED') return 'O lote já foi encerrado.';
  if (status === 'CANCELLED') return 'O lote foi cancelado.';
  if (isLeader) return 'Você já está ganhando este lote.';
  return null;
}

export async function getLotDetail(lotId: string, viewer: AuthUser | undefined, now = new Date()): Promise<LotDetailDTO> {
  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    include: {
      ...lotInclude,
      item: { select: { id: true, subtitle: true, category: true, description: true, attributes: true, externalUrl: true } },
      receipt: { select: { code: true, winnerId: true } },
    },
  });
  if (!lot) throw notFound('Lote não encontrado.');

  const bidRows = await prisma.lotEvent.findMany({
    where: { lotId, type: 'BID_PLACED' },
    orderBy: { seq: 'desc' },
    select: { seq: true, actor: true, actorId: true, amountCents: true, occurredAt: true, data: true, hash: true },
  });

  // Ranking por licitante: maior lance de cada um, do maior para o menor.
  const best = new Map<string, bigint>();
  for (const row of bidRows) {
    if (!row.actor || row.amountCents === null) continue;
    const current = best.get(row.actor);
    if (current === undefined || row.amountCents > current) best.set(row.actor, row.amountCents);
  }
  const ranking = [...best.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).map(([actor]) => actor);

  const status = computeLotStatus(lot, now);
  const isBidder = viewer?.role === 'BIDDER';
  const pseudonym = isBidder ? pseudonymFor(lot.id, viewer.id) : null;
  const isLeader = !!viewer && lot.leaderId === viewer.id;
  const wallet = isBidder ? await prisma.wallet.findUnique({ where: { userId: viewer.id } }) : null;
  const reason = cannotBidReason(viewer, status, isLeader);
  const isSeller = !!viewer && viewer.id === lot.sellerId;
  const canSeeReceipt = !!viewer && !!lot.receipt && (viewer.id === lot.receipt.winnerId || isSeller);

  return {
    ...toLotSummary(lot, now),
    description: lot.description ?? lot.item.description,
    attributes: (lot.item.attributes ?? []) as unknown as ItemAttribute[],
    externalUrl: lot.item.externalUrl,
    originalEndsAt: lot.originalEndsAt.toISOString(),
    extensionCount: lot.extensionCount,
    cancelledAt: lot.cancelledAt?.toISOString() ?? null,
    cancelReason: lot.cancelReason,
    closedAt: lot.closedAt?.toISOString() ?? null,
    leaderPseudonym: lot.leaderId ? (bidRows[0]?.actor ?? null) : null,
    distinctBidders: best.size,
    minimumNextBidCents: minimumNextBid(toRuleLot(lot)),
    bids: bidRows.map(toPublicBid),
    viewer: viewer
      ? {
          pseudonym,
          isLeader,
          myHighestBidCents: pseudonym ? nullableCents(best.get(pseudonym) ?? null) : null,
          position: pseudonym && ranking.includes(pseudonym) ? ranking.indexOf(pseudonym) + 1 : null,
          isSeller,
          canBid: reason === null,
          cannotBidReason: reason,
          availableCents: wallet ? centsToNumber(wallet.balanceCents - wallet.committedCents) : null,
        }
      : null,
    receiptCode: canSeeReceipt ? lot.receipt!.code : null,
    serverTime: now.toISOString(),
  };
}

/* ---------------------------------------------------------- painel leiloeiro */

export async function getAuctioneerDashboard(sellerId: string, now = new Date()): Promise<AuctioneerDashboardDTO> {
  const [lots, wallet] = await Promise.all([
    prisma.lot.findMany({ where: { sellerId }, include: lotInclude, orderBy: { createdAt: 'desc' } }),
    prisma.wallet.findUnique({ where: { userId: sellerId } }),
  ]);

  const totals = { receivedCents: 0, soldCount: 0, unsoldCount: 0, liveCount: 0, scheduledCount: 0, cancelledCount: 0 };
  const rows = lots.map((lot) => {
    const summary = toLotSummary(lot, now);
    const finalPriceCents = nullableCents(lot.finalPriceCents);
    if (summary.status === 'CANCELLED') totals.cancelledCount++;
    else if (summary.status === 'LIVE') totals.liveCount++;
    else if (summary.status === 'SCHEDULED') totals.scheduledCount++;
    else if (lot.closedAt && lot.winnerId) {
      totals.soldCount++;
      totals.receivedCents += finalPriceCents ?? 0;
    } else if (lot.closedAt) totals.unsoldCount++;

    return {
      ...summary,
      cancelledAt: lot.cancelledAt?.toISOString() ?? null,
      cancelReason: lot.cancelReason,
      canCancel: !lot.cancelledAt && !lot.closedAt && now < lot.endsAt,
      leaderPseudonym: lot.leaderId ? pseudonymFor(lot.id, lot.leaderId) : null,
      winnerPseudonym: lot.winnerId ? pseudonymFor(lot.id, lot.winnerId) : null,
      finalPriceCents,
      closedAt: lot.closedAt?.toISOString() ?? null,
    };
  });

  return { lots: rows, totals, balanceCents: wallet ? centsToNumber(wallet.balanceCents) : 0 };
}

/* ------------------------------------------------------------ meus arremates */

const OUTCOME_ORDER: Record<ParticipationOutcome, number> = { LEADING: 0, OUTBID: 1, WON: 2, LOST: 3, CANCELLED: 4 };

export async function getParticipations(userId: string, now = new Date()): Promise<ParticipationDTO[]> {
  const groups = await prisma.lotEvent.groupBy({
    by: ['lotId'],
    where: { actorId: userId, type: 'BID_PLACED' },
    _max: { amountCents: true, occurredAt: true },
    _count: { _all: true },
  });
  if (groups.length === 0) return [];

  const lots = await prisma.lot.findMany({
    where: { id: { in: groups.map((group) => group.lotId) } },
    include: { ...lotInclude, receipt: { select: { code: true } } },
  });
  const byId = new Map(lots.map((lot) => [lot.id, lot]));

  const items = groups.flatMap((group): ParticipationDTO[] => {
    const lot = byId.get(group.lotId);
    if (!lot) return [];
    let outcome: ParticipationOutcome;
    if (lot.cancelledAt) outcome = 'CANCELLED';
    else if (lot.closedAt) outcome = lot.winnerId === userId ? 'WON' : 'LOST';
    else outcome = lot.leaderId === userId ? 'LEADING' : 'OUTBID';

    return [
      {
        lot: toLotSummary(lot, now),
        pseudonym: pseudonymFor(lot.id, userId),
        myHighestBidCents: nullableCents(group._max.amountCents) ?? 0,
        myBidCount: group._count._all,
        lastBidAt: (group._max.occurredAt ?? lot.createdAt).toISOString(),
        outcome,
        receiptCode: outcome === 'WON' ? (lot.receipt?.code ?? null) : null,
      },
    ];
  });

  return items.sort((a, b) => OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] || Date.parse(b.lastBidAt) - Date.parse(a.lastBidAt));
}
