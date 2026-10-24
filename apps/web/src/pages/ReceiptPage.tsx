import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Copy, Fingerprint, Gavel, Printer, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { createWebAuditCrypto, Ed25519UnsupportedError, verifyReceipt, type ReceiptDTO } from '@leilao/shared';
import { ItemImage } from '../components/lot-bits';
import { Button, buttonClass, EmptyState, LoadError, Spinner } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import { formatBRL, formatDateTimeLong } from '../lib/format';
import { usePageTitle } from '../lib/page-title';
import { copyReceiptLink } from './MyBidsPage';

type BrowserCheck = 'checking' | 'valid' | 'invalid' | 'unsupported' | 'error';

const BROWSER_DETAIL: Record<BrowserCheck, string> = {
  checking: 'conferindo…',
  valid: 'Ed25519 via WebCrypto',
  invalid: 'assinatura não confere',
  unsupported: 'navegador sem suporte a Ed25519',
  error: 'não foi possível conferir aqui',
};

export function ReceiptPage() {
  const { code } = useParams();
  const query = useQuery({ queryKey: ['receipt', code], queryFn: ({ signal }) => api<ReceiptDTO>(`/receipts/${code}`, { signal }), enabled: !!code });
  const [browserCheck, setBrowserCheck] = useState<BrowserCheck>('checking');
  usePageTitle(query.data ? `Comprovante · ${query.data.receipt.itemTitle}` : 'Comprovante');

  useEffect(() => {
    const data = query.data;
    if (!data) return;
    let cancelled = false;
    // async + try: createWebAuditCrypto() lança na hora em página sem HTTPS (sem crypto.subtle).
    (async () => {
      try {
        const result = await verifyReceipt(
          { receipt: data.receipt, hash: data.hash, signature: data.signature, publicKey: data.publicKey },
          createWebAuditCrypto(),
        );
        if (!cancelled) setBrowserCheck(result.valid ? 'valid' : 'invalid');
      } catch (error) {
        if (!cancelled) setBrowserCheck(error instanceof Ed25519UnsupportedError ? 'unsupported' : 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query.data]);

  if (query.isPending) return <Spinner />;
  if (!query.data) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return (
        <EmptyState title="Comprovante não encontrado">
          <p>Confira se o link foi copiado inteiro. {errorMessage(query.error)}</p>
          <Link to="/" className={buttonClass('secondary', 'sm', 'mt-4')}>
            Ir para a vitrine
          </Link>
        </EmptyState>
      );
    }
    return <LoadError title="Não foi possível abrir o comprovante" error={query.error} onRetry={() => void query.refetch()} />;
  }

  const { receipt, lot, server } = query.data;
  const valid = server.valid && lot.chainValid && browserCheck !== 'invalid';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <article className="print-exact overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-xl shadow-stone-900/5 dark:border-stone-800 dark:bg-stone-900">
        <header className="flex items-center justify-between gap-4 bg-stone-900 px-6 py-5 text-white dark:bg-stone-950">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-amber-400 text-stone-950">
              <Gavel className="size-5" />
            </span>
            <div>
              <p className="text-xs tracking-[0.2em] text-amber-300 uppercase">Martelo · Casa de Leilões</p>
              <h1 className="font-display text-2xl font-semibold">Comprovante de arremate</h1>
            </div>
          </div>
          <code className="hidden rounded-lg bg-white/10 px-3 py-1 text-sm sm:block">{receipt.code}</code>
        </header>

        <div className="grid gap-6 p-6 sm:grid-cols-[180px_1fr]">
          <ItemImage src={lot.imageUrl} alt={receipt.itemTitle} className="aspect-[488/680] w-40 rounded-xl shadow-lg sm:w-full" />
          <div className="min-w-0 space-y-5">
            <div>
              <p className="text-sm text-stone-500">Lote #{receipt.lotNumber}</p>
              <h2 className="font-display text-2xl font-semibold wrap-anywhere sm:text-3xl">{receipt.itemTitle}</h2>
              {lot.subtitle && <p className="text-stone-500">{lot.subtitle}</p>}
            </div>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div className="col-span-2 rounded-xl bg-amber-50 p-4 dark:bg-amber-950/40">
                <dt className="text-amber-800 dark:text-amber-300">Valor arrematado</dt>
                <dd className="font-display text-3xl font-semibold tabular-nums wrap-break-word sm:text-4xl">{formatBRL(Number(receipt.amountCents))}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Vencedor (pseudônimo)</dt>
                <dd className="font-mono font-semibold">{receipt.winner}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Encerrado em</dt>
                <dd className="font-medium">{formatDateTimeLong(receipt.closedAt)}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="grid gap-px border-y border-stone-200 bg-stone-200 sm:grid-cols-3 dark:border-stone-800 dark:bg-stone-800">
          <Check3 ok={server.valid} label="Assinatura válida" detail="conferida pelo servidor" />
          <Check3
            ok={browserCheck === 'valid' ? true : browserCheck === 'invalid' ? false : null}
            label="Conferido no navegador"
            detail={BROWSER_DETAIL[browserCheck]}
          />
          <Check3 ok={lot.chainValid} label="Histórico do lote íntegro" detail={`evento de encerramento #${receipt.closeEventSeq}`} />
        </div>

        <dl className="grid gap-2 p-6 text-xs sm:grid-cols-[150px_1fr]">
          <dt className="text-stone-500">Hash do comprovante</dt>
          <dd className="font-mono break-all">{query.data.hash}</dd>
          <dt className="text-stone-500">Evento de encerramento</dt>
          <dd className="font-mono break-all">{receipt.closeEventHash}</dd>
          <dt className="text-stone-500">Assinatura</dt>
          <dd className="font-mono break-all">{query.data.signature}</dd>
          <dt className="text-stone-500">Emitido em</dt>
          <dd>{formatDateTimeLong(receipt.issuedAt)}</dd>
        </dl>

        <p className={clsx('px-6 pb-6 text-sm', valid ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')}>
          {valid
            ? 'Este comprovante foi emitido e assinado pela Martelo, e o arremate está registrado no histórico público do lote.'
            : 'Atenção: este comprovante não passou em todas as verificações.'}{' '}
          O vencedor é identificado só por pseudônimo, sem dados pessoais.
        </p>
      </article>

      <div className="no-print flex flex-wrap justify-center gap-2">
        <Button variant="strong" onClick={() => void copyReceiptLink(receipt.code)}>
          <Copy className="size-4" /> Copiar link para compartilhar
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimir / PDF
        </Button>
        <Link to={`/auditoria/${receipt.lotId}`} className={buttonClass('secondary')}>
          <ShieldCheck className="size-4" /> Auditar histórico do lote
        </Link>
      </div>
    </div>
  );
}

function Check3({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 bg-white px-6 py-4 dark:bg-stone-900">
      <span
        className={clsx(
          'grid size-7 shrink-0 place-items-center rounded-full text-white',
          ok === null ? 'bg-stone-400' : ok ? 'bg-emerald-600' : 'bg-rose-600',
        )}
      >
        {ok === null ? <Fingerprint className="size-4" /> : ok ? <Check className="size-4" /> : <X className="size-4" />}
      </span>
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-stone-500">{detail}</p>
      </div>
    </div>
  );
}
