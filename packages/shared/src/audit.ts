/**
 * Histórico à prova de adulteração.
 *
 * Cada lote tem um log de eventos append-only (criação, lances, encerramento ou
 * cancelamento). Cada evento:
 *   1. é serializado de forma canônica (chaves ordenadas, valores sem ambiguidade);
 *   2. inclui o hash do evento anterior (prevHash) → encadeamento: mexer em um
 *      evento quebra todos os seguintes;
 *   3. recebe hash = SHA-256(serialização canônica);
 *   4. é assinado com Ed25519 pela chave privada do servidor, que NÃO fica no banco.
 *
 * Quem altera o banco direto até consegue recalcular os hashes, mas não consegue
 * assinar sem a chave privada. A "cabeça" da cadeia (tamanho + último hash) também
 * é assinada e guardada no lote, o que detecta remoção dos últimos eventos.
 *
 * Este arquivo roda igual no servidor (Node) e no navegador (WebCrypto), então a
 * página pública de auditoria não precisa confiar no veredito do servidor.
 */

export const AUDIT_VERSION = 1;
export const GENESIS_HASH = '0'.repeat(64);

export type LotEventType = 'LOT_CREATED' | 'BID_PLACED' | 'LOT_CLOSED' | 'LOT_CANCELLED';

export type CanonicalValue = string | number | boolean | null | CanonicalValue[] | { [key: string]: CanonicalValue };

/** Campos cobertos pelo hash. */
export interface ChainEventContent {
  lotId: string;
  seq: number;
  type: LotEventType;
  /** ISO-8601 em UTC com milissegundos. */
  occurredAt: string;
  /** Pseudônimo de quem gerou o evento (nunca dados pessoais). */
  actor: string | null;
  /** Valor em centavos como string, para não depender de precisão numérica. */
  amountCents: string | null;
  data: { [key: string]: CanonicalValue };
  prevHash: string;
}

export interface SignedChainEvent extends ChainEventContent {
  hash: string;
  /** Assinatura Ed25519 em base64. */
  signature: string;
}

export interface ChainHead {
  length: number;
  hash: string;
  signature: string;
}

const TERMINAL_EVENTS: ReadonlySet<LotEventType> = new Set(['LOT_CLOSED', 'LOT_CANCELLED']);

