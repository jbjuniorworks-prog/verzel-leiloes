export type LotStatus = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';

export interface LotTiming {
  startsAt: Date | string;
  endsAt: Date | string;
  cancelledAt?: Date | string | null;
  closedAt?: Date | string | null;
}

const toMs = (value: Date | string) => (value instanceof Date ? value.getTime() : Date.parse(value));

/**
 * O status é derivado dos horários, não guardado numa coluna: assim nunca existe
 * um lote "ao vivo" no banco cujo horário já passou só porque um job atrasou.
 * Um lote encerrado mas ainda não liquidado já aparece como ENDED.
 */
export function computeLotStatus(lot: LotTiming, now: Date = new Date()): LotStatus {
  if (lot.cancelledAt) return 'CANCELLED';
  if (lot.closedAt) return 'ENDED';
  const nowMs = now.getTime();
  if (nowMs < toMs(lot.startsAt)) return 'SCHEDULED';
  if (nowMs >= toMs(lot.endsAt)) return 'ENDED';
  return 'LIVE';
}

export const LOT_STATUS_LABEL: Record<LotStatus, string> = {
  SCHEDULED: 'Agendado',
  LIVE: 'Ao vivo',
  ENDED: 'Encerrado',
  CANCELLED: 'Cancelado',
};
