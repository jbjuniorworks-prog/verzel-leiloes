import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Copy, Gavel, Printer, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { createWebAuditCrypto, verifyReceipt, type ReceiptDTO } from '@leilao/shared';
import { ItemImage } from '../components/lot-bits';
import { Button, buttonClass, EmptyState, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatBRL, formatDateTimeLong } from '../lib/format';
import { copyReceiptLink } from './MyBidsPage';

export function ReceiptPage() {
  const { code } = useParams();
  const query = useQuery({ queryKey: ['receipt', code], queryFn: ({ signal }) => api<ReceiptDTO>(`/receipts/${code}`, { signal }), enabled: !!code });
  const [browserValid, setBrowserValid] = useState<boolean | null>(null);

  useEffect(() => {
    const data = query.data;
    if (!data) return;
    verifyReceipt({ receipt: data.receipt, hash: data.hash, signature: data.signature, publicKey: data.publicKey }, createWebAuditCrypto())
      .then((result) => setBrowserValid(result.valid))
      .catch(() => setBrowserValid(null));
  }, [query.data]);

  if (query.isPending) return <Spinner />;
  if (query.isError) {
    return (
      <EmptyState title="Comprovante não encontrado">
        <p>{errorMessage(query.error)}</p>
      </EmptyState>
    );
  }

  const { receipt, lot, server } = query.data;
  const valid = server.valid && lot.chainValid && browserValid !== false;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <article className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-xl shadow-stone-900/5 dark:border-stone-800 dark:bg-stone-900">
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
          <div className="space-y-5">
            <div>
              <p className="text-sm text-stone-500">Lote #{receipt.lotNumber}</p>
              <h2 className="font-display text-3xl font-semibold">{receipt.itemTitle}</h2>
              {lot.subtitle && <p className="text-stone-500">{lot.subtitle}</p>}
            </div>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div className="col-span-2 rounded-xl bg-amber-50 p-4 dark:bg-amber-950/40">
                <dt className="text-amber-800 dark:text-amber-300">Valor arrematado</dt>
                <dd className="font-display text-4xl font-semibold tabular-nums">{formatBRL(Number(receipt.amountCents))}</dd>
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
          <Check3 ok={browserValid} label="Conferido no navegador" detail="Ed25519 via WebCrypto" />
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
      <span className={clsx('grid size-7 place-items-center rounded-full text-white', ok === null ? 'bg-stone-400' : ok ? 'bg-emerald-600' : 'bg-rose-600')}>
        {ok === false ? <X className="size-4" /> : <Check className="size-4" />}
      </span>
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-stone-500">{detail}</p>
      </div>
    </div>
  );
}
