import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Copy, Gavel, ReceiptText, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { ParticipationDTO, ParticipationOutcome } from '@leilao/shared';
import { Countdown, ItemImage } from '../components/lot-bits';
import { Alert, Badge, buttonClass, Card, EmptyState, PageHeader, Spinner, type BadgeTone } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatBRL, formatDateTime } from '../lib/format';

const OUTCOME: Record<ParticipationOutcome, { label: string; tone: BadgeTone }> = {
  LEADING: { label: 'Ganhando', tone: 'success' },
  OUTBID: { label: 'Superado', tone: 'danger' },
  WON: { label: 'Arrematado', tone: 'warning' },
  LOST: { label: 'Não venceu', tone: 'neutral' },
  CANCELLED: { label: 'Cancelado', tone: 'neutral' },
};

const TABS = [
  { id: 'active', label: 'Em andamento', outcomes: ['LEADING', 'OUTBID'] },
  { id: 'won', label: 'Arrematados', outcomes: ['WON'] },
  { id: 'closed', label: 'Encerrados', outcomes: ['LOST', 'CANCELLED'] },
] as const;

export async function copyReceiptLink(code: string) {
  const url = `${window.location.origin}/comprovante/${code}`;
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Link do comprovante copiado', { description: url });
  } catch {
    toast.info('Copie o link do comprovante', { description: url });
  }
}

export function MyBidsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('active');
  const query = useQuery({ queryKey: ['participations'], queryFn: ({ signal }) => api<ParticipationDTO[]>('/me/participations', { signal }) });

  if (query.isPending) return <Spinner />;
  if (query.isError) return <Alert tone="danger">{errorMessage(query.error)}</Alert>;

  const current = TABS.find((t) => t.id === tab)!;
  const items = query.data.filter((item) => (current.outcomes as readonly string[]).includes(item.outcome));

  return (
    <div>
      <PageHeader
        eyebrow="Licitante"
        title="Meus arremates"
        description="Lotes em que você deu lance e lotes que você venceu, com o comprovante de arremate compartilhável."
      />

      <div role="tablist" className="mb-6 flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const count = query.data.filter((item) => (t.outcomes as readonly string[]).includes(item.outcome)).length;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                'shrink-0 rounded-full px-4 py-2 text-sm font-semibold',
                tab === t.id
                  ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                  : 'text-stone-600 hover:bg-stone-200/70 dark:text-stone-400 dark:hover:bg-stone-800',
              )}
            >
              {t.label} <span className="ml-1 text-xs opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {items.length === 0 ? (
        <EmptyState icon={<Gavel className="size-8" />} title="Nada por aqui ainda">
          <Link to="/" className={buttonClass('secondary', 'sm', 'mt-2')}>
            Explorar a vitrine
          </Link>
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ParticipationRow key={item.lot.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function ParticipationRow({ item }: { item: ParticipationDTO }) {
  const { lot, outcome } = item;
  const meta = OUTCOME[outcome];
  const live = outcome === 'LEADING' || outcome === 'OUTBID';

  return (
    <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
      <Link to={`/lotes/${lot.id}`} className="flex min-w-0 flex-1 items-center gap-4">
        <ItemImage src={lot.imageUrl} alt={lot.title} className="aspect-[488/680] w-16 shrink-0 rounded-md" />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <span className="text-xs text-stone-500">Lote #{lot.number}</span>
          </div>
          <p className="truncate font-display text-lg font-semibold">{lot.title}</p>
          <p className="text-xs text-stone-500">
            Seu maior lance: <strong className="text-stone-800 dark:text-stone-200">{formatBRL(item.myHighestBidCents)}</strong> · {item.myBidCount}{' '}
            {item.myBidCount === 1 ? 'lance' : 'lances'} como <code>{item.pseudonym}</code>
          </p>
        </div>
      </Link>

      <div className="flex flex-wrap items-center gap-4 sm:justify-end">
        <div className="text-right">
          <p className="text-xs text-stone-500">{outcome === 'WON' ? 'Valor pago' : live ? 'Lance atual' : 'Último lance'}</p>
          <p className="font-semibold tabular-nums">{formatBRL(lot.currentPriceCents ?? lot.startingPriceCents)}</p>
          {live ? (
            <Countdown target={lot.endsAt} prefix="termina em " className="text-xs text-stone-500" />
          ) : (
            <p className="text-xs text-stone-500">{formatDateTime(lot.endsAt)}</p>
          )}
        </div>
        {outcome === 'WON' && item.receiptCode && (
          <div className="flex gap-2">
            <Link to={`/comprovante/${item.receiptCode}`} className={buttonClass('strong', 'sm')}>
              <ReceiptText className="size-4" /> Comprovante
            </Link>
            <button
              onClick={() => void copyReceiptLink(item.receiptCode!)}
              className={buttonClass('secondary', 'icon')}
              aria-label="Copiar link do comprovante"
              title="Copiar link"
            >
              <Copy className="size-4" />
            </button>
          </div>
        )}
        {outcome !== 'WON' && (
          <Link to={`/auditoria/${lot.id}`} className={buttonClass('ghost', 'sm')} title="Auditar histórico">
            <ShieldCheck className="size-4" />
          </Link>
        )}
      </div>
    </Card>
  );
}
