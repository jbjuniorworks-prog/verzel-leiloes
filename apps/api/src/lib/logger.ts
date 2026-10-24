import { env } from '../config/env';

const silent = env.NODE_ENV === 'test';
const stamp = () => new Date().toISOString();

export const logger = {
  info: (message: string, ...extra: unknown[]) => !silent && console.log(`[${stamp()}] INFO  ${message}`, ...extra),
  warn: (message: string, ...extra: unknown[]) => !silent && console.warn(`[${stamp()}] WARN  ${message}`, ...extra),
  error: (message: string, ...extra: unknown[]) => console.error(`[${stamp()}] ERROR ${message}`, ...extra),
};
