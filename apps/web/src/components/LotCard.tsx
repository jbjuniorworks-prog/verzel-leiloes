import { Gavel } from 'lucide-react';
import { Link } from 'react-router';
import { computeLotStatus, type LotSummaryDTO } from '@leilao/shared';
import { useNow } from '../lib/clock';
import { formatBRL, formatDateTime } from '../lib/format';
import { Countdown, ItemImage, StatusBadge } from './lot-bits';

export function LotCard({ lot }: { lot: LotSummaryDTO }) {
  const now = useNow();
  // O status é recalculado a cada segundo: o card vira "Encerrado" sozinho na hora certa.
  const status = lot.status === 'CANCELLED' ? 'CANCELLED' : computeLotStatus({ ...lot, closedAt: lot.result ? lot.endsAt : null }, new Date(now));
  const price = lot.currentPriceCents ?? lot.startingPriceCents;

  return (
    <Link
      to={`/lotes/${lot.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-stone-900/5 dark:border-stone-800 dark:bg-stone-900"
    >
      <div className="relative">
        <ItemImage src={lot.imageUrl} alt={lot.title} className="aspect-[488/680] transition-transform duration-500 group-hover:scale-[1.02]" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
          <StatusBadge status={status} className="shadow-sm backdrop-blur" />
          <span className="rounded-full bg-stone-950/70 px-2 py-0.5 text-xs font-semibold text-white">Lote #{lot.number}</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-semibold group-hover:text-amber-700 dark:group-hover:text-amber-400">{lot.title}</h3>
          <p className="truncate text-xs text-stone-500 dark:text-stone-400">{lot.subtitle}</p>
        </div>

        <div className="mt-auto flex items-end justify-between gap-2 border-t border-stone-100 pt-3 dark:border-stone-800">
          <div>
            <p className="text-[11px] font-medium tracking-wide text-stone-500 uppercase">
              {status === 'ENDED' ? (lot.result === 'SOLD' ? 'Arrematado por' : 'Lance inicial') : lot.currentPriceCents ? 'Lance atual' : 'Lance inicial'}
            </p>
            <p className="text-lg font-bold tabular-nums">{formatBRL(price)}</p>
          </div>
          <div className="text-right text-xs text-stone-500 dark:text-stone-400">
            {status === 'LIVE' && (
              <>
                <p className="flex items-center justify-end gap-1">
                  <Gavel className="size-3" aria-hidden /> {lot.bidCount} {lot.bidCount === 1 ? 'lance' : 'lances'}
                </p>
                <Countdown target={lot.endsAt} prefix="termina em " className="text-sm whitespace-nowrap text-stone-700 dark:text-stone-300" />
              </>
            )}
            {status === 'SCHEDULED' && (
              <>
                <p>começa em</p>
                <p className="text-sm text-stone-700 dark:text-stone-300">{formatDateTime(lot.startsAt)}</p>
              </>
            )}
            {status === 'ENDED' && (
              <p className="font-medium">{lot.result === 'SOLD' ? `${lot.bidCount} lances` : lot.result === 'UNSOLD' ? 'Sem lances' : 'Liquidando…'}</p>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
