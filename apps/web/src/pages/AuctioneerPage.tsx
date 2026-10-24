import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Ban, Eye, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { computeLotStatus, type AuctioneerDashboardDTO, type AuctioneerLotDTO, type LotStatus } from '@leilao/shared';
import { ItemImage, StatusBadge, Countdown } from '../components/lot-bits';
import { Alert, Button, buttonClass, Card, EmptyState, inputClass, LoadError, Modal, PageHeader, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useNow } from '../lib/clock';
import { formatBRL, formatDateTime } from '../lib/format';
import { usePageTitle } from '../lib/page-title';

export function AuctioneerPage() {
  const query = useQuery({ queryKey: ['dashboard'], queryFn: ({ signal }) => api<AuctioneerDashboardDTO>('/auctioneer/dashboard', { signal }) });
  const [cancelling, setCancelling] = useState<AuctioneerLotDTO | null>(null);
  usePageTitle('Painel do leiloeiro');

  if (query.isPending) return <Spinner />;
  if (!query.data) return <LoadError title="Não foi possível carregar o painel" error={query.error} onRetry={() => void query.refetch()} />;
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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <div className="col-span-2 rounded-2xl bg-stone-900 p-5 text-white dark:bg-amber-400 dark:text-stone-950">
          <p className="text-sm opacity-80">Total recebido</p>
          <p className="font-display text-3xl font-semibold tabular-nums wrap-break-word">{formatBRL(totals.receivedCents)}</p>
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
          {/* Celular: um card por lote, com tudo visível. Tablet/desktop: tabela. */}
          <ul className="divide-y divide-stone-100 md:hidden dark:divide-stone-800">
            {lots.map((lot) => (
              <LotListItem key={lot.id} lot={lot} onCancel={() => setCancelling(lot)} />
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
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

/** Situação calculada pelo relógio do servidor: a linha muda sozinha quando o lote começa ou termina. */
function useLotStatus(lot: AuctioneerLotDTO) {
  const now = useNow();
  const status: LotStatus = lot.cancelledAt ? 'CANCELLED' : computeLotStatus(lot, new Date(now));
  return { status, canCancel: lot.canCancel && (status === 'LIVE' || status === 'SCHEDULED') };
}

function StatusDetail({ lot, status }: { lot: AuctioneerLotDTO; status: LotStatus }) {
  if (status === 'LIVE') return <Countdown target={lot.endsAt} prefix="termina em " />;
  if (status === 'SCHEDULED') return <>começa {formatDateTime(lot.startsAt)}</>;
  if (status === 'ENDED') return <>encerrou {formatDateTime(lot.closedAt ?? lot.endsAt)}</>;
  return lot.cancelledAt ? <>cancelado {formatDateTime(lot.cancelledAt)}</> : null;
}

function ResultDetail({ lot, status }: { lot: AuctioneerLotDTO; status: LotStatus }) {
  if (lot.result === 'SOLD') {
    return (
      <span>
        <strong className="text-emerald-600 dark:text-emerald-400">Arrematado</strong> por {formatBRL(lot.finalPriceCents ?? 0)}
        <span className="block text-xs text-stone-500">vencedor {lot.winnerPseudonym}</span>
      </span>
    );
  }
  if (lot.result === 'UNSOLD') return <span className="text-stone-500">Encerrado sem lances</span>;
  if (status === 'ENDED') return <span className="text-stone-500">Liquidando…</span>;
  if (status === 'LIVE') return lot.leaderPseudonym ? <span>Liderando: {lot.leaderPseudonym}</span> : <span className="text-stone-500">Aguardando lances</span>;
  if (status === 'CANCELLED') return <span className="text-stone-500 wrap-anywhere">{lot.cancelReason ?? 'Cancelado'}</span>;
  return <span className="text-stone-500">—</span>;
}

function LotActions({ lot, canCancel, onCancel, align = 'end' }: { lot: AuctioneerLotDTO; canCancel: boolean; onCancel: () => void; align?: 'start' | 'end' }) {
  return (
    <div className={clsx('flex gap-1', align === 'start' ? '-ml-2 justify-start' : 'justify-end')}>
      <Link to={`/lotes/${lot.id}`} className={buttonClass('ghost', 'icon')} title="Ver sala" aria-label={`Ver sala do lote #${lot.number}`}>
        <Eye className="size-4" />
      </Link>
      <Link to={`/auditoria/${lot.id}`} className={buttonClass('ghost', 'icon')} title="Auditoria" aria-label={`Auditoria do lote #${lot.number}`}>
        <ShieldCheck className="size-4" />
      </Link>
      {canCancel && (
        <Button variant="ghost" size="sm" className="text-rose-600" onClick={onCancel}>
          <Ban className="size-4" /> Cancelar
        </Button>
      )}
    </div>
  );
}

const lotValue = (lot: AuctioneerLotDTO) => formatBRL(lot.finalPriceCents ?? lot.currentPriceCents ?? lot.startingPriceCents);
const bidCountLabel = (count: number) => `${count} ${count === 1 ? 'lance' : 'lances'}`;

function LotRow({ lot, onCancel }: { lot: AuctioneerLotDTO; onCancel: () => void }) {
  const { status, canCancel } = useLotStatus(lot);
  return (
    <tr className="align-middle">
      <td className="px-4 py-3">
        <Link to={`/lotes/${lot.id}`} className="flex items-center gap-3">
          <ItemImage src={lot.imageUrl} alt={lot.title} className="aspect-[488/680] w-10 shrink-0 rounded" />
          <span className="min-w-0">
            <span className="block max-w-[18rem] truncate font-semibold hover:underline xl:max-w-[24rem]" title={lot.title}>
              {lot.title}
            </span>
            <span className="block max-w-[18rem] truncate text-xs text-stone-500 xl:max-w-[24rem]">
              #{lot.number} · {lot.subtitle}
            </span>
          </span>
        </Link>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={status} />
        <p className="mt-1 text-xs whitespace-nowrap text-stone-500">
          <StatusDetail lot={lot} status={status} />
        </p>
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
        <p className="font-semibold">{lotValue(lot)}</p>
        <p className="text-xs text-stone-500">{bidCountLabel(lot.bidCount)}</p>
      </td>
      <td className="max-w-[16rem] px-4 py-3 text-sm">
        <ResultDetail lot={lot} status={status} />
      </td>
      <td className="px-4 py-3">
        <LotActions lot={lot} canCancel={canCancel} onCancel={onCancel} />
      </td>
    </tr>
  );
}

function LotListItem({ lot, onCancel }: { lot: AuctioneerLotDTO; onCancel: () => void }) {
  const { status, canCancel } = useLotStatus(lot);
  return (
    <li className="flex gap-3 p-4">
      <Link to={`/lotes/${lot.id}`} className="shrink-0">
        <ItemImage src={lot.imageUrl} alt={lot.title} className="aspect-[488/680] w-14 rounded" />
      </Link>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="min-w-0">
          <Link to={`/lotes/${lot.id}`} className="block truncate font-semibold" title={lot.title}>
            {lot.title}
          </Link>
          <p className="truncate text-xs text-stone-500">
            #{lot.number} · {lot.subtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
          <StatusBadge status={status} />
          <StatusDetail lot={lot} status={status} />
        </div>
        <p className="text-sm">
          <strong className="tabular-nums">{lotValue(lot)}</strong> <span className="text-xs text-stone-500">· {bidCountLabel(lot.bidCount)}</span>
        </p>
        <div className="text-sm">
          <ResultDetail lot={lot} status={status} />
        </div>
        <div className="pt-1">
          <LotActions lot={lot} canCancel={canCancel} onCancel={onCancel} align="start" />
        </div>
      </div>
    </li>
  );
}

function CancelDialog({ lot, onClose }: { lot: AuctioneerLotDTO | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  // Fechar (Voltar, Esc, clique fora ou sucesso) limpa o motivo: não vaza para o próximo lote.
  const close = () => {
    setReason('');
    onClose();
  };
  const mutation = useMutation({
    mutationFn: () => api<{ refundedCents: number }>(`/lots/${lot!.id}/cancel`, { method: 'POST', body: { reason: reason.trim() || undefined } }),
    onSuccess: ({ refundedCents }) => {
      toast.success(`Lote #${lot!.number} cancelado`, {
        description: refundedCents > 0 ? `${formatBRL(refundedCents)} estornados ao licitante que liderava.` : 'O lote saiu da vitrine.',
      });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      close();
    },
    onError: (error) => toast.error('Não foi possível cancelar', { description: errorMessage(error) }),
  });

  return (
    <Modal open={!!lot} onClose={close} title={`Cancelar lote #${lot?.number ?? ''}`}>
      {lot && (
        <>
          <p className="text-sm text-stone-600 wrap-anywhere dark:text-stone-400">
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
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={close}>
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
