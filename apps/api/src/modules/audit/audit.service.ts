import type { Lot, LotEvent } from '@prisma/client';
import {
  computeLotStatus,
  createWebAuditCrypto,
  verifyChain,
  verifyReceipt,
  type AuditDTO,
  type ChainIssue,
  type ReceiptContent,
  type ReceiptDTO,
} from '@leilao/shared';
import { notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { imageUrlFor } from '../lots/lots.mapper';
import { toSignedEvent } from './chain';
import { auditSigner, pseudonymFor } from './signer';

const crypto = createWebAuditCrypto();
export const AUDIT_ALGORITHM = 'SHA-256 (hash encadeado) + Ed25519 (assinatura)';

type CreatedData = {
  item?: { externalId?: string };
  title?: string;
  startingPriceCents?: string;
  minIncrementCents?: string;
  startsAt?: string;
  endsAt?: string;
};

/**
 * Checagens que só o servidor consegue fazer (precisam do segredo dos pseudônimos
 * ou de colunas internas): o estado "vivo" do lote precisa ser exatamente o que a
 * cadeia de eventos descreve. Pega, por exemplo, alguém que troca o líder ou o
 * preço direto na tabela de lotes, ou reatribui um lance a outro usuário.
 */
function checkConsistency(lot: Lot & { item: { externalId: string } }, rows: LotEvent[]): ChainIssue[] {
  const issues: ChainIssue[] = [];
  const mismatch = (message: string, seq: number | null = null) => issues.push({ code: 'STATE_MISMATCH', seq, message });

  for (const row of rows) {
    if (!row.actorId || !row.actor) continue;
    const prefix = row.type === 'LOT_CREATED' || row.type === 'LOT_CANCELLED' ? 'V' : 'L';
    if (pseudonymFor(lot.id, row.actorId, prefix) !== row.actor) {
      mismatch(`O evento #${row.seq} foi reatribuído a outro usuário depois de registrado.`, row.seq);
    }
  }

  const genesis = rows[0];
  if (genesis?.type === 'LOT_CREATED') {
    const data = genesis.data as CreatedData;
    const terms: Array<[string, unknown, unknown]> = [
      ['lance inicial', data.startingPriceCents, lot.startingPriceCents.toString()],
      ['incremento mínimo', data.minIncrementCents, lot.minIncrementCents.toString()],
      ['início', data.startsAt, lot.startsAt.toISOString()],
      ['fim original', data.endsAt, lot.originalEndsAt.toISOString()],
      ['título', data.title, lot.title],
      ['item', data.item?.externalId, lot.item.externalId],
    ];
    for (const [label, signed, current] of terms) {
      if (signed !== current) mismatch(`As condições do lote foram alteradas: o ${label} atual difere do registrado na criação.`);
    }
  }

  const bids = rows.filter((row) => row.type === 'BID_PLACED');
  const lastBid = bids.at(-1);
  if (lot.bidCount !== bids.length) mismatch(`O lote diz ter ${lot.bidCount} lances, mas a cadeia registra ${bids.length}.`);
  if ((lot.currentPriceCents ?? null)?.toString() !== (lastBid?.amountCents ?? null)?.toString()) {
    mismatch('O lance atual do lote não corresponde ao último lance registrado.');
  }
  if ((lot.leaderId ?? null) !== (lastBid?.actorId ?? null)) mismatch('O líder do lote não corresponde ao autor do último lance.');
  const expectedEnd = (lastBid?.data as { endsAt?: string } | undefined)?.endsAt ?? lot.originalEndsAt.toISOString();
  if (lot.endsAt.toISOString() !== expectedEnd) mismatch('O horário de encerramento do lote não corresponde ao registrado na cadeia.');

  const last = rows.at(-1);
  if (!!lot.closedAt !== (last?.type === 'LOT_CLOSED')) mismatch('O estado de encerramento do lote não corresponde à cadeia.');
  if (!!lot.cancelledAt !== (last?.type === 'LOT_CANCELLED')) mismatch('O estado de cancelamento do lote não corresponde à cadeia.');
  if (last?.type === 'LOT_CLOSED' && (lot.winnerId ?? null) !== (last.actorId ?? null)) {
    mismatch('O vencedor registrado no lote não corresponde ao encerramento selado.');
  }
  return issues;
}

async function loadAndVerify(lotId: string) {
  const lot = await prisma.lot.findUnique({ where: { id: lotId }, include: { item: { select: { id: true, externalId: true } } } });
  if (!lot) throw notFound('Lote não encontrado.');
  const rows = await prisma.lotEvent.findMany({ where: { lotId }, orderBy: { seq: 'asc' } });
  const events = rows.map(toSignedEvent);
  const head = { length: lot.chainLength, hash: lot.chainHeadHash, signature: lot.chainHeadSignature };

  const chain = await verifyChain({ lotId, events, head, publicKey: auditSigner.publicKey }, crypto);
  const consistency = checkConsistency(lot, rows);
  return { lot, events, head, server: { ...chain, valid: chain.valid && consistency.length === 0, consistency } };
}

export async function getLotAudit(lotId: string, now = new Date()): Promise<AuditDTO> {
  const { lot, events, head, server } = await loadAndVerify(lotId);
  return {
    lot: {
      id: lot.id,
      number: lot.number,
      title: lot.title,
      imageUrl: imageUrlFor(lot.item.id),
      status: computeLotStatus(lot, now),
      startsAt: lot.startsAt.toISOString(),
      endsAt: lot.endsAt.toISOString(),
      closedAt: lot.closedAt?.toISOString() ?? null,
      cancelledAt: lot.cancelledAt?.toISOString() ?? null,
    },
    events,
    head,
    publicKey: auditSigner.publicKey,
    algorithm: AUDIT_ALGORITHM,
    server,
    verifiedAt: now.toISOString(),
  };
}

export async function getReceipt(code: string): Promise<ReceiptDTO> {
  const receipt = await prisma.receipt.findUnique({
    where: { code },
    include: { lot: { select: { item: { select: { id: true, subtitle: true } } } } },
  });
  if (!receipt) throw notFound('Comprovante não encontrado.');

  const content = receipt.content as unknown as ReceiptContent;
  const [server, audit] = await Promise.all([
    verifyReceipt({ receipt: content, hash: receipt.hash, signature: receipt.signature, publicKey: auditSigner.publicKey }, crypto),
    loadAndVerify(receipt.lotId),
  ]);
  // O comprovante aponta para o evento de encerramento: ele precisa existir na cadeia.
  const closeEvent = audit.events[content.closeEventSeq];
  const anchored = closeEvent?.hash === content.closeEventHash && closeEvent.type === 'LOT_CLOSED';

  return {
    receipt: content,
    hash: receipt.hash,
    signature: receipt.signature,
    publicKey: auditSigner.publicKey,
    lot: { imageUrl: imageUrlFor(receipt.lot.item.id), subtitle: receipt.lot.item.subtitle, chainValid: audit.server.valid && anchored },
    server,
  };
}
