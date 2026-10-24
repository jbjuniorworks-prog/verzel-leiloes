import clsx from 'clsx';
import { useState } from 'react';
import { ANTI_SNIPING_WINDOW_MS, LOT_STATUS_LABEL, type LotStatus } from '@leilao/shared';
import { useNow } from '../lib/clock';
import { formatDuration } from '../lib/format';
import { Badge, type BadgeTone } from './ui';

const STATUS_TONE: Record<LotStatus, BadgeTone> = { LIVE: 'live', SCHEDULED: 'info', ENDED: 'neutral', CANCELLED: 'danger' };

export function StatusBadge({ status, className }: { status: LotStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status]} className={className}>
      {status === 'LIVE' && <span className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden />}
      {LOT_STATUS_LABEL[status]}
    </Badge>
  );
}

/** Contagem regressiva pela hora do servidor. Fica vermelha na janela anti-sniping. */
export function Countdown({ target, className, prefix }: { target: string; className?: string; prefix?: string }) {
  const now = useNow();
  const remaining = Date.parse(target) - now;
  const urgent = remaining > 0 && remaining <= ANTI_SNIPING_WINDOW_MS;
  return (
    <span className={clsx('tabular-nums', urgent && 'font-semibold text-rose-600 dark:text-rose-400', className)}>
      {prefix}
      {formatDuration(remaining)}
    </span>
  );
}

/** Imagem do item com placeholder enquanto carrega e fallback se falhar. */
export function ItemImage({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  // Guarda *qual* src carregou/falhou: trocar de imagem no mesmo componente recomeça do zero.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const state = !src || failed === src ? 'error' : loaded === src ? 'loaded' : 'loading';
  return (
    <div className={clsx('relative overflow-hidden bg-stone-200 dark:bg-stone-800', className)}>
      {state !== 'error' && src && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
          className={clsx(
            'size-full object-cover transition-opacity duration-300 motion-reduce:transition-none',
            state === 'loaded' ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
      {state === 'loading' && <div className="absolute inset-0 bg-stone-200 motion-safe:animate-pulse dark:bg-stone-800" />}
      {state === 'error' && <div className="absolute inset-0 grid place-items-center p-4 text-center text-xs text-stone-500">Imagem indisponível</div>}
    </div>
  );
}
