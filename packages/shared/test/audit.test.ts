import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  GENESIS_HASH,
  canonicalize,
  createWebAuditCrypto,
  eventPreimage,
  eventSigningMessage,
  headSigningMessage,
  receiptPreimage,
  receiptSigningMessage,
  verifyChain,
  verifyReceipt,
  type ChainEventContent,
  type ChainHead,
  type ReceiptContent,
  type SignedChainEvent,
} from '../src/audit';

const LOT_ID = '6f1c1f43-2f57-4c51-9a83-0c4f1a1b2c3d';
const crypto = createWebAuditCrypto();

let privateKey: KeyObject;
let publicKey: string;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const signText = (text: string) => sign(null, Buffer.from(text, 'utf8'), privateKey).toString('base64');

function seal(content: ChainEventContent): SignedChainEvent {
  const hash = sha256(eventPreimage(content));
  return { ...content, hash, signature: signText(eventSigningMessage(hash)) };
}

function headFor(events: SignedChainEvent[]): ChainHead {
  const last = events.at(-1)!;
  return { length: events.length, hash: last.hash, signature: signText(headSigningMessage(LOT_ID, events.length, last.hash)) };
}

function buildChain(): SignedChainEvent[] {
  const specs: Array<Pick<ChainEventContent, 'type' | 'actor' | 'amountCents' | 'data'>> = [
    { type: 'LOT_CREATED', actor: 'L-SELLER01', amountCents: null, data: { startingPriceCents: '10000', minIncrementCents: '500' } },
    { type: 'BID_PLACED', actor: 'L-AAAA1111', amountCents: '10000', data: { endsAt: '2026-10-30T12:00:00.000Z', extended: false } },
    { type: 'BID_PLACED', actor: 'L-BBBB2222', amountCents: '10500', data: { endsAt: '2026-10-30T12:00:00.000Z', extended: false } },
    { type: 'BID_PLACED', actor: 'L-AAAA1111', amountCents: '12000', data: { endsAt: '2026-10-30T12:00:00.000Z', extended: false } },
  ];
  const events: SignedChainEvent[] = [];
  specs.forEach((spec, seq) => {
    events.push(
      seal({
        lotId: LOT_ID,
        seq,
        occurredAt: new Date(Date.UTC(2026, 9, 24, 12, seq)).toISOString(),
        prevHash: events.at(-1)?.hash ?? GENESIS_HASH,
        ...spec,
      }),
    );
  });
  return events;
}

const codes = (result: { issues: { code: string }[] }) => result.issues.map((issue) => issue.code);

beforeAll(() => {
  const pair = generateKeyPairSync('ed25519');
  privateKey = pair.privateKey;
  publicKey = Buffer.from(pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)).toString('base64');
});

describe('canonicalize', () => {
  it('ordena chaves e é estável independente da ordem de inserção', () => {
    expect(canonicalize({ b: 1, a: { d: true, c: null } })).toBe('{"a":{"c":null,"d":true},"b":1}');
    expect(canonicalize({ a: { c: null, d: true }, b: 1 })).toBe(canonicalize({ b: 1, a: { d: true, c: null } }));
  });

  it('recusa números não inteiros (dinheiro sempre em centavos)', () => {
    expect(() => canonicalize({ amount: 10.5 })).toThrow();
  });
});

