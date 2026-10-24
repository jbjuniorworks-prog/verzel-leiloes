export { formatBRL } from '@leilao/shared';

export const formatDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export const formatDateTimeLong = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'medium' });

export const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** "2d 04h", "3h 12m", "04:59" — mais detalhe quanto mais perto do fim. */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}h`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

export const shortHash = (hash: string) => `${hash.slice(0, 10)}…${hash.slice(-6)}`;

export const ordinal = (n: number) => `${n}º`;
