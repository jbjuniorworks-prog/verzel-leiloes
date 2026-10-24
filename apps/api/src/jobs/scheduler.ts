import { env } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { buildLotUpdate } from '../modules/lots/lots.mapper';
import { settleDueLots } from '../modules/settlement/settlement.service';
import { realtime } from '../realtime/emitter';

/**
 * Relógio do leilão (1 tick por segundo):
 *  - liquida lotes cujo fim já passou;
 *  - avisa as telas abertas quando um lote agendado começa.
 * O status em si é sempre derivado dos horários, então um tick atrasado não deixa
 * ninguém dar lance fora da janela — o lance é validado contra o relógio.
 */
export function startScheduler(intervalMs = env.SETTLEMENT_INTERVAL_MS) {
  let running = false;
  let lastTick = new Date();

  const tick = async () => {
    if (running) return;
    running = true;
    const now = new Date();
    try {
      const settled = await settleDueLots(now);
      if (settled > 0) logger.info(`${settled} lote(s) liquidado(s)`);

      const started = await prisma.lot.findMany({
        where: { cancelledAt: null, startsAt: { gt: lastTick, lte: now } },
      });
      for (const lot of started) realtime.lotUpdated(await buildLotUpdate(lot, null, now));
      if (started.length > 0) realtime.lotsChanged();
      lastTick = now;
    } catch (error) {
      logger.error('Falha no ciclo do agendador', error);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
