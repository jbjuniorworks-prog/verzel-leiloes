import type { Server } from 'socket.io';
import type { ClientToServerEvents, LotClosedPayload, LotRealtimeUpdate, NotificationPayload, ServerToClientEvents, WalletBalanceDTO } from '@leilao/shared';

type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

let io: RealtimeServer | null = null;

export const lotRoom = (lotId: string) => `lot:${lotId}`;
export const userRoom = (userId: string) => `user:${userId}`;

export function bindRealtimeServer(server: RealtimeServer | null) {
  io = server;
}

/**
 * Fachada de eventos em tempo real. Os serviços chamam isto depois do COMMIT —
 * nunca dentro da transação, para não anunciar um lance que ainda pode ser desfeito.
 * Sem servidor ligado (testes, seed), vira no-op.
 */
export const realtime = {
  lotUpdated(update: LotRealtimeUpdate) {
    io?.to(lotRoom(update.lotId)).emit('lot:update', update);
  },
  lotClosed(payload: LotClosedPayload) {
    io?.to(lotRoom(payload.lotId)).emit('lot:closed', payload);
  },
  lotCancelled(lotId: string, reason: string | null) {
    io?.to(lotRoom(lotId)).emit('lot:cancelled', { lotId, reason });
  },
  /** Avisa as vitrines abertas que algum lote mudou (novo lance, início, fim...). */
  lotsChanged() {
    io?.emit('lots:changed');
  },
  walletUpdated(userId: string, balance: WalletBalanceDTO) {
    io?.to(userRoom(userId)).emit('wallet:update', balance);
  },
  notify(userId: string, payload: NotificationPayload) {
    io?.to(userRoom(userId)).emit('notify', payload);
  },
};
