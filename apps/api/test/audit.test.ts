import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { getLotAudit, getReceipt } from '../src/modules/audit/audit.service';
import { placeBid } from '../src/modules/bids/bids.service';
import { settleLot } from '../src/modules/settlement/settlement.service';
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

  it('detecta descrição do lote trocada direto na tabela (ela é exibida na sala)', async () => {
    await prisma.$executeRawUnsafe(`UPDATE lots SET description = 'Near Mint, nunca usada' WHERE id = '${lotId}'`);
    expect((await issues()).codes).toEqual(['STATE_MISMATCH']);
  });

  it('a auditoria pública não expõe dados pessoais', async () => {
    const body = JSON.stringify(await getLotAudit(lotId));
    expect(body).not.toContain(ana.id);
    expect(body).not.toContain('@teste.com');
  });
});

/**
 * Limite conhecido, documentado no README (seção 6): a cabeça assinada de cada lote é pública.
 * Quem tem acesso de escrita ao banco e guardou uma cabeça antiga pode "voltar" o lote até ela:
 * cada peça é genuinamente assinada, então a cadeia sozinha não distingue isso de um lote que
 * de fato parou ali. Estes testes fixam o limite e mostram onde o comprovante serve de âncora.
 */
describe('limites conhecidos: volta do lote a uma cabeça assinada antiga', () => {
  beforeEach(resetDatabase);

  async function scenario({ end }: { end: number }) {
    const seller = await createUser('AUCTIONEER');
    const ana = await createUser('BIDDER', 1_000);
    const bruno = await createUser('BIDDER', 1_000);
    const lot = await createTestLot(seller.id, { end });
    await placeBid({ lotId: lot.id, bidderId: ana.id, amountCents: 10_000, now: at(0) });
    await placeBid({ lotId: lot.id, bidderId: bruno.id, amountCents: 20_000, now: at(1) });
    // O "atacante" guarda a cabeça pública deste momento (o que GET /api/audit/lots/:id devolve).
    const savedHead = (await getLotAudit(lot.id)).head;
    const savedEndsAt = (await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).endsAt;
    await placeBid({ lotId: lot.id, bidderId: ana.id, amountCents: 30_000, now: at(2) });

    const rollBack = async (fromSeq: number) => {
      await tamper(`DELETE FROM lot_events WHERE lot_id = '${lot.id}' AND seq >= ${fromSeq}`);
      await prisma.$executeRawUnsafe(
        `UPDATE lots SET chain_length = ${savedHead.length}, chain_head_hash = '${savedHead.hash}', chain_head_signature = '${savedHead.signature}',
           current_price_cents = 20000, leader_id = '${bruno.id}', bid_count = 2, ends_at = '${savedEndsAt.toISOString()}',
           closed_at = NULL, winner_id = NULL, final_price_cents = NULL WHERE id = '${lot.id}'`,
      );
    };
    return { lot, rollBack };
  }

  it('lote ao vivo: a cadeia sozinha não detecta a volta (por isso o README recomenda ancorar fora do banco)', async () => {
    const { lot, rollBack } = await scenario({ end: 60 });
    await rollBack(3);
    expect((await getLotAudit(lot.id)).server.valid).toBe(true);
  });

  it('lote encerrado: o comprovante do vencedor ancora o encerramento e denuncia a volta', async () => {
    const { lot, rollBack } = await scenario({ end: 5 });
    expect(await settleLot(lot.id, at(5))).toBe(true);
    const { code } = await prisma.receipt.findUniqueOrThrow({ where: { lotId: lot.id } });
    expect((await getReceipt(code)).lot.chainValid).toBe(true);

    await rollBack(3); // apaga o último lance e o encerramento
    expect((await getLotAudit(lot.id)).server.valid).toBe(true); // a cadeia, sozinha, parece íntegra…
    const receipt = await getReceipt(code);
    expect(receipt.server.valid).toBe(true); // …o comprovante continua autêntico…
    expect(receipt.lot.chainValid).toBe(false); // …e não encontra mais o encerramento que ele assinou.
  });
});
