import { createHash, createHmac, createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto';
import {
  eventPreimage,
  eventSigningMessage,
  headSigningMessage,
  receiptPreimage,
  receiptSigningMessage,
  type ChainEventContent,
  type ReceiptContent,
  type SignedChainEvent,
} from '@leilao/shared';
import { env } from '../../config/env';

// Prefixo DER PKCS#8 de uma chave Ed25519: permite guardar só a semente de 32 bytes no env.
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

class AuditSigner {
  private readonly privateKey: KeyObject;
  /** Chave pública Ed25519 crua (32 bytes) em base64 — publicada na página de auditoria. */
  readonly publicKey: string;

  constructor(seedBase64: string) {
    this.privateKey = createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seedBase64, 'base64')]),
      format: 'der',
      type: 'pkcs8',
    });
    const spki = createPublicKey(this.privateKey).export({ format: 'der', type: 'spki' });
    this.publicKey = spki.subarray(-32).toString('base64');
  }

  sha256Hex(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
  }

  private sign(message: string): string {
    return sign(null, Buffer.from(message, 'utf8'), this.privateKey).toString('base64');
  }

  sealEvent(content: ChainEventContent): SignedChainEvent {
    const hash = this.sha256Hex(eventPreimage(content));
    return { ...content, hash, signature: this.sign(eventSigningMessage(hash)) };
  }

  signHead(lotId: string, length: number, hash: string): string {
    return this.sign(headSigningMessage(lotId, length, hash));
  }

  sealReceipt(content: ReceiptContent): { hash: string; signature: string } {
    const hash = this.sha256Hex(receiptPreimage(content));
    return { hash, signature: this.sign(receiptSigningMessage(hash)) };
  }
}

export const auditSigner = new AuditSigner(env.AUDIT_PRIVATE_KEY);

/**
 * Pseudônimo estável por (lote, usuário): o mesmo licitante aparece sempre com o
 * mesmo código dentro de um lote, mas com códigos diferentes em lotes diferentes —
 * ninguém consegue montar o histórico de compras de uma pessoa pela auditoria.
 * É um HMAC com segredo do servidor, então não dá para reverter para o id do usuário.
 */
export function pseudonymFor(lotId: string, userId: string, prefix: 'L' | 'V' = 'L'): string {
  const digest = createHmac('sha256', env.PSEUDONYM_SECRET).update(`${lotId}:${userId}`).digest('hex');
  return `${prefix}-${digest.slice(0, 8).toUpperCase()}`;
}
