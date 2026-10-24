import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export type Tx = Prisma.TransactionClient;

/**
 * Transações que travam linhas (lote, carteiras) podem esperar outras terminarem.
 * Os limites padrão do Prisma (2s/5s) são curtos para rajadas de lances no mesmo lote.
 */
export const LOCKING_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;
