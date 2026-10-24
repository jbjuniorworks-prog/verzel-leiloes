import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { parseId } from '../../lib/params';

const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 680"><rect width="488" height="680" fill="#cbd5e1"/><text x="244" y="350" font-family="sans-serif" font-size="28" fill="#475569" text-anchor="middle">Imagem indisponível</text></svg>`;

export const imagesRouter = Router();

/**
 * A imagem do item é copiada para o banco na criação do lote e servida daqui:
 * se a API externa (ou o CDN dela) cair, vitrine e comprovante continuam com imagem.
 */
imagesRouter.get('/:id', async (req, res) => {
  const item = await prisma.catalogItem.findUnique({
    where: { id: parseId(req.params.id, 'Imagem não encontrada.') },
    select: { imageData: true, imageMime: true, imageUrl: true },
  });

  if (item?.imageData) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type(item.imageMime ?? 'image/jpeg').send(Buffer.from(item.imageData));
    return;
  }
  if (item?.imageUrl) {
    res.redirect(302, item.imageUrl);
    return;
  }
  res.set('Cache-Control', 'public, max-age=300');
  res.type('image/svg+xml').send(PLACEHOLDER);
});
