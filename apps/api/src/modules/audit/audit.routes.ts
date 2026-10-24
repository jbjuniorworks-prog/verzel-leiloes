import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../../lib/errors';
import { parseId } from '../../lib/params';
import { AUDIT_ALGORITHM, getLotAudit, getReceipt } from './audit.service';
import { auditSigner } from './signer';

// Rotas públicas: auditoria e comprovante funcionam sem login.
export const auditRouter = Router();

auditRouter.get('/public-key', (_req, res) => {
  res.json({ algorithm: AUDIT_ALGORITHM, publicKey: auditSigner.publicKey, format: 'Ed25519 raw (32 bytes) em base64' });
});

auditRouter.get('/lots/:id', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await getLotAudit(parseId(req.params.id)));
});

const codeSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const receiptsRouter = Router();

receiptsRouter.get('/:code', async (req, res) => {
  const parsed = codeSchema.safeParse(req.params.code);
  if (!parsed.success) throw notFound('Comprovante não encontrado.');
  res.set('Cache-Control', 'no-store');
  res.json(await getReceipt(parsed.data));
});