describe('verifyChain', () => {
  it('aceita um histórico íntegro', async () => {
    const events = buildChain();
    const result = await verifyChain({ lotId: LOT_ID, events, head: headFor(events), publicKey }, crypto);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.checkedEvents).toBe(4);
  });

  it('detecta alteração de valor de um lance (hash não confere)', async () => {
    const events = buildChain();
    const head = headFor(events);
    events[2] = { ...events[2]!, amountCents: '99999' };
    const result = await verifyChain({ lotId: LOT_ID, events, head, publicKey }, crypto);
    expect(result.valid).toBe(false);
    expect(codes(result)).toContain('HASH_MISMATCH');
    expect(result.issues.find((issue) => issue.code === 'HASH_MISMATCH')?.seq).toBe(2);
  });

  it('detecta alteração mesmo quando o atacante recalcula todos os hashes', async () => {
    const original = buildChain();
    const head = headFor(original);
    // Atacante com acesso ao banco: troca o valor e refaz a corrente inteira, mas não tem a chave privada.
    const forged: SignedChainEvent[] = [];
    original.forEach((event, i) => {
      const content: ChainEventContent = {
        ...event,
        amountCents: i === 2 ? '99999' : event.amountCents,
        prevHash: forged.at(-1)?.hash ?? GENESIS_HASH,
      };
      forged.push({ ...content, hash: sha256(eventPreimage(content)), signature: event.signature });
    });
    const result = await verifyChain({ lotId: LOT_ID, events: forged, head: { ...head, hash: forged.at(-1)!.hash }, publicKey }, crypto);
    expect(result.valid).toBe(false);
    expect(codes(result)).toContain('BAD_SIGNATURE');
    expect(codes(result)).toContain('BAD_HEAD_SIGNATURE');
    expect(codes(result)).not.toContain('HASH_MISMATCH');
  });

  it('detecta remoção de um lance do meio', async () => {
    const events = buildChain();
    const head = headFor(events);
    const tampered = events.filter((event) => event.seq !== 2);
    const result = await verifyChain({ lotId: LOT_ID, events: tampered, head, publicKey }, crypto);
    expect(result.valid).toBe(false);
    expect(codes(result)).toEqual(expect.arrayContaining(['SEQUENCE_GAP', 'BROKEN_LINK', 'HEAD_LENGTH_MISMATCH']));
  });

  it('detecta remoção do último lance (truncamento)', async () => {
    const events = buildChain();
    const head = headFor(events);
    const result = await verifyChain({ lotId: LOT_ID, events: events.slice(0, -1), head, publicKey }, crypto);
    expect(codes(result)).toEqual(expect.arrayContaining(['HEAD_LENGTH_MISMATCH', 'HEAD_HASH_MISMATCH']));
  });

  it('detecta truncamento mesmo quando a cabeça do lote é reescrita', async () => {
    const events = buildChain().slice(0, -1);
    const forgedHead: ChainHead = { length: events.length, hash: events.at(-1)!.hash, signature: events.at(-1)!.signature };
    const result = await verifyChain({ lotId: LOT_ID, events, head: forgedHead, publicKey }, crypto);
    expect(codes(result)).toEqual(['BAD_HEAD_SIGNATURE']);
  });

  it('detecta inserção de lance forjado', async () => {
    const events = buildChain();
    const head = headFor(events);
    const content: ChainEventContent = {
      lotId: LOT_ID,
      seq: 4,
      type: 'BID_PLACED',
      occurredAt: new Date().toISOString(),
      actor: 'L-CCCC3333',
      amountCents: '50000',
      data: {},
      prevHash: events.at(-1)!.hash,
    };
    const forged = { ...content, hash: sha256(eventPreimage(content)), signature: events[0]!.signature };
    const result = await verifyChain({ lotId: LOT_ID, events: [...events, forged], head, publicKey }, crypto);
    expect(codes(result)).toEqual(expect.arrayContaining(['BAD_SIGNATURE', 'HEAD_LENGTH_MISMATCH', 'HEAD_HASH_MISMATCH']));
  });

  it('recusa assinaturas feitas com outra chave', async () => {
    const events = buildChain();
    const other = generateKeyPairSync('ed25519');
    const otherPublic = Buffer.from(other.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)).toString('base64');
    const result = await verifyChain({ lotId: LOT_ID, events, head: headFor(events), publicKey: otherPublic }, crypto);
    expect(result.valid).toBe(false);
    expect(result.events.every((check) => !check.signatureValid)).toBe(true);
  });
});

describe('verifyReceipt', () => {
  const receipt: ReceiptContent = {
    code: 'abc123',
    lotId: LOT_ID,
    lotNumber: 7,
    itemTitle: 'Black Lotus',
    winner: 'L-AAAA1111',
    amountCents: '12000',
    currency: 'BRL',
    closedAt: '2026-10-30T12:00:00.000Z',
    closeEventSeq: 4,
    closeEventHash: 'f'.repeat(64),
    issuedAt: '2026-10-30T12:00:00.000Z',
  };

  it('valida comprovante assinado e detecta valor alterado', async () => {
    const hash = sha256(receiptPreimage(receipt));
    const signature = signText(receiptSigningMessage(hash));
    expect((await verifyReceipt({ receipt, hash, signature, publicKey }, crypto)).valid).toBe(true);

    const tampered = await verifyReceipt({ receipt: { ...receipt, amountCents: '1' }, hash, signature, publicKey }, crypto);
    expect(tampered).toEqual({ valid: false, hashValid: false, signatureValid: true });
  });
});
