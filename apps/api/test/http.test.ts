import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LotRealtimeUpdate } from '@leilao/shared';
import { createApp } from '../src/app';
import { placeBid } from '../src/modules/bids/bids.service';
import { attachSocketServer } from '../src/realtime/socket';
import { bindRealtimeServer } from '../src/realtime/emitter';
import { createItem, createLiveLotNow, createUser, resetDatabase, wallet } from './helpers';

const app = createApp();

async function loginAgent(role: 'AUCTIONEER' | 'BIDDER', email = `${role.toLowerCase()}-${crypto.randomUUID()}@teste.com`) {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/register').send({ name: 'Pessoa Teste', email, password: 'senha-forte-123', role });
  expect(response.status).toBe(201);
  return { agent, user: response.body.user as { id: string } };
}

describe('API HTTP', () => {
  beforeEach(resetDatabase);

  it('cadastro, sessão em cookie httpOnly e /me', async () => {
    const agent = request.agent(app);
    const register = await agent.post('/api/auth/register').send({ name: 'Ana', email: 'ana@teste.com', password: 'senha-forte-123', role: 'BIDDER' });
    expect(register.headers['set-cookie']?.[0]).toMatch(/martelo_session=.*HttpOnly/i);

    const me = await agent.get('/api/auth/me');
    expect(me.body.user.email).toBe('ana@teste.com');
    expect(me.body.wallet).toEqual({ balanceCents: 0, committedCents: 0, availableCents: 0 });

    expect((await request(app).get('/api/auth/me')).body).toBeNull();
    expect((await request(app).post('/api/auth/login').send({ email: 'ana@teste.com', password: 'errada' })).status).toBe(401);
  });

  it('valida entrada com mensagens legíveis', async () => {
    const response = await request(app).post('/api/auth/register').send({ name: 'A', email: 'x', password: '1', role: 'BIDDER' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');

    // Regras sem mensagem própria também respondem em português, dizendo o campo.
    const longName = await request(app)
      .post('/api/auth/register')
      .send({ name: 'a'.repeat(81), email: 'b@teste.com', password: 'senha-forte-123', role: 'BIDDER' });
    expect(longName.body.error.message).toBe('Nome: use no máximo 80 caracteres.');
    expect((await request(app).get('/api/lots?minPrice=-1')).body.error.message).toBe('Preço mínimo: o mínimo é 0.');
    expect((await request(app).get('/api/lots?minPrice=10.5')).body.error.message).toBe('Preço mínimo: use um número inteiro.');
    expect((await request(app).get('/api/lots?status=x')).body.error.message).toBe('Situação: valor inválido. Opções: live, scheduled, ended.');
  });

  it('papéis: leiloeiro não dá lance nem deposita; licitante não cria lote', async () => {
    const { agent: auctioneer, user: seller } = await loginAgent('AUCTIONEER');
    const { agent: bidder } = await loginAgent('BIDDER');
    const live = await createLiveLotNow(seller.id);

    expect((await auctioneer.post(`/api/lots/${live.id}/bids`).send({ amountCents: 10_000 })).body.error.code).toBe('ROLE_NOT_ALLOWED');
    expect((await auctioneer.post('/api/wallet/deposits').send({ amountCents: 10_000 })).status).toBe(403);
    expect((await bidder.post('/api/lots').send({})).status).toBe(403);
    expect((await request(app).post(`/api/lots/${live.id}/bids`).send({ amountCents: 10_000 })).status).toBe(401);
  });

  it('quem é o usuário vem da sessão: o corpo da requisição não troca usuário, saldo nem papel', async () => {
    const { agent: owner, user: seller } = await loginAgent('AUCTIONEER');
    const { agent: otherAuctioneer } = await loginAgent('AUCTIONEER');
    const { agent: ana, user: anaUser } = await loginAgent('BIDDER');
    const { user: brunoUser } = await loginAgent('BIDDER');
    const live = await createLiveLotNow(seller.id);

    // Sem sessão, nada privado responde.
    const anonymous = request(app);
    for (const [method, path] of [
      ['get', '/api/wallet'],
      ['post', '/api/wallet/deposits'],
      ['get', '/api/me/participations'],
      ['get', '/api/auctioneer/dashboard'],
      ['post', '/api/lots'],
      ['post', `/api/lots/${live.id}/cancel`],
    ] as const) {
      expect((await anonymous[method](path).send({})).status, `${method} ${path}`).toBe(401);
    }

    // Licitante não cancela; outro leiloeiro também não (só o dono do lote).
    expect((await ana.post(`/api/lots/${live.id}/cancel`).send({})).body.error.code).toBe('ROLE_NOT_ALLOWED');
    expect((await otherAuctioneer.post(`/api/lots/${live.id}/cancel`).send({})).body.error.code).toBe('NOT_OWNER');
    expect((await ana.get('/api/auctioneer/dashboard')).status).toBe(403);

    // Não existe rota de liquidação: ela só roda no agendador do servidor.
    expect((await owner.post(`/api/lots/${live.id}/settle`).send({})).status).toBe(404);
    expect((await owner.post(`/api/lots/${live.id}/close`).send({})).status).toBe(404);

    // Campos extras no corpo são ignorados: o depósito e o lance são da Ana, nunca do Bruno.
    await ana.post('/api/wallet/deposits').send({ amountCents: 50_000, userId: brunoUser.id, balanceCents: 999_999_999 }).expect(201);
    const placed = await ana
      .post(`/api/lots/${live.id}/bids`)
      .send({ amountCents: 10_000, bidderId: brunoUser.id, userId: brunoUser.id, availableCents: 999_999_999 });
    expect(placed.status).toBe(201);
    expect(await wallet(anaUser.id)).toEqual({ balance: 500, committed: 100, available: 400 });
    expect(await wallet(brunoUser.id)).toEqual({ balance: 0, committed: 0, available: 0 });
    const lot = await owner.get(`/api/lots/${live.id}`);
    expect(lot.body.leaderPseudonym).toBe(placed.body.bid.bidder);

    // Cadastro com saldo "injetado" começa zerado.
    const injected = request.agent(app);
    await injected
      .post('/api/auth/register')
      .send({ name: 'Esperta', email: 'esperta@teste.com', password: 'senha-forte-123', role: 'BIDDER', balanceCents: 999_999_999, committedCents: -5 })
      .expect(201);
    expect((await injected.get('/api/wallet')).body).toMatchObject({ balanceCents: 0, committedCents: 0, availableCents: 0 });
  });

  it('fluxo completo pela API: criar lote, depositar, dar lance, mensagens de recusa', async () => {
    const { agent: auctioneer } = await loginAgent('AUCTIONEER');
    const item = await createItem();
    const now = Date.now();
    const created = await auctioneer.post('/api/lots').send({
      externalId: item.externalId,
      startingPriceCents: 10_000,
      minIncrementCents: 1_000,
      startsAt: new Date(now).toISOString(),
      endsAt: new Date(now + 60 * 60_000).toISOString(),
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('LIVE');
    const lotId = created.body.id as string;

    const { agent: ana } = await loginAgent('BIDDER');
    const noFunds = await ana.post(`/api/lots/${lotId}/bids`).send({ amountCents: 10_000 });
    expect(noFunds.status).toBe(422);
    expect(noFunds.body.error).toMatchObject({ code: 'INSUFFICIENT_FUNDS', message: expect.stringContaining('Saldo insuficiente') });

    expect((await ana.post('/api/wallet/deposits').send({ amountCents: 50_000 })).status).toBe(201);
    const low = await ana.post(`/api/lots/${lotId}/bids`).send({ amountCents: 9_999 });
    expect(low.body.error.message).toMatch(/R\$\s100,00/); // Intl usa espaço não-separável

    const ok = await ana.post(`/api/lots/${lotId}/bids`).send({ amountCents: 10_000 });
    expect(ok.status).toBe(201);
    expect(ok.body.wallet).toEqual({ balanceCents: 50_000, committedCents: 10_000, availableCents: 40_000 });

    const again = await ana.post(`/api/lots/${lotId}/bids`).send({ amountCents: 20_000 });
    expect(again.body.error.code).toBe('ALREADY_WINNING');

    const detail = await ana.get(`/api/lots/${lotId}`);
    expect(detail.body.viewer).toMatchObject({ isLeader: true, position: 1, canBid: false });
    expect(detail.body.minimumNextBidCents).toBe(11_000);

    // Vitrine e auditoria são públicas.
    const showcase = await request(app).get('/api/lots?status=live');
    expect(showcase.body.lots.map((l: { id: string }) => l.id)).toContain(lotId);
    const audit = await request(app).get(`/api/audit/lots/${lotId}`);
    expect(audit.status).toBe(200);
    expect(audit.body.server.valid).toBe(true);
  });

  it('lotes cancelados não aparecem na vitrine', async () => {
    const { agent: auctioneer, user: seller } = await loginAgent('AUCTIONEER');
    const lot = await createLiveLotNow(seller.id);
    const live = await request(app).get('/api/lots?status=live');
    const before = live.body.counts.live as number;
    await auctioneer.post(`/api/lots/${lot.id}/cancel`).send({ reason: 'teste' });
    const after = await request(app).get('/api/lots?status=live');
    expect(after.body.counts.live).toBe(before - 1);
    for (const status of ['live', 'scheduled', 'ended']) {
      const list = await request(app).get(`/api/lots?status=${status}`);
      expect(list.body.lots.map((l: { id: string }) => l.id)).not.toContain(lot.id);
    }
  });

  it('id inválido vira 404, não erro 500', async () => {
    expect((await request(app).get('/api/lots/nao-e-uuid')).status).toBe(404);
    expect((await request(app).get('/api/receipts/!!')).status).toBe(404);
  });
});

describe('tempo real (Socket.IO)', () => {
  let server: Server;
  let client: Socket;

  beforeAll(async () => {
    server = createServer(app);
    attachSocketServer(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    client = connect(`http://localhost:${(server.address() as AddressInfo).port}`, { transports: ['websocket'] });
    await new Promise<void>((resolve) => client.on('connect', () => resolve()));
  });

  afterAll(async () => {
    client.close();
    bindRealtimeServer(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('quem acompanha a sala recebe o lance sem recarregar', async () => {
    await resetDatabase();
    const seller = await createUser('AUCTIONEER');
    const ana = await createUser('BIDDER', 1_000);
    const liveLot = await createLiveLotNow(seller.id);

    client.emit('lot:watch', liveLot.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const received = new Promise<LotRealtimeUpdate>((resolve) => client.once('lot:update', resolve));

    await placeBid({ lotId: liveLot.id, bidderId: ana.id, amountCents: 10_000 });

    const update = await received;
    expect(update).toMatchObject({ lotId: liveLot.id, currentPriceCents: 10_000, bidCount: 1, minimumNextBidCents: 11_000 });
    expect(update.bid?.bidder).toMatch(/^L-/);
  });
});
