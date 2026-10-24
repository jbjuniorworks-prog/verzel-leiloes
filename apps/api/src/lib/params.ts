import { z } from 'zod';
import { notFound } from './errors';

const uuid = z.string().uuid();

/** Id inválido na URL vira 404 (e não erro do banco). */
export function parseId(value: unknown, message = 'Lote não encontrado.') {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw notFound(message);
  return parsed.data;
}
