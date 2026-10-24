import { Router } from 'express';
import { z } from 'zod';
import { MAX_AMOUNT_CENTS } from '../../lib/money';
import { currentUser, requireRole } from '../auth/auth.middleware';
import { deposit, getWallet } from './wallet.service';

const depositSchema = z.object({
  amountCents: z
    .number({ invalid_type_error: 'Informe o valor em centavos' })
    .int('O valor deve estar em centavos inteiros')
    .min(100, 'O depósito mínimo é R$ 1,00')
    .max(MAX_AMOUNT_CENTS, 'O depósito máximo por operação é R$ 10.000.000,00'),
});

export const walletRouter = Router();

walletRouter.use(requireRole('BIDDER'));

walletRouter.get('/', async (req, res) => {
  res.json(await getWallet(currentUser(req).id));
});

walletRouter.post('/deposits', async (req, res) => {
  const { amountCents } = depositSchema.parse(req.body);
  res.status(201).json(await deposit(currentUser(req).id, amountCents));
});
