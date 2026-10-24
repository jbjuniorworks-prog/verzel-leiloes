import { Router } from 'express';
import { z } from 'zod';
import { MAX_AMOUNT_CENTS } from '../../lib/money';
import { parseId } from '../../lib/params';
import { bidRateLimit } from '../../lib/rate-limit';
import { currentUser, requireRole } from '../auth/auth.middleware';
import { placeBid } from '../bids/bids.service';
import { cancelLot, createLot, getAuctioneerDashboard, getLotDetail, getParticipations, listLots } from './lots.service';

const cents = (label: string) =>
  z
    .number({ invalid_type_error: `Informe ${label}` })
    .int(`${label} deve estar em centavos inteiros`)
    .min(100, `${label} deve ser de pelo menos R$ 1,00`)
    .max(MAX_AMOUNT_CENTS, `${label} acima do limite permitido`);

const listSchema = z.object({
  status: z.enum(['live', 'scheduled', 'ended']).default('live'),
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(40).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['ending', 'newest', 'price_asc', 'price_desc', 'bids']).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

const createSchema = z
  .object({
    externalId: z.string().uuid('Selecione um item da busca'),
    title: z.string().trim().max(140).optional(),
    description: z.string().trim().max(2000).optional(),
    startingPriceCents: cents('O lance inicial'),
    minIncrementCents: cents('O incremento mínimo'),
    startsAt: z.string().datetime({ offset: true, message: 'Data de início inválida' }),
    endsAt: z.string().datetime({ offset: true, message: 'Data de fim inválida' }),
  })
  .refine((input) => Date.parse(input.endsAt) > Date.parse(input.startsAt), {
    message: 'O fim precisa ser depois do início',
    path: ['endsAt'],
  });

const cancelSchema = z.object({ reason: z.string().trim().max(300).optional() });

const bidSchema = z.object({
  amountCents: z
    .number({ invalid_type_error: 'Informe o valor do lance' })
    .int('O lance deve estar em centavos inteiros')
    .positive('O lance deve ser maior que zero')
    .max(MAX_AMOUNT_CENTS, 'Lance acima do limite permitido'),
});

export const lotsRouter = Router();

lotsRouter.get('/', async (req, res) => {
  const query = listSchema.parse(req.query);
  res.json(
    await listLots({
      status: query.status,
      q: query.q || undefined,
      category: query.category || undefined,
      minPriceCents: query.minPrice,
      maxPriceCents: query.maxPrice,
      sort: query.sort,
      page: query.page,
    }),
  );
});

lotsRouter.get('/:id', async (req, res) => {
  res.json(await getLotDetail(parseId(req.params.id), req.user));
});

lotsRouter.post('/', requireRole('AUCTIONEER'), async (req, res) => {
  const input = createSchema.parse(req.body);
  res.status(201).json(await createLot(currentUser(req).id, input));
});

lotsRouter.post('/:id/cancel', requireRole('AUCTIONEER'), async (req, res) => {
  const { reason } = cancelSchema.parse(req.body ?? {});
  res.json(await cancelLot(currentUser(req).id, parseId(req.params.id), reason || null));
});

lotsRouter.post('/:id/bids', requireRole('BIDDER'), bidRateLimit, async (req, res) => {
  const { amountCents } = bidSchema.parse(req.body);
  res.status(201).json(await placeBid({ lotId: parseId(req.params.id), bidderId: currentUser(req).id, amountCents }));
});

export const auctioneerRouter = Router();
auctioneerRouter.get('/dashboard', requireRole('AUCTIONEER'), async (req, res) => {
  res.json(await getAuctioneerDashboard(currentUser(req).id));
});

export const meRouter = Router();
meRouter.get('/participations', requireRole('BIDDER'), async (req, res) => {
  res.json(await getParticipations(currentUser(req).id));
});
