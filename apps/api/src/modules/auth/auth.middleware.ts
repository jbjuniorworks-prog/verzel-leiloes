import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@leilao/shared';
import { forbidden, unauthorized } from '../../lib/errors';
import { readSession, SESSION_COOKIE, type AuthUser } from './session';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Popula req.user quando há sessão válida; rotas públicas continuam funcionando sem ela. */
export function loadSession(req: Request, _res: Response, next: NextFunction) {
  const user = readSession(req.cookies?.[SESSION_COOKIE]);
  if (user) req.user = user;
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw unauthorized();
  next();
}

const ROLE_MESSAGES: Record<Role, string> = {
  AUCTIONEER: 'Apenas leiloeiros podem fazer isso.',
  BIDDER: 'Apenas licitantes podem fazer isso. Leiloeiros não dão lances nem têm carteira de lances.',
};

export const requireRole = (role: Role) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) throw unauthorized();
  if (req.user.role !== role) throw forbidden('ROLE_NOT_ALLOWED', ROLE_MESSAGES[role]);
  next();
};

/** Usuário autenticado (para usar depois de requireAuth/requireRole). */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
