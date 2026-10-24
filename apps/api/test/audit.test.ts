import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { getLotAudit } from '../src/modules/audit/audit.service';
import { placeBid } from '../src/modules/bids/bids.service';
import { at, createTestLot, createUser, resetDatabase, tamper } from './helpers';

/**
 * Simula alguém com acesso direto ao banco tentando reescrever a história.
 * Todas as alterações são feitas com SQL cru e o trigger append-only desligado.
 */
describe('histórico à prova de adulteração', () => {
  let lotId: string;
  let ana: { id: string };
  let bruno: { id: string };

  const issues = async () => {
    const audit = await getLotAudit(lotId);
    return { valid: audit.server.valid, codes: [...audit.server.issues, ...audit.server.consistency].map((issue) => issue.code) };
  };

  beforeEach(async () => {
    await resetDatabase();
    const seller = await createUser('AUCTIONEER');
    ana = await createUser('BIDDER', 1_000);
    bruno = await createUser('BIDDER', 1_000);
    const lot = await createTestLot(seller.id);
    lotId = lot.id;
    await placeBid({ lotId, bidderId: ana.id, amountCents: 10_000, now: at(0) });
    await placeBid({ lotId, bidderId: bruno.id, amountCents: 20_000, now: at(1) });
    await placeBid({ lotId, bidderId: ana.id, amountCents: 30_000, now: at(2) });
  });

  it('histórico íntegro passa na auditoria', async () => {
    expect(await issues()).toEqual({ valid: true, codes: [] });
  });

  it('o trigger bloqueia UPDATE/DELETE feito sem desligá-lo', async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE lot_events SET amount_cents = 1 WHERE lot_id = '${lotId}'`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM lot_events WHERE lot_id = '${lotId}'`)).rejects.toThrow(/append-only/);
  });

  it('detecta valor de lance alterado', async () => {
    await tamper(`UPDATE lot_events SET amount_cents = 15000 WHERE lot_id = '${lotId}' AND seq = 2`);
    expect(await issues()).toMatchObject({ valid: false, codes: expect.arrayContaining(['HASH_MISMATCH']) });
  });

  it('detecta horário de lance alterado', async () => {
    await tamper(`UPDATE lot_events SET occurred_at = occurred_at - interval '1 hour' WHERE lot_id = '${lotId}' AND seq = 3`);
    expect((await issues()).codes).toContain('HASH_MISMATCH');
  });

  it('detecta lance removido do meio', async () => {
    await tamper(`DELETE FROM lot_events WHERE lot_id = '${lotId}' AND seq = 2`);
    expect((await issues()).codes).toEqual(expect.arrayContaining(['SEQUENCE_GAP', 'BROKEN_LINK', 'HEAD_LENGTH_MISMATCH']));
  });

  it('detecta remoção do último lance mesmo com o lote "consertado"', async () => {
    const previous = await prisma.lotEvent.findFirstOrThrow({ where: { lotId, seq: 2 } });
    await tamper(`DELETE FROM lot_events WHERE lot_id = '${lotId}' AND seq = 3`);
    await prisma.$executeRawUnsafe(
      `UPDATE lots SET chain_length = 3, chain_head_hash = '${previous.hash}', current_price_cents = 20000, leader_id = '${bruno.id}', bid_count = 2 WHERE id = '${lotId}'`,
    );
    expect((await issues()).codes).toEqual(['BAD_HEAD_SIGNATURE']);
  });

  it('detecta lance inserido (copiado de outro evento)', async () => {
    await tamper(
      `INSERT INTO lot_events (lot_id, seq, type, occurred_at, actor_id, actor, amount_cents, data, prev_hash, hash, signature)
       SELECT lot_id, 4, type, occurred_at + interval '1 minute', actor_id, actor, 99900, data, hash, md5(random()::text) || md5(random()::text), signature
       FROM lot_events WHERE lot_id = '${lotId}' AND seq = 3`,
    );
    expect((await issues()).codes).toEqual(expect.arrayContaining(['HASH_MISMATCH', 'BAD_SIGNATURE', 'HEAD_LENGTH_MISMATCH']));
  });

  it('detecta lance reatribuído a outro usuário', async () => {
    await tamper(`UPDATE lot_events SET actor_id = '${bruno.id}' WHERE lot_id = '${lotId}' AND seq = 3`);
    expect((await issues()).codes).toContain('STATE_MISMATCH');
  });

  it('detecta preço/líder do lote alterados direto na tabela de lotes', async () => {
    await prisma.$executeRawUnsafe(`UPDATE lots SET current_price_cents = 99999, leader_id = '${bruno.id}' WHERE id = '${lotId}'`);
    expect((await issues()).codes).toContain('STATE_MISMATCH');
  });

  it('detecta condições do lote alteradas (lance inicial)', async () => {
    await prisma.$executeRawUnsafe(`UPDATE lots SET starting_price_cents = 1 WHERE id = '${lotId}'`);
    expect((await issues()).codes).toContain('STATE_MISMATCH');
  });

  it('a auditoria pública não expõe dados pessoais', async () => {
    const body = JSON.stringify(await getLotAudit(lotId));
    expect(body).not.toContain(ana.id);
    expect(body).not.toContain('@teste.com');
  });
});
