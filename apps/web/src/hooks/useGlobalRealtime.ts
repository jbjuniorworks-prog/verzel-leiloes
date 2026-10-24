import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { NotificationPayload, WalletBalanceDTO } from '@leilao/shared';
import { SESSION_KEY, type Session } from '../auth/AuthContext';
import { socket } from '../lib/socket';

/**
 * Eventos que valem para o app inteiro: notificações pessoais (lance superado,
 * arremate...), saldo da carteira e invalidação da vitrine quando algo muda.
 */
export function useGlobalRealtime() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const refreshLists = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        for (const key of ['lots', 'dashboard', 'participations']) void queryClient.invalidateQueries({ queryKey: [key] });
      }, 400);
    };

    const onWallet = (balance: WalletBalanceDTO) => {
      queryClient.setQueryData<Session | null>(SESSION_KEY, (session) => (session ? { ...session, wallet: balance } : session));
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    };

    const onNotify = (notification: NotificationPayload) => {
      const action = { label: 'Ver lote', onClick: () => navigate(`/lotes/${notification.lotId}`) };
      const options = { description: notification.message, action, duration: 8000 };
      switch (notification.kind) {
        case 'OUTBID':
          toast.warning('Você foi superado', options);
          break;
        case 'WON':
          toast.success('Você arrematou um lote!', { ...options, action: { label: 'Meus arremates', onClick: () => navigate('/meus-arremates') } });
          break;
        case 'SOLD':
          toast.success('Lote arrematado', options);
          break;
        case 'LOST':
        case 'UNSOLD':
          toast.info('Lote encerrado', options);
          break;
        case 'LOT_CANCELLED':
          toast.error('Lote cancelado', options);
          break;
      }
      void queryClient.invalidateQueries({ queryKey: ['lot', notification.lotId] });
      refreshLists();
    };

    // Depois de uma queda de conexão, recarrega tudo para não perder eventos.
    let connectedBefore = false;
    const onConnect = () => {
      if (connectedBefore) void queryClient.invalidateQueries();
      connectedBefore = true;
    };

    socket.on('lots:changed', refreshLists);
    socket.on('wallet:update', onWallet);
    socket.on('notify', onNotify);
    socket.on('connect', onConnect);
    return () => {
      clearTimeout(debounce);
      socket.off('lots:changed', refreshLists);
      socket.off('wallet:update', onWallet);
      socket.off('notify', onNotify);
      socket.off('connect', onConnect);
    };
  }, [queryClient, navigate]);
}
