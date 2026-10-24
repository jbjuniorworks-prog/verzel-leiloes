import type { Role } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/modules/auth/password';
import { createLot } from '../src/modules/lots/lots.service';
import { deposit } from '../src/modules/wallet/wallet.service';

export const MINUTE = 60_000;
export const T0 = new Date('2026-10-24T12:00:00.000Z');
export const at = (minutes: number) => new Date(T0.getTime() + minutes * MINUTE);

const TABLES = ['receipts', 'wallet_transactions', 'lot_events', 'lots', 'wallets', 'users', 'catalog_items', 'catalog_item_cache', 'catalog_search_cache'];

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

let counter = 0;
const passwordHash = hashPassword('senha-de-teste');

export async function createUser(role: Role, balanceReais = 0) {
  counter++;
  const user = await prisma.user.create({
    data: { name: `${role} ${counter}`, email: `user${counter}@teste.com`, role, passwordHash: await passwordHash, wallet: { create: {} } },
  });
  if (balanceReais > 0) await deposit(user.id, balanceReais * 100, at(-120));
  return user;
}

/** Item já "copiado" da API externa: os testes nunca dependem da rede. */
export async function createItem(externalId = crypto.randomUUID()) {
  return prisma.catalogItem.create({
    data: {
      source: 'scryfall',
      externalId,
      title: `Carta ${externalId.slice(0, 4)}`,
      subtitle: 'Coleção de teste · #1',
      category: 'Rara',
      attributes: [{ label: 'Raridade', value: 'Rara' }],
      fetchedAt: T0,
    },
  });
}

/** Lote ao vivo entre T0-60min e T0+60min (por padrão), criado com o relógio em `createdAt`. */
export async function createTestLot(
  sellerId: string,
  {
    start = -60,
    end = 60,
    startingReais = 100,
    incrementReais = 10,
    createdAt = start,
  }: Partial<Record<'start' | 'end' | 'startingReais' | 'incrementReais' | 'createdAt', number>> = {},
) {
  const item = await createItem();
  return createLot(
    sellerId,
    {
      externalId: item.externalId,
      startingPriceCents: startingReais * 100,
      minIncrementCents: incrementReais * 100,
      startsAt: at(start).toISOString(),
      endsAt: at(end).toISOString(),
    },
    at(createdAt),
  );
}

/** Lote ao vivo no relógio real (para testes que passam pela rota HTTP, que usa a hora atual). */
export async function createLiveLotNow(sellerId: string) {
  const item = await createItem();
  const now = new Date();
  return createLot(
    sellerId,
    {
      externalId: item.externalId,
      startingPriceCents: 10_000,
      minIncrementCents: 1_000,
      startsAt: now.toISOString(),
      endsAt: new Date(now.getTime() + 60 * MINUTE).toISOString(),
    },
    now,
  );
}

export async function wallet(userId: string) {
  const w = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  return { balance: Number(w.balanceCents) / 100, committed: Number(w.committedCents) / 100, available: Number(w.balanceCents - w.committedCents) / 100 };
}

/** Executa SQL "por fora" da aplicação, como um DBA mal-intencionado (trigger desligado). */
export async function tamper(sql: string) {
  await prisma.$transaction([
    prisma.$executeRawUnsafe('ALTER TABLE lot_events DISABLE TRIGGER lot_events_append_only'),
    prisma.$executeRawUnsafe(sql),
    prisma.$executeRawUnsafe('ALTER TABLE lot_events ENABLE TRIGGER lot_events_append_only'),
  ]);
}

export async function rejectionCode(promise: Promise<unknown>) {
  try {
    await promise;
    return 'ACCEPTED';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}
