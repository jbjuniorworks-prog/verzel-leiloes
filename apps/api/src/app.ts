import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import './lib/zod-pt';
import { errorHandler } from './lib/error-handler';
import { notFound } from './lib/errors';
import { prisma } from './lib/prisma';
import { auditRouter, receiptsRouter } from './modules/audit/audit.routes';
import { loadSession } from './modules/auth/auth.middleware';
import { authRouter } from './modules/auth/auth.routes';
import { catalogRouter } from './modules/catalog/catalog.routes';
import { catalogHealth } from './modules/catalog/catalog.service';
import { imagesRouter } from './modules/images/images.routes';
import { auctioneerRouter, lotsRouter, meRouter } from './modules/lots/lots.routes';
import { walletRouter } from './modules/wallet/wallet.routes';

function apiRouter() {
  const api = Router();
  api.get('/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'ok', catalog: catalogHealth(), time: new Date().toISOString() });
  });
  api.get('/time', (_req, res) => {
    res.json({ serverTime: new Date().toISOString() });
  });
  api.use('/auth', authRouter);
  api.use('/catalog', catalogRouter);
  api.use('/lots', lotsRouter);
  api.use('/auctioneer', auctioneerRouter);
  api.use('/me', meRouter);
  api.use('/wallet', walletRouter);
  api.use('/audit', auditRouter);
  api.use('/receipts', receiptsRouter);
  api.use('/images', imagesRouter);
  api.use(() => {
    throw notFound('Rota não encontrada.');
  });
  return api;
}

/** Em produção a API também serve o front buildado (mesma origem → cookie e WebSocket simples). */
function resolveWebDist(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  // Funciona tanto em src/ (tsx) quanto em dist/ (build): ambos ficam em apps/api/<pasta>.
  const candidates = [env.WEB_DIST_DIR, resolve(here, '../../web/dist')];
  return candidates.find((dir): dir is string => !!dir && existsSync(join(dir, 'index.html'))) ?? null;
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:', 'https://cards.scryfall.io'],
          // 'self' cobre o WebSocket da mesma origem (e o Socket.IO cai para polling se preciso).
          'connect-src': ["'self'"],
          // Rodando em http (docker local), não force https nos recursos.
          'upgrade-insecure-requests': env.COOKIE_SECURE ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: '50kb' }));
  app.use(cookieParser());
  app.use(loadSession);

  app.use('/api', apiRouter());

  const webDist = resolveWebDist();
  if (webDist) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => res.sendFile(join(webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