export function canonicalize(value: CanonicalValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('canonicalize: só inteiros seguros são aceitos');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;

  const entries = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key] as CanonicalValue)}`);
  return `{${entries.join(',')}}`;
}

export function eventPreimage(event: ChainEventContent): string {
  return canonicalize({
    v: AUDIT_VERSION,
    lotId: event.lotId,
    seq: event.seq,
    type: event.type,
    occurredAt: event.occurredAt,
    actor: event.actor,
    amountCents: event.amountCents,
    data: event.data,
    prevHash: event.prevHash,
  });
}

// Prefixos diferentes para cada tipo de assinatura (domain separation): uma assinatura
// de evento nunca pode ser reaproveitada como assinatura de cabeça ou de comprovante.
export const eventSigningMessage = (hash: string) => `martelo:event:v${AUDIT_VERSION}:${hash}`;
export const headSigningMessage = (lotId: string, length: number, hash: string) => `martelo:head:v${AUDIT_VERSION}:${lotId}:${length}:${hash}`;
export const receiptSigningMessage = (hash: string) => `martelo:receipt:v${AUDIT_VERSION}:${hash}`;

/* ------------------------------------------------------------------ crypto */

export interface AuditCrypto {
  sha256Hex(text: string): Promise<string>;
  /** Lança erro (e não retorna false) se o ambiente não suportar Ed25519. */
  verifyEd25519(message: string, signatureB64: string, publicKeyB64: string): Promise<boolean>;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class Ed25519UnsupportedError extends Error {
  constructor() {
    super('Este ambiente não suporta verificação Ed25519 via WebCrypto.');
  }
}

/** Implementação com WebCrypto — funciona no navegador e no Node 22+. */
export function createWebAuditCrypto(subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle): AuditCrypto {
  if (!subtle) throw new Ed25519UnsupportedError();
  const encoder = new TextEncoder();
  const keys = new Map<string, Promise<CryptoKey>>();

  const importKey = (publicKeyB64: string) => {
    let key = keys.get(publicKeyB64);
    if (!key) {
      key = subtle.importKey('raw', base64ToBytes(publicKeyB64), { name: 'Ed25519' }, false, ['verify']);
      keys.set(publicKeyB64, key);
    }
    return key;
  };

  return {
    async sha256Hex(text) {
      const digest = await subtle.digest('SHA-256', encoder.encode(text));
      return bytesToHex(new Uint8Array(digest));
    },
    async verifyEd25519(message, signatureB64, publicKeyB64) {
      let key: CryptoKey;
      try {
        key = await importKey(publicKeyB64);
      } catch (error) {
        if (error instanceof Error && error.name === 'NotSupportedError') throw new Ed25519UnsupportedError();
        return false;
      }
      try {
        return await subtle.verify({ name: 'Ed25519' }, key, base64ToBytes(signatureB64), encoder.encode(message));
      } catch {
        // Assinatura malformada (base64 inválido, tamanho errado) = assinatura inválida.
        return false;
      }
    },
  };
}

/* ------------------------------------------------------------ verificação */

export type ChainIssueCode =
  | 'EMPTY_CHAIN'
  | 'MISSING_GENESIS'
  | 'WRONG_LOT'
  | 'SEQUENCE_GAP'
  | 'EVENT_OUT_OF_PLACE'
  | 'HASH_MISMATCH'
  | 'BROKEN_LINK'
  | 'BAD_SIGNATURE'
  | 'HEAD_LENGTH_MISMATCH'
  | 'HEAD_HASH_MISMATCH'
  | 'BAD_HEAD_SIGNATURE'
  | 'STATE_MISMATCH';

export interface ChainIssue {
  code: ChainIssueCode;
  seq: number | null;
  message: string;
}

export interface EventCheck {
  seq: number;
  hashValid: boolean;
  linkValid: boolean;
  signatureValid: boolean;
}

export interface ChainVerification {
  valid: boolean;
  checkedEvents: number;
  issues: ChainIssue[];
  events: EventCheck[];
  head: { lengthValid: boolean; hashValid: boolean; signatureValid: boolean };
}

export async function verifyChain(
  input: { lotId: string; events: SignedChainEvent[]; head: ChainHead; publicKey: string },
  crypto: AuditCrypto,
): Promise<ChainVerification> {
  const { lotId, events, head, publicKey } = input;
  const issues: ChainIssue[] = [];
  const checks: EventCheck[] = [];

  if (events.length === 0) {
    issues.push({ code: 'EMPTY_CHAIN', seq: null, message: 'O lote não tem nenhum evento registrado — o histórico foi apagado.' });
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    const previous = i > 0 ? events[i - 1]! : null;

    if (event.lotId !== lotId) {
      issues.push({ code: 'WRONG_LOT', seq: event.seq, message: `O evento #${event.seq} pertence a outro lote e foi inserido neste histórico.` });
    }
    if (event.seq !== i) {
      issues.push({
        code: 'SEQUENCE_GAP',
        seq: event.seq,
        message: `Era esperado o evento #${i}, mas foi encontrado o #${event.seq}: há evento removido ou inserido.`,
      });
    }
    if (i === 0 && event.type !== 'LOT_CREATED') {
      issues.push({ code: 'MISSING_GENESIS', seq: event.seq, message: 'O primeiro evento deveria ser a criação do lote.' });
    }
    if (i > 0 && event.type === 'LOT_CREATED') {
      issues.push({ code: 'EVENT_OUT_OF_PLACE', seq: event.seq, message: `O evento #${event.seq} é uma segunda criação do lote.` });
    }
    if (previous && TERMINAL_EVENTS.has(previous.type)) {
      issues.push({
        code: 'EVENT_OUT_OF_PLACE',
        seq: event.seq,
        message: `O evento #${event.seq} aparece depois do encerramento/cancelamento do lote.`,
      });
    }

    const linkValid = event.prevHash === (previous ? previous.hash : GENESIS_HASH);
    if (!linkValid) {
      issues.push({
        code: 'BROKEN_LINK',
        seq: event.seq,
        message: `O evento #${event.seq} não aponta para o hash do evento anterior: a corrente foi quebrada.`,
      });
    }

    const hashValid = (await crypto.sha256Hex(eventPreimage(event))) === event.hash;
    if (!hashValid) {
      issues.push({
        code: 'HASH_MISMATCH',
        seq: event.seq,
        message: `O conteúdo do evento #${event.seq} foi alterado depois de registrado (hash não confere).`,
      });
    }

    const signatureValid = await crypto.verifyEd25519(eventSigningMessage(event.hash), event.signature, publicKey);
    if (!signatureValid) {
      issues.push({
        code: 'BAD_SIGNATURE',
        seq: event.seq,
        message: `A assinatura do evento #${event.seq} é inválida: ele não foi emitido pelo servidor do leilão.`,
      });
    }

    checks.push({ seq: event.seq, hashValid, linkValid, signatureValid });
  }

  const last = events.at(-1);
  const headLengthValid = head.length === events.length;
  if (!headLengthValid) {
    issues.push({
      code: 'HEAD_LENGTH_MISMATCH',
      seq: null,
      message: `O lote registra ${head.length} eventos, mas o histórico tem ${events.length}: eventos foram removidos ou inseridos.`,
    });
  }
  const headHashValid = !!last && head.hash === last.hash;
  if (!headHashValid) {
    issues.push({ code: 'HEAD_HASH_MISMATCH', seq: null, message: 'O último evento do histórico não é o último evento selado no lote.' });
  }
  const headSignatureValid = await crypto.verifyEd25519(headSigningMessage(lotId, head.length, head.hash), head.signature, publicKey);
  if (!headSignatureValid) {
    issues.push({ code: 'BAD_HEAD_SIGNATURE', seq: null, message: 'A assinatura da cabeça da cadeia é inválida: o selo do lote foi forjado.' });
  }

  return {
    valid: issues.length === 0,
    checkedEvents: events.length,
    issues,
    events: checks,
    head: { lengthValid: headLengthValid, hashValid: headHashValid, signatureValid: headSignatureValid },
  };
}

/* ------------------------------------------------------------ comprovante */

export interface ReceiptContent {
  code: string;
  lotId: string;
  lotNumber: number;
  itemTitle: string;
  /** Pseudônimo do vencedor neste lote. */
  winner: string;
  amountCents: string;
  currency: 'BRL';
  closedAt: string;
  closeEventSeq: number;
  closeEventHash: string;
  issuedAt: string;
}

export function receiptPreimage(receipt: ReceiptContent): string {
  return canonicalize({ v: AUDIT_VERSION, kind: 'receipt', ...receipt });
}

export async function verifyReceipt(
  input: { receipt: ReceiptContent; hash: string; signature: string; publicKey: string },
  crypto: AuditCrypto,
): Promise<{ valid: boolean; hashValid: boolean; signatureValid: boolean }> {
  const hashValid = (await crypto.sha256Hex(receiptPreimage(input.receipt))) === input.hash;
  const signatureValid = await crypto.verifyEd25519(receiptSigningMessage(input.hash), input.signature, input.publicKey);
  return { valid: hashValid && signatureValid, hashValid, signatureValid };
}
