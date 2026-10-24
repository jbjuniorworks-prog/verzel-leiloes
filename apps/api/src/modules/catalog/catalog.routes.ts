import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth/auth.middleware';
import { searchCatalog } from './catalog.service';

const searchSchema = z.object({
  q: z.string().max(120).default(''),
  page: z.coerce.number().int().min(1).max(50).default(1),
});

export const catalogRouter = Router();

catalogRouter.get('/search', requireRole('AUCTIONEER'), async (req, res) => {
  const { q, page } = searchSchema.parse(req.query);
  res.json(await searchCatalog(q, page));
});
