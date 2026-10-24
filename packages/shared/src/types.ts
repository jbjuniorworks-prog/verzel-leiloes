// Contratos (DTOs) entre API e front. Datas trafegam como string ISO e dinheiro
// como centavos inteiros.

import type { ChainHead, ChainIssue, ChainVerification, ReceiptContent, SignedChainEvent } from './audit';
import type { LotStatus } from './lot-status';

export type Role = 'AUCTIONEER' | 'BIDDER';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface ItemAttribute {
  label: string;
  value: string;
}

/* --------------------------------------------------------------- catálogo */

export interface CatalogItemDTO {
  source: 'scryfall';
  externalId: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  category: string | null;
  attributes: ItemAttribute[];
  imageUrl: string | null;
  externalUrl: string | null;
  /** Preço de referência do mercado em centavos de dólar, quando a API informa. */
  referencePriceUsdCents: number | null;
}

export interface CatalogSearchDTO {
  items: CatalogItemDTO[];
  page: number;
  hasMore: boolean;
  total: number;
  /** "live" = veio da API agora; "cache" = API indisponível, resultado guardado. */
  source: 'live' | 'cache';
  notice: string | null;
}

/* ------------------------------------------------------------------- lotes */

export type LotResult = 'SOLD' | 'UNSOLD' | null;

export interface LotSummaryDTO {
  id: string;
  number: number;
  title: string;
  subtitle: string | null;
  category: string | null;
  imageUrl: string | null;
  status: LotStatus;
  startsAt: string;
  endsAt: string;
  startingPriceCents: number;
  minIncrementCents: number;
  currentPriceCents: number | null;
  bidCount: number;
  sellerName: string;
  result: LotResult;
}

export interface PublicBidDTO {
  seq: number;
  bidder: string;
  amountCents: number;
  placedAt: string;
  /** Novo fim do lote quando o lance causou prorrogação (anti-sniping). */
  extendedEndsAt: string | null;
  hash: string;
}

export interface LotViewerDTO {
  pseudonym: string | null;
  isLeader: boolean;
  myHighestBidCents: number | null;
  /** Posição entre licitantes distintos (1 = liderando). */
  position: number | null;
  isSeller: boolean;
  canBid: boolean;
  cannotBidReason: string | null;
  availableCents: number | null;
}

export interface LotDetailDTO extends LotSummaryDTO {
  /** Escrita pelo leiloeiro (estado de conservação etc.). */
  description: string | null;
  /** Texto de regras da carta, como veio da API externa (em inglês, com símbolos entre chaves). */
  cardText: string | null;
  attributes: ItemAttribute[];
  externalUrl: string | null;
  originalEndsAt: string;
  extensionCount: number;
  cancelledAt: string | null;
  cancelReason: string | null;
  closedAt: string | null;
  leaderPseudonym: string | null;
  distinctBidders: number;
  minimumNextBidCents: number;
  /** Mais recente primeiro. */
  bids: PublicBidDTO[];
  viewer: LotViewerDTO | null;
  receiptCode: string | null;
  serverTime: string;
}

export interface LotListDTO {
  lots: LotSummaryDTO[];
  /** Quantidade por aba, já considerando busca e filtros. */
  counts: { live: number; scheduled: number; ended: number };
  page: number;
  hasMore: boolean;
  serverTime: string;
}

export interface CreateLotInput {
  externalId: string;
  title?: string;
  description?: string;
  startingPriceCents: number;
  minIncrementCents: number;
  startsAt: string;
  endsAt: string;
}

/* ---------------------------------------------------------------- leiloeiro */

export interface AuctioneerLotDTO extends LotSummaryDTO {
  cancelledAt: string | null;
  cancelReason: string | null;
  canCancel: boolean;
  leaderPseudonym: string | null;
  winnerPseudonym: string | null;
  finalPriceCents: number | null;
  closedAt: string | null;
}

export interface AuctioneerDashboardDTO {
  lots: AuctioneerLotDTO[];
  totals: {
    receivedCents: number;
    soldCount: number;
    unsoldCount: number;
    liveCount: number;
    scheduledCount: number;
    cancelledCount: number;
  };
  balanceCents: number;
}

/* ------------------------------------------------------------------ carteira */

export type WalletTransactionType = 'DEPOSIT' | 'HOLD' | 'RELEASE' | 'PAYMENT' | 'PAYOUT';

export interface WalletTransactionDTO {
  id: string;
  type: WalletTransactionType;
  amountCents: number;
  balanceAfterCents: number;
  committedAfterCents: number;
  description: string;
  lotId: string | null;
  lotNumber: number | null;
  createdAt: string;
}

export interface WalletBalanceDTO {
  balanceCents: number;
  committedCents: number;
  availableCents: number;
}

export interface WalletDTO extends WalletBalanceDTO {
  holds: { lotId: string; lotNumber: number; title: string; amountCents: number; endsAt: string }[];
  transactions: WalletTransactionDTO[];
}

/* ------------------------------------------------------------ participações */

export type ParticipationOutcome = 'LEADING' | 'OUTBID' | 'WON' | 'LOST' | 'CANCELLED';

export interface ParticipationDTO {
  lot: LotSummaryDTO;
  pseudonym: string;
  myHighestBidCents: number;
  myBidCount: number;
  lastBidAt: string;
  outcome: ParticipationOutcome;
  receiptCode: string | null;
}

/* ---------------------------------------------------------------- auditoria */

export interface AuditDTO {
  lot: {
    id: string;
    number: number;
    title: string;
    imageUrl: string | null;
    status: LotStatus;
    startsAt: string;
    endsAt: string;
    closedAt: string | null;
    cancelledAt: string | null;
  };
  events: SignedChainEvent[];
  head: ChainHead;
  publicKey: string;
  algorithm: string;
  /** Verificação feita pelo servidor: cadeia + consistência com o estado do lote. */
  server: ChainVerification & { consistency: ChainIssue[] };
  verifiedAt: string;
}

export interface ReceiptDTO {
  receipt: ReceiptContent;
  hash: string;
  signature: string;
  publicKey: string;
  lot: { imageUrl: string | null; subtitle: string | null; chainValid: boolean };
  server: { valid: boolean; hashValid: boolean; signatureValid: boolean };
}

/* ---------------------------------------------------------------- tempo real */

export interface LotRealtimeUpdate {
  lotId: string;
  status: LotStatus;
  currentPriceCents: number | null;
  minimumNextBidCents: number;
  leaderPseudonym: string | null;
  bidCount: number;
  distinctBidders: number;
  endsAt: string;
  bid: PublicBidDTO | null;
  serverTime: string;
}

export interface LotClosedPayload {
  lotId: string;
  result: 'SOLD' | 'UNSOLD';
  finalPriceCents: number | null;
  winnerPseudonym: string | null;
}

export type NotificationKind = 'OUTBID' | 'WON' | 'LOST' | 'SOLD' | 'UNSOLD' | 'LOT_CANCELLED';

export interface NotificationPayload {
  kind: NotificationKind;
  lotId: string;
  title: string;
  message: string;
}

export interface ServerToClientEvents {
  'lot:update': (payload: LotRealtimeUpdate) => void;
  'lot:closed': (payload: LotClosedPayload) => void;
  'lot:cancelled': (payload: { lotId: string; reason: string | null }) => void;
  'lots:changed': () => void;
  'wallet:update': (payload: WalletBalanceDTO) => void;
  notify: (payload: NotificationPayload) => void;
}

export interface ClientToServerEvents {
  'lot:watch': (lotId: string) => void;
  'lot:unwatch': (lotId: string) => void;
}
