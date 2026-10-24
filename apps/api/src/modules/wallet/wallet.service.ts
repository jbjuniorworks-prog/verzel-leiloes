import type { WalletTransactionType } from '@prisma/client';
import type { WalletBalanceDTO, WalletDTO } from '@leilao/shared';
import { centsToNumber } from '../../lib/money';
import { LOCKING_TX_OPTIONS, prisma, type Tx } from '../../lib/prisma';
import { realtime } from '../../realtime/emitter';

/**
 * Trava as carteiras sempre na mesma ordem (por id). Duas transações que precisam
 * das mesmas carteiras pegam os locks na mesma sequência e não entram em deadlock.
 * Ordem global de locks no sistema: lote → carteiras.
 */
export async function lockWallets(tx: Tx, userIds: Array<string | null | undefined>) {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))].sort();
  for (const id of ids) {
    await tx.$queryRaw`SELECT 1 FROM wallets WHERE user_id = ${id}::uuid FOR UPDATE`;
  }
}

export interface WalletChange {
  userId: string;
  type: WalletTransactionType;
  amountCents: bigint;
  balanceDelta?: bigint;
  committedDelta?: bigint;
  description: string;
  lotId?: string;
  at: Date;
}

/** Aplica a mudança e grava a linha de extrato com o saldo resultante. */
export async function applyWalletChange(tx: Tx, change: WalletChange) {
  const wallet = await tx.wallet.update({
    where: { userId: change.userId },
    data: {
      balanceCents: { increment: change.balanceDelta ?? 0n },
      committedCents: { increment: change.committedDelta ?? 0n },
    },
  });
  await tx.walletTransaction.create({
    data: {
      userId: change.userId,
      type: change.type,
      amountCents: change.amountCents,
      balanceAfterCents: wallet.balanceCents,
      committedAfterCents: wallet.committedCents,
      description: change.description,
      lotId: change.lotId,
      createdAt: change.at,
    },
  });
  return wallet;
}

export function toBalanceDTO(wallet: { balanceCents: bigint; committedCents: bigint }): WalletBalanceDTO {
  return {
    balanceCents: centsToNumber(wallet.balanceCents),
    committedCents: centsToNumber(wallet.committedCents),
    availableCents: centsToNumber(wallet.balanceCents - wallet.committedCents),
  };
}

export async function getWalletBalance(userId: string): Promise<WalletBalanceDTO | null> {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  return wallet ? toBalanceDTO(wallet) : null;
}

/** Notifica o usuário (todas as abas abertas) que o saldo mudou. */
export async function broadcastWallets(userIds: Array<string | null | undefined>) {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  const wallets = await prisma.wallet.findMany({ where: { userId: { in: ids } } });
  for (const wallet of wallets) realtime.walletUpdated(wallet.userId, toBalanceDTO(wallet));
}

export async function deposit(userId: string, amountCents: number, at = new Date()) {
  const wallet = await prisma.$transaction(async (tx) => {
    await lockWallets(tx, [userId]);
    return applyWalletChange(tx, {
      userId,
      type: 'DEPOSIT',
      amountCents: BigInt(amountCents),
      balanceDelta: BigInt(amountCents),
      description: 'Depósito simulado',
      at,
    });
  }, LOCKING_TX_OPTIONS);
  const balance = toBalanceDTO(wallet);
  realtime.walletUpdated(userId, balance);
  return balance;
}

export async function getWallet(userId: string): Promise<WalletDTO> {
  const [wallet, leading, transactions] = await Promise.all([
    prisma.wallet.findUniqueOrThrow({ where: { userId } }),
    // O valor comprometido é exatamente o lance atual de cada lote que o usuário lidera.
    prisma.lot.findMany({
      where: { leaderId: userId, closedAt: null, cancelledAt: null },
      select: { id: true, number: true, title: true, currentPriceCents: true, endsAt: true },
      orderBy: { endsAt: 'asc' },
    }),
    prisma.walletTransaction.findMany({
      where: { userId },
      include: { lot: { select: { number: true } } },
      orderBy: { id: 'desc' },
      take: 100,
    }),
  ]);

  return {
    ...toBalanceDTO(wallet),
    holds: leading.map((lot) => ({
      lotId: lot.id,
      lotNumber: lot.number,
      title: lot.title,
      amountCents: centsToNumber(lot.currentPriceCents ?? 0n),
      endsAt: lot.endsAt.toISOString(),
    })),
    transactions: transactions.map((tx) => ({
      id: tx.id.toString(),
      type: tx.type,
      amountCents: centsToNumber(tx.amountCents),
      balanceAfterCents: centsToNumber(tx.balanceAfterCents),
      committedAfterCents: centsToNumber(tx.committedAfterCents),
      description: tx.description,
      lotId: tx.lotId,
      lotNumber: tx.lot?.number ?? null,
      createdAt: tx.createdAt.toISOString(),
    })),
  };
}
