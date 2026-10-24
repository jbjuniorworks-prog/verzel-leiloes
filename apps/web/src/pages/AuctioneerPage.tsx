import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Eye, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { computeLotStatus, type AuctioneerDashboardDTO, type AuctioneerLotDTO } from '@leilao/shared';
import { ItemImage, StatusBadge, Countdown } from '../components/lot-bits';
import { Alert, Button, buttonClass, Card, EmptyState, inputClass, Modal, PageHeader, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useNow } from '../lib/clock';
import { formatBRL, formatDateTime } from '../lib/format';

export function AuctioneerPage() {
  const query = useQuery({ queryKey: ['dashboard'], queryFn: ({ signal }) => api<AuctioneerDashboardDTO>('/auctioneer/dashboard', { signal }) });
  const [cancelling, setCancelling] = useState<AuctioneerLotDTO | null>(null);

  if (query.isPending) return <Spinner />;
  if (query.isError) return <Alert tone="danger">{errorMessage(query.error)}</Alert>;
  const { lots, totals } = query.data;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Leiloeiro"
        title="Painel do leiloeiro"
        description="Seus lotes, o resultado de cada um e o total recebido nas vendas."
        actions={
          <Link to="/painel/novo-lote" className={buttonClass('primary')}>
            <Plus className="size-4" /> Novo lote
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="col-span-2 rounded-2xl bg-stone-900 p-5 text-white lg:col-span-1 dark:bg-amber-400 dark:text-stone-950">
          <p className="text-sm opacity-80">Total recebido</p>
          <p className="font-display text-3xl font-semibold tabular-nums">{formatBRL(totals.receivedCents)}</p>
          <p className="mt-1 text-xs opacity-70">
            em {totals.soldCount} {totals.soldCount === 1 ? 'venda' : 'vendas'}
          </p>
        </div>
        {[
          ['Arrematados', totals.soldCount],
          ['Sem lances', totals.unsoldCount],
          ['Ao vivo', totals.liveCount],
          ['Agendados', totals.scheduledCount],
        ].map(([label, value]) => (
          <Card key={label} className="p-5">
            <p className="text-sm text-stone-500">{label}</p>
            <p className="font-display text-3xl font-semibold tabular-nums">{value}</p>
          </Card>
        ))}
      </div>

      {lots.length === 0 ? (
        <EmptyState title="Você ainda não criou lotes">
          <Link to="/painel/novo-lote" className={buttonClass('primary', 'sm', 'mt-2')}>
            Criar o primeiro lote
          </Link>
        </EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-stone-50 text-left text-xs tracking-wide text-stone-500 uppercase dark:bg-stone-950/50">
                <tr>
                  <th className="px-4 py-3 font-medium">Lote</th>
                  <th className="px-4 py-3 font-medium">Situação</th>
                  <th className="px-4 py-3 text-right font-medium">Valor</th>
                  <th className="px-4 py-3 font-medium">Resultado</th>
                  <th className="px-4 py-3 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                {lots.map((lot) => (
                  <LotRow key={lot.id} lot={lot} onCancel={() => setCancelling(lot)} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CancelDialog lot={cancelling} onClose={() => setCancelling(null)} />
    </div>
  );
}

function LotRow({ lot, onCancel }: { lot: AuctioneerLotDTO; onCancel: () => void }) {
  const now = useNow();
  const status = lot.cancelledAt ? 'CANCELLED' : computeLotStatus({ ...lot, closedAt: lot.closedAt }, new Date(now));
  const canCancel = lot.canCancel && (status === 'LIVE' || status === 'SCHEDULED');

  return (
    <tr className="align-middle">
      <td className="px-4 py-3">
        <Link to={`/lotes/${lot.id}`} className="flex items-center gap-3">
          <ItemImage src={lot.imageUrl} alt={lot.title} className="aspect-[488/680] w-10 shrink-0 rounded" />
          <span className="min-w-0">
            <span className="block truncate font-semibold hover:underline">{lot.title}</span>
            <span className="text-xs text-stone-500">
              #{lot.number} · {lot.subtitle}
            </span>
          </span>
        </Link>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={status} />
        <p className="mt-1 text-xs text-stone-500">
          {status === 'LIVE' && <Countdown target={lot.endsAt} prefix="termina em " />}
          {status === 'SCHEDULED' && `começa ${formatDateTime(lot.startsAt)}`}
          {status === 'ENDED' && `encerrou ${formatDateTime(lot.closedAt ?? lot.endsAt)}`}
          {status === 'CANCELLED' && lot.cancelledAt && `cancelado ${formatDateTime(lot.cancelledAt)}`}
        </p>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        <p className="font-semibold">{formatBRL(lot.finalPriceCents ?? lot.currentPriceCents ?? lot.startingPriceCents)}</p>
        <p className="text-xs text-stone-500">
          {lot.bidCount} {lot.bidCount === 1 ? 'lance' : 'lances'}
        </p>
      </td>
      <td className="px-4 py-3 text-sm">
        {lot.result === 'SOLD' && (
          <span>
            <strong className="text-emerald-600 dark:text-emerald-400">Arrematado</strong> por {formatBRL(lot.finalPriceCents ?? 0)}
            <span className="block text-xs text-stone-500">vencedor {lot.winnerPseudonym}</span>
          </span>
        )}
        {lot.result === 'UNSOLD' && <span className="text-stone-500">Encerrado sem lances</span>}
        {status === 'ENDED' && !lot.result && <span className="text-stone-500">Liquidando…</span>}
        {status === 'LIVE' && (lot.leaderPseudonym ? <span>Liderando: {lot.leaderPseudonym}</span> : <span className="text-stone-500">Aguardando lances</span>)}
        {status === 'SCHEDULED' && <span className="text-stone-500">—</span>}
        {status === 'CANCELLED' && <span className="text-stone-500">{lot.cancelReason ?? 'Cancelado'}</span>}
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-1">
          <Link to={`/lotes/${lot.id}`} className={buttonClass('ghost', 'icon')} title="Ver sala" aria-label="Ver sala">
            <Eye className="size-4" />
          </Link>
          <Link to={`/auditoria/${lot.id}`} className={buttonClass('ghost', 'icon')} title="Auditoria" aria-label="Auditoria">
            <ShieldCheck className="size-4" />
          </Link>
          {canCancel && (
            <Button variant="ghost" size="sm" className="text-rose-600" onClick={onCancel}>
              <Ban className="size-4" /> Cancelar
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function CancelDialog({ lot, onClose }: { lot: AuctioneerLotDTO | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: () => api<{ refundedCents: number }>(`/lots/${lot!.id}/cancel`, { method: 'POST', body: { reason: reason.trim() || undefined } }),
    onSuccess: ({ refundedCents }) => {
      toast.success(`Lote #${lot!.number} cancelado`, {
        description: refundedCents > 0 ? `${formatBRL(refundedCents)} estornados ao licitante que liderava.` : 'O lote saiu da vitrine.',
      });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setReason('');
      onClose();
    },
    onError: (error) => toast.error('Não foi possível cancelar', { description: errorMessage(error) }),
  });

  return (
    <Modal open={!!lot} onClose={onClose} title={`Cancelar lote #${lot?.number ?? ''}`}>
      {lot && (
        <>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            <strong>{lot.title}</strong> sairá da vitrine e não aceitará mais lances. O cancelamento fica registrado na auditoria pública.
          </p>
          {lot.bidCount > 0 ? (
            <Alert tone="warning" title="Este lote já recebeu lances">
              O lance líder de {formatBRL(lot.currentPriceCents ?? 0)} ({lot.leaderPseudonym}) será estornado automaticamente: o valor volta na hora para o
              saldo disponível do licitante.
            </Alert>
          ) : (
            <Alert tone="info">Nenhum lance recebido — nada a estornar.</Alert>
          )}
          <label className="block space-y-1 text-sm font-medium">
            Motivo (opcional, fica público na auditoria)
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} rows={2} className={`${inputClass} h-auto py-2`} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Voltar
            </Button>
            <Button variant="danger" loading={mutation.isPending} onClick={() => mutation.mutate()}>
              Confirmar cancelamento
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
