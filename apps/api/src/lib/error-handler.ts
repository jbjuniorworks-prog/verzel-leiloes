import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@leilao/shared';
import { AppError } from './errors';
import { logger } from './logger';

const send = (res: Response, status: number, error: ApiErrorBody['error']) => res.status(status).json({ error });

// Express 5 já encaminha erros de handlers async para cá.
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof AppError) {
    return send(res, error.status, { code: error.code, message: error.message, details: error.details });
  }
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    return send(res, 400, { code: 'VALIDATION_ERROR', message: issues[0]?.message ?? 'Dados inválidos.', details: issues });
  }
  if (typeof error === 'object' && error !== null && (error as { type?: string }).type === 'entity.parse.failed') {
    return send(res, 400, { code: 'INVALID_JSON', message: 'O corpo da requisição não é um JSON válido.' });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return send(res, 409, { code: 'CONFLICT', message: 'Registro duplicado.' });
    // P2028: transação expirou esperando lock — sistema sob carga, cliente pode tentar de novo.
    if (error.code === 'P2028') return send(res, 503, { code: 'BUSY', message: 'Muitos lances ao mesmo tempo. Tente novamente.' });
  }

  logger.error(`${req.method} ${req.originalUrl}`, error);
  return send(res, 500, { code: 'INTERNAL_ERROR', message: 'Erro inesperado. Tente novamente em instantes.' });
}
