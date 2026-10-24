import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@leilao/shared';
import { env } from '../../config/env';

export const SESSION_COOKIE = 'martelo_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface AuthUser {
  id: string;
  name: string;
  role: Role;
}

interface SessionClaims {
  sub: string;
  name: string;
  role: Role;
}

// Sessão em cookie httpOnly (o JavaScript da página não lê o token → XSS não rouba
// a sessão). SameSite=Lax + API só aceitando JSON bloqueiam CSRF de outros sites.
const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax',
  path: '/',
});

export function issueSession(res: Response, user: AuthUser) {
  const claims: SessionClaims = { sub: user.id, name: user.name, role: user.role };
  const token = jwt.sign(claims, env.JWT_SECRET, { expiresIn: SESSION_TTL_SECONDS });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_TTL_SECONDS * 1000 });
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export function readSession(token: string | undefined): AuthUser | null {
  if (!token) return null;
  try {
    const claims = jwt.verify(token, env.JWT_SECRET) as SessionClaims;
    return { id: claims.sub, name: claims.name, role: claims.role };
  } catch {
    return null;
  }
}

/** Lê um cookie do header bruto (usado no handshake do Socket.IO). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}
