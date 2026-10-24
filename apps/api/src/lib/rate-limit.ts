import type { Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env';

const skip = () => env.NODE_ENV === 'test';
const message = (text: string) => ({ error: { code: 'RATE_LIMITED', message: text } });

/** Força bruta em login/cadastro. */
export const authRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  message: message('Muitas tentativas. Aguarde um minuto e tente de novo.'),
});

/** Robôs disparando lances. A chave é o usuário (a rota exige login). */
export const bidRateLimit = rateLimit({
  windowMs: 10_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  keyGenerator: (req: Request) => req.user?.id ?? 'anonymous',
  message: message('Muitos lances em sequência. Aguarde alguns segundos.'),
});
