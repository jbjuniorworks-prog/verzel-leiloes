export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Faça login para continuar.') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (code: string, message: string) => new AppError(403, code, message);
export const notFound = (message: string) => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
/** Regra de negócio violada (ex.: lance recusado). */
export const unprocessable = (code: string, message: string, details?: unknown) => new AppError(422, code, message, details);
export const serviceUnavailable = (code: string, message: string) => new AppError(503, code, message);
