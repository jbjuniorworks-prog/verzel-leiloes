import type { LotEvent } from '@prisma/client';
import type { CanonicalValue, LotEventType, SignedChainEvent } from '@leilao/shared';
import type { Tx } from '../../lib/prisma';
import { auditSigner } from './signer';

export interface ChainHeadFields {
  chainLength: number;
  chainHeadHash: string;
  chainHeadSignature: string;
}

export interface NewLotEvent {
  type: LotEventType;
  occurredAt: Date;
  actorId: string | null;
  actor: string | null;
  amountCents: bigint | null;
  data: { [key: string]: CanonicalValue };
}

/**
 * Monta e assina o próximo evento da cadeia a partir da cabeça atual do lote.
 * Deve ser chamado com o lote travado (SELECT ... FOR UPDATE), senão dois eventos
 * poderiam disputar o mesmo seq.
 */
export function sealNextEvent(lot: { id: string; chainLength: number; chainHeadHash: string }, input: NewLotEvent) {
  const event = auditSigner.sealEvent({
    lotId: lot.id,
    seq: lot.chainLength,
    type: input.type,
    occurredAt: input.occurredAt.toISOString(),
    actor: input.actor,
    amountCents: input.amountCents === null ? null : input.amountCents.toString(),
    data: input.data,
    prevHash: lot.chainHeadHash,
  });
  const length = event.seq + 1;
  const head: ChainHeadFields = {
    chainLength: length,
    chainHeadHash: event.hash,
    chainHeadSignature: auditSigner.signHead(lot.id, length, event.hash),
  };
  return { event, head };
}

export async function insertEvent(tx: Tx, event: SignedChainEvent, input: NewLotEvent) {
  await tx.lotEvent.create({
    data: {
      lotId: event.lotId,
      seq: event.seq,
      type: event.type,
      occurredAt: input.occurredAt,
      actorId: input.actorId,
      actor: event.actor,
      amountCents: input.amountCents,
      data: event.data,
      prevHash: event.prevHash,
      hash: event.hash,
      signature: event.signature,
    },
  });
}

/** Linha do banco → formato público da cadeia (sem actorId). */
export function toSignedEvent(row: LotEvent): SignedChainEvent {
  return {
    lotId: row.lotId,
    seq: row.seq,
    type: row.type,
    occurredAt: row.occurredAt.toISOString(),
    actor: row.actor,
    amountCents: row.amountCents === null ? null : row.amountCents.toString(),
    data: row.data as { [key: string]: CanonicalValue },
    prevHash: row.prevHash,
    hash: row.hash,
    signature: row.signature,
  };
}
