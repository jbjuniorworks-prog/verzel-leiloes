import type { CatalogItemDTO } from '@leilao/shared';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../modules/auth/password';
import { placeBid } from '../modules/bids/bids.service';
import { snapshotItem } from '../modules/catalog/catalog.service';
import { cancelLot, createLot } from '../modules/lots/lots.service';
import { settleLot } from '../modules/settlement/settlement.service';
import { deposit } from '../modules/wallet/wallet.service';
import fixtures from './fixtures.json' with { type: 'json' };

export const DEMO_PASSWORD = 'demo1234';
export const DEMO_USERS = {
  auctioneer: { email: 'leiloeiro@demo.com', name: 'Casa Martelo', role: 'AUCTIONEER' },
  ana: { email: 'ana@demo.com', name: 'Ana Souza', role: 'BIDDER' },
  bruno: { email: 'bruno@demo.com', name: 'Bruno Lima', role: 'BIDDER' },
} as const;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const reais = (value: number) => Math.round(value * 100);

/**
 * Popula o banco com um cenário completo e coerente. Tudo passa pelos mesmos
 * serviços da aplicação (com o relógio injetado no passado), então os lances, o
 * extrato, a cadeia de auditoria e os comprovantes são idênticos aos reais.
 * Idempotente: se o leiloeiro de demonstração já existe, não faz nada.
 */
export async function seedDemoData(base = new Date()) {
  if (await prisma.user.findUnique({ where: { email: DEMO_USERS.auctioneer.email } })) {
    logger.info('Seed: dados de demonstração já existem, nada a fazer.');
    return;
  }
  logger.info('Seed: criando dados de demonstração...');
  const at = (offsetMs: number) => new Date(base.getTime() + offsetMs);

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const createUser = (user: (typeof DEMO_USERS)[keyof typeof DEMO_USERS]) =>
    prisma.user.create({ data: { ...user, passwordHash, createdAt: at(-5 * DAY), wallet: { create: {} } } });
  const seller = await createUser(DEMO_USERS.auctioneer);
  const ana = await createUser(DEMO_USERS.ana);
  const bruno = await createUser(DEMO_USERS.bruno);

  const items = fixtures as CatalogItemDTO[];
  const item = (title: string) => {
    const found = items.find((candidate) => candidate.title === title);
    if (!found) throw new Error(`Fixture ausente: ${title}`);
    return found;
  };
  for (const fixture of items) await snapshotItem(fixture);

  const lot = (title: string, startingPrice: number, increment: number, startsAt: Date, endsAt: Date, createdAt: Date, description?: string) =>
    createLot(
      seller.id,
      {
        externalId: item(title).externalId,
        description,
        startingPriceCents: reais(startingPrice),
        minIncrementCents: reais(increment),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      },
      createdAt,
    );
  const bid = (lotId: string, bidderId: string, amount: number, now: Date) => placeBid({ lotId, bidderId, amountCents: reais(amount), now });

  await deposit(ana.id, reais(150_000), at(-5 * DAY));
  await deposit(bruno.id, reais(120_000), at(-5 * DAY));

  // Encerrado e arrematado pela Ana.
  const serra = await lot(
    'Serra Angel',
    300,
    20,
    at(-5 * DAY + HOUR),
    at(-4 * DAY),
    at(-5 * DAY + HOUR),
    'Beta, estado Excellent. Pequeno desgaste nas bordas.',
  );
  await bid(serra.id, bruno.id, 300, at(-5 * DAY + 2 * HOUR));
  await bid(serra.id, ana.id, 320, at(-4 * DAY - 6 * HOUR));
  await settleLot(serra.id, at(-4 * DAY));

  // Encerrado e arrematado pelo Bruno.
  const shivan = await lot('Shivan Dragon', 1_500, 100, at(-4 * DAY), at(-3 * DAY), at(-4 * DAY), 'Beta, estado Near Mint.');
  await bid(shivan.id, ana.id, 1_500, at(-4 * DAY + 2 * HOUR));
  await bid(shivan.id, bruno.id, 1_600, at(-3 * DAY - HOUR));
  await settleLot(shivan.id, at(-3 * DAY));

  // Encerrado sem lances.
  const goyf = await lot('Tarmogoyf', 600, 25, at(-3 * DAY), at(-2 * DAY), at(-3 * DAY));
  await settleLot(goyf.id, at(-2 * DAY));

  // Ao vivo, com disputa (Ana lidera).
  const lotus = await lot('Black Lotus', 20_000, 500, at(-2 * DAY), at(45 * DAY), at(-2 * DAY), 'Unlimited, estado Good. A peça mais icônica do jogo.');
  const mox = await lot('Mox Sapphire', 9_000, 250, at(-2 * DAY), at(10 * DAY), at(-2 * DAY));
  await bid(lotus.id, ana.id, 20_000, at(-2 * DAY + HOUR));
  await bid(mox.id, ana.id, 9_000, at(-2 * DAY + 3 * HOUR));
  // Cancelado com lance → estorno automático do valor comprometido da Ana.
  await cancelLot(seller.id, mox.id, 'Item retirado pelo comitente.', at(-DAY - 2 * HOUR));

  const jace = await lot('Jace, the Mind Sculptor', 400, 20, at(-DAY), at(30 * DAY), at(-DAY));
  await bid(lotus.id, bruno.id, 21_000, at(-DAY + HOUR));
  await bid(lotus.id, ana.id, 23_000, at(-12 * HOUR));
  await bid(jace.id, bruno.id, 400, at(-6 * HOUR));

  // Ao vivo, sem lances ainda.
  await lot('Lightning Bolt', 250, 10, at(-HOUR), at(40 * DAY), at(-HOUR));
  await lot('Sol Ring', 900, 50, at(-HOUR), at(7 * DAY), at(-HOUR));

  // Agendados.
  await lot('Ancestral Recall', 10_000, 250, at(10 * DAY), at(40 * DAY), base);
  await lot('Time Walk', 8_000, 250, at(20 * DAY), at(50 * DAY), base);

  logger.info(
    `Seed concluído. Logins (senha "${DEMO_PASSWORD}"): ${Object.values(DEMO_USERS)
      .map((u) => u.email)
      .join(', ')}`,
  );
}
