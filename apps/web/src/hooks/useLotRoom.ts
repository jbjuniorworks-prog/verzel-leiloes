import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { LotDetailDTO, LotRealtimeUpdate } from '@leilao/shared';
import { socket } from '../lib/socket';

/** Mescla um evento de tempo real no detalhe do lote em cache (idempotente por seq). */
export function applyLotUpdate(lot: LotDetailDTO, update: LotRealtimeUpdate): LotDetailDTO {
  const isNewBid = !!update.bid && !lot.bids.some((bid) => bid.seq === update.bid!.seq);
  return {
    ...lot,
    status: update.status,
    currentPriceCents: update.currentPriceCents,
    minimumNextBidCents: update.minimumNextBidCents,
    leaderPseudonym: update.leaderPseudonym,
    bidCount: update.bidCount,
    distinctBidders: update.distinctBidders,
    endsAt: update.endsAt,
    extensionCount: isNewBid && update.bid!.extendedEndsAt ? lot.extensionCount + 1 : lot.extensionCount,
    bids: isNewBid ? [update.bid!, ...lot.bids] : lot.bids,
  };
}

/** Entra na sala do lote via WebSocket e mantém o cache atualizado sem recarregar a página. */
export function useLotRoom(lotId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!lotId) return;
    const key = ['lot', lotId];
    const watch = () => socket.emit('lot:watch', lotId);
    // Reconectou: volta para a sala e busca o estado completo (pode ter perdido lances).
    const onReconnect = () => {
      watch();
      void queryClient.invalidateQueries({ queryKey: key });
    };
    const onUpdate = (update: LotRealtimeUpdate) => {
      if (update.lotId !== lotId) return;
      queryClient.setQueryData<LotDetailDTO>(key, (lot) => (lot ? applyLotUpdate(lot, update) : lot));
    };
    const onFinished = (payload: { lotId: string }) => {
      if (payload.lotId === lotId) void queryClient.invalidateQueries({ queryKey: key });
    };

    watch();
    socket.on('connect', onReconnect);
    socket.on('lot:update', onUpdate);
    socket.on('lot:closed', onFinished);
    socket.on('lot:cancelled', onFinished);
    return () => {
      socket.emit('lot:unwatch', lotId);
      socket.off('connect', onReconnect);
      socket.off('lot:update', onUpdate);
      socket.off('lot:closed', onFinished);
      socket.off('lot:cancelled', onFinished);
    };
  }, [lotId, queryClient]);
}
