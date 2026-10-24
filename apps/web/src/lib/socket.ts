import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@leilao/shared';

/** Conexão única com o servidor de tempo real (mesma origem → o cookie de sessão vai junto). */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  withCredentials: true,
  autoConnect: true,
});

/** Após login/logout a sala pessoal muda: reconecta para o servidor ler o novo cookie. */
export function reconnectSocket() {
  socket.disconnect();
  socket.connect();
}
