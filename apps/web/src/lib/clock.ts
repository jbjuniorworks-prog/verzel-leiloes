import { useSyncExternalStore } from 'react';

/**
 * Relógio sincronizado com o servidor. A contagem regressiva usa a hora do
 * servidor (não a do computador do usuário, que pode estar errada), corrigida
 * pela metade do tempo de ida e volta da requisição.
 */
let offsetMs = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let current = Date.now();

export const serverNow = () => Date.now() + offsetMs;

export async function syncServerClock() {
  try {
    const sentAt = Date.now();
    const response = await fetch('/api/time', { cache: 'no-store' });
    const receivedAt = Date.now();
    const { serverTime } = (await response.json()) as { serverTime: string };
    offsetMs = Date.parse(serverTime) - (sentAt + receivedAt) / 2;
    current = serverNow();
    listeners.forEach((notify) => notify());
  } catch {
    // Sem sincronização, usa o relógio local mesmo.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    current = serverNow();
    timer = setInterval(() => {
      current = serverNow();
      listeners.forEach((notify) => notify());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Hora do servidor, atualizada a cada segundo. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => current);
}
