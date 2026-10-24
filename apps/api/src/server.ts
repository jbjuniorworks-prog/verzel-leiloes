import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { startScheduler } from './jobs/scheduler';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { attachSocketServer } from './realtime/socket';
import { seedDemoData } from './seed/seed';

async function main() {
  if (env.SEED_ON_BOOT) await seedDemoData();

  const httpServer = createServer(createApp());
  const io = attachSocketServer(httpServer);
  const stopScheduler = startScheduler();

  httpServer.listen(env.PORT, () => logger.info(`Martelo rodando em http://localhost:${env.PORT} (${env.NODE_ENV})`));

  const shutdown = async (signal: string) => {
    logger.info(`${signal} recebido, encerrando...`);
    stopScheduler();
    await io.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error('Falha ao iniciar', error);
  process.exit(1);
});
