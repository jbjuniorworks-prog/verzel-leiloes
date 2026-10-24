import { Router } from 'express';
import { z } from 'zod';
import type { UserDTO } from '@leilao/shared';
import { conflict, unauthorized } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { authRateLimit } from '../../lib/rate-limit';
import { getWalletBalance } from '../wallet/wallet.service';
import { hashPassword, verifyPassword } from './password';
import { clearSession, issueSession } from './session';

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome').max(80),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres').max(128),
  role: z.enum(['AUCTIONEER', 'BIDDER']),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha'),
});

const toUserDTO = (user: { id: string; name: string; email: string; role: UserDTO['role']; createdAt: Date }): UserDTO => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt.toISOString(),
});

export const authRouter = Router();

authRouter.post('/register', authRateLimit, async (req, res) => {
  const input = registerSchema.parse(req.body);
  if (await prisma.user.findUnique({ where: { email: input.email } })) {
    throw conflict('EMAIL_TAKEN', 'Já existe uma conta com este e-mail.');
  }

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      role: input.role,
      passwordHash: await hashPassword(input.password),
      wallet: { create: {} },
    },
  });

  issueSession(res, user);
  res.status(201).json({ user: toUserDTO(user) });
});

authRouter.post('/login', authRateLimit, async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Mesma mensagem para e-mail inexistente e senha errada: não revela quem tem conta.
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw unauthorized('E-mail ou senha incorretos.');
  }
  issueSession(res, user);
  res.json({ user: toUserDTO(user) });
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.status(204).end();
});

/** Visitante sem login recebe `null` (não é erro). */
authRouter.get('/me', async (req, res) => {
  const user = req.user ? await prisma.user.findUnique({ where: { id: req.user.id } }) : null;
  if (!user) {
    res.json(null);
    return;
  }
  res.json({ user: toUserDTO(user), wallet: await getWalletBalance(user.id) });
});
