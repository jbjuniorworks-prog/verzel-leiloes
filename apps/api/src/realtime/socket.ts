import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@leilao/shared';
import { readCookie, readSession, SESSION_COOKIE, type AuthUser } from '../modules/auth/session';
import { bindRealtimeServer, lotRoom, userRoom } from './emitter';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SocketData {
  user: AuthUser | null;
}

/**
 * Salas:
 *  - lot:<id>  → qualquer pessoa (inclusive sem login) acompanhando a sala do lote;
 *  - user:<id> → notificações pessoais (lance superado, saldo, arremate).
 * A sessão vem do mesmo cookie httpOnly da API (front e API têm a mesma origem).
 */
export function attachSocketServer(httpServer: HttpServer) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    serveClient: false,
  });

  io.use((socket, next) => {
    socket.data.user = readSession(readCookie(socket.handshake.headers.cookie, SESSION_COOKIE));
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    if (user) void socket.join(userRoom(user.id));

    socket.on('lot:watch', (lotId) => {
      if (typeof lotId === 'string' && UUID.test(lotId)) void socket.join(lotRoom(lotId));
    });
    socket.on('lot:unwatch', (lotId) => {
      if (typeof lotId === 'string') void socket.leave(lotRoom(lotId));
    });
  });

  bindRealtimeServer(io);
  return io;
}
