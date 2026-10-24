import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Check, ChevronDown, Fingerprint, Link2, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  Ed25519UnsupportedError,
  createWebAuditCrypto,
  eventPreimage,
  verifyChain,
  type AuditDTO,
  type ChainIssue,
  type ChainVerification,
  type LotEventType,
  type SignedChainEvent,
} from '@leilao/shared';
import { ItemImage, StatusBadge } from '../components/lot-bits';
import { Alert, Badge, buttonClass, Card, EmptyState, LoadError, Spinner } from '../components/ui';
import { useLotRoom } from '../hooks/useLotRoom';
import { api, ApiError, errorMessage } from '../lib/api';
import { socket } from '../lib/socket';
import { formatBRL, formatDateTimeLong, shortHash } from '../lib/format';
import { usePageTitle } from '../lib/page-title';

const EVENT_LABEL: Record<LotEventType, string> = {
  LOT_CREATED: 'Lote criado',
  BID_PLACED: 'Lance',
  LOT_CLOSED: 'Encerramento',
  LOT_CANCELLED: 'Cancelamento',
};

type BrowserCheck = { state: 'running' } | { state: 'done'; result: ChainVerification } | { state: 'unsupported' } | { state: 'error'; message: string };

/** Verificação independente, no navegador, com o mesmo algoritmo do servidor. */
function useBrowserVerification(audit: AuditDTO | undefined): BrowserCheck {
  const [check, setCheck] = useState<BrowserCheck>({ state: 'running' });
  useEffect(() => {
    if (!audit) return;
    let cancelled = false;
    setCheck({ state: 'running' });
    (async () => {
      try {
        const result = await verifyChain({ lotId: audit.lot.id, events: audit.events, head: audit.head, publicKey: audit.publicKey }, createWebAuditCrypto());
        if (!cancelled) setCheck({ state: 'done', result });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof Ed25519UnsupportedError) setCheck({ state: 'unsupported' });
        else setCheck({ state: 'error', message: errorMessage(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audit]);
  return check;
}

export function AuditPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['audit', id],
    queryFn: ({ signal }) => api<AuditDTO>(`/audit/lots/${id}`, { signal }),
    enabled: !!id,
    refetchOnWindowFocus: false,
  });
  const browser = useBrowserVerification(query.data);

  // Novos lances aparecem na auditoria em tempo real (e são reverificados).
  useLotRoom(id);
  useEffect(() => {
    const refresh = (payload: { lotId: string }) => {
      if (payload.lotId === id) void queryClient.invalidateQueries({ queryKey: ['audit', id] });
    };
    socket.on('lot:update', refresh);
    socket.on('lot:closed', refresh);
    socket.on('lot:cancelled', refresh);
    return () => {
      socket.off('lot:update', refresh);
      socket.off('lot:closed', refresh);
      socket.off('lot:cancelled', refresh);
    };
  }, [id, queryClient]);
  usePageTitle(query.data ? `Auditoria · ${query.data.lot.title}` : 'Auditoria');

  if (query.isPending) return <Spinner label="Carregando e verificando o histórico..." />;
  if (!query.data) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return (
        <EmptyState title="Lote não encontrado">
          <p>{errorMessage(query.error)}</p>
          <Link to="/" className={buttonClass('secondary', 'sm', 'mt-4')}>
            Ir para a vitrine
          </Link>
        </EmptyState>
      );
    }
    return <LoadError title="Não foi possível auditar este lote" error={query.error} onRetry={() => void query.refetch()} />;
  }

  const audit = query.data;
  const browserResult = browser.state === 'done' ? browser.result : null;
  const intact = audit.server.valid && (browserResult ? browserResult.valid : true);
  const issues = dedupeIssues([...audit.server.issues, ...audit.server.consistency, ...(browserResult?.issues ?? [])]);
  const checks = new Map((browserResult ?? audit.server).events.map((check) => [check.seq, check]));

  return (
    <div className="space-y-6">
      <Link to={`/lotes/${audit.lot.id}`} className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800 dark:hover:text-stone-200">
        <ArrowLeft className="size-4" /> Sala do lote
      </Link>

      <div className="flex items-center gap-4">
        <ItemImage src={audit.lot.imageUrl} alt={audit.lot.title} className="aspect-[488/680] w-16 shrink-0 rounded-md" />
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.2em] text-amber-600 uppercase dark:text-amber-400">Auditoria pública · Lote #{audit.lot.number}</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight wrap-anywhere sm:text-3xl">{audit.lot.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone-500">
            <StatusBadge status={audit.lot.status} /> {audit.events.length} eventos registrados
          </div>
        </div>
      </div>

      <Card className={clsx('overflow-hidden border-2', intact ? 'border-emerald-500/60' : 'border-rose-500/70')}>
        <div
          className={clsx(
            'flex flex-col gap-4 p-6 sm:flex-row sm:items-center',
            intact ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-rose-50 dark:bg-rose-950/30',
          )}
        >
          {intact ? <ShieldCheck className="size-14 shrink-0 text-emerald-600" /> : <ShieldAlert className="size-14 shrink-0 text-rose-600" />}
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-semibold">{intact ? 'Histórico íntegro' : 'Histórico adulterado'}</h2>
            <p className="text-sm text-stone-600 dark:text-stone-300">
              {intact
                ? 'Todos os eventos conferem com seus hashes, estão encadeados na ordem certa e foram assinados pela chave do leilão. Nada foi alterado, removido ou inserido depois do registro.'
                : 'Foram encontradas inconsistências: o histórico deste lote foi modificado fora do fluxo normal da aplicação.'}
            </p>
          </div>
        </div>
        <div className="grid divide-y divide-stone-200 text-sm sm:grid-cols-2 sm:divide-x sm:divide-y-0 dark:divide-stone-800">
          <VerdictRow
            label="Verificado pelo servidor"
            ok={audit.server.valid}
            detail={`Cadeia + consistência com o estado do lote · ${formatDateTimeLong(audit.verifiedAt)}`}
          />
          {browser.state === 'done' && (
            <VerdictRow
              label="Verificado no seu navegador"
              ok={browser.result.valid}
              detail="Recalculado aqui com WebCrypto (SHA-256 + Ed25519), sem confiar no servidor"
            />
          )}
          {browser.state === 'running' && <VerdictRow label="Verificando no seu navegador…" ok={null} detail="Recalculando hashes e assinaturas" />}
          {browser.state === 'unsupported' && (
            <VerdictRow
              label="Verificação local indisponível"
              ok={null}
              detail="Seu navegador não suporta Ed25519 no WebCrypto. Atualize-o para verificar localmente."
            />
          )}
          {browser.state === 'error' && <VerdictRow label="Falha na verificação local" ok={null} detail={browser.message} />}
        </div>
      </Card>

      {issues.length > 0 && (
        <Alert tone="danger" title={`${issues.length} problema(s) encontrado(s)`} role="alert">
          <ul className="list-disc space-y-1 pl-4">
            {issues.map((issue) => (
              <li key={`${issue.code}-${issue.seq}-${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-stone-200 px-5 py-4 dark:border-stone-800">
          <h2 className="font-display text-xl font-semibold">Cadeia de eventos</h2>
          <span className="text-xs text-stone-500">toque em um evento para ver os dados assinados</span>
        </div>
        <ol>
          {audit.events.map((event) => (
            <EventRow key={event.seq} event={event} check={checks.get(event.seq)} problems={issues.filter((issue) => issue.seq === event.seq)} />
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-stone-200 bg-stone-50 px-5 py-4 text-xs dark:border-stone-800 dark:bg-stone-950/50">
          <span className="font-semibold">Cabeça da cadeia (selo do lote):</span>
          <span>{audit.head.length} eventos</span>
          <code title={audit.head.hash}>{shortHash(audit.head.hash)}</code>
          <CheckMark ok={(browserResult ?? audit.server).head.signatureValid} label="assinatura da cabeça" />
        </div>
      </Card>

      <HowItWorks audit={audit} />
    </div>
  );
}

function dedupeIssues(issues: ChainIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}|${issue.seq}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function VerdictRow({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
  return (
    <div className="flex items-start gap-3 p-4">
      <span
        className={clsx(
          'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-white',
          ok === null ? 'bg-stone-400' : ok ? 'bg-emerald-600' : 'bg-rose-600',
        )}
      >
        {ok === null ? <Fingerprint className="size-3.5" /> : ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
      </span>
      <div>
        <p className="font-semibold">{label}</p>
        <p className="text-xs text-stone-500">{detail}</p>
      </div>
    </div>
  );
}

function CheckMark({ ok, label }: { ok: boolean | undefined; label: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1', ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')}>
      {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />} {label}
    </span>
  );
}

function EventRow({
  event,
  check,
  problems,
}: {
  event: SignedChainEvent;
  check?: { hashValid: boolean; linkValid: boolean; signatureValid: boolean };
  problems: ChainIssue[];
}) {
  const [open, setOpen] = useState(false);
  const bad = problems.length > 0 || (check && !(check.hashValid && check.linkValid && check.signatureValid));
  const actorLabel = event.type === 'LOT_CREATED' || event.type === 'LOT_CANCELLED' ? 'leiloeiro' : event.type === 'LOT_CLOSED' ? 'vencedor' : 'licitante';

  return (
    <li className={clsx('border-b border-stone-100 last:border-0 dark:border-stone-800', bad && 'bg-rose-50 dark:bg-rose-950/30')}>
      {/* Celular: tipo + valor na 1ª linha, autor, data e selos embaixo. Desktop (lg): tudo numa linha (via order). */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-4 py-3 text-left text-sm sm:gap-3 sm:px-5 lg:items-center"
        aria-expanded={open}
      >
        <span className="w-6 shrink-0 pt-0.5 font-mono text-xs text-stone-400 sm:w-8 lg:pt-0">#{event.seq}</span>
        <span className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 lg:grid-cols-[7rem_minmax(0,1fr)_8rem_13rem_auto] lg:gap-x-4">
          <span className="font-semibold">{EVENT_LABEL[event.type]}</span>
          <span className="text-right font-semibold tabular-nums lg:order-3">{event.amountCents ? formatBRL(Number(event.amountCents)) : ''}</span>
          <span className="col-span-2 truncate text-stone-500 lg:order-2 lg:col-span-1">
            {event.actor ? (
              <>
                {actorLabel} <code className="text-stone-800 dark:text-stone-200">{event.actor}</code>
              </>
            ) : (
              '—'
            )}
          </span>
          <span className="col-span-2 text-xs text-stone-500 tabular-nums lg:order-4 lg:col-span-1">{formatDateTimeLong(event.occurredAt)}</span>
          <span className="col-span-2 flex flex-wrap gap-1 lg:order-5 lg:col-span-1">
            {check && (
              <>
                <Badge tone={check.hashValid ? 'success' : 'danger'}>hash</Badge>
                <Badge tone={check.linkValid ? 'success' : 'danger'}>elo</Badge>
                <Badge tone={check.signatureValid ? 'success' : 'danger'}>assinatura</Badge>
              </>
            )}
          </span>
        </span>
        <ChevronDown
          className={clsx('mt-0.5 size-4 shrink-0 text-stone-400 transition-transform motion-reduce:transition-none lg:mt-0', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="space-y-3 px-5 pb-4 text-xs">
          {problems.map((problem) => (
            <p key={problem.message} className="font-medium text-rose-700 dark:text-rose-300">
              {problem.message}
            </p>
          ))}
          <dl className="grid gap-2 sm:grid-cols-[120px_1fr]">
            <dt className="text-stone-500">hash anterior</dt>
            <dd className="font-mono break-all">{event.prevHash}</dd>
            <dt className="text-stone-500">hash</dt>
            <dd className="font-mono break-all">{event.hash}</dd>
            <dt className="text-stone-500">assinatura</dt>
            <dd className="font-mono break-all">{event.signature}</dd>
            <dt className="text-stone-500">conteúdo assinado</dt>
            <dd>
              <pre className="overflow-x-auto rounded-lg bg-stone-100 p-3 font-mono whitespace-pre-wrap break-all dark:bg-stone-950">
                {eventPreimage(event)}
              </pre>
            </dd>
          </dl>
        </div>
      )}
    </li>
  );
}

function HowItWorks({ audit }: { audit: AuditDTO }) {
  return (
    <details className="group rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <summary className="flex cursor-pointer list-none items-center justify-between font-display text-xl font-semibold">
        Como esta verificação funciona
        <ChevronDown className="size-5 text-stone-400 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-stone-700 dark:text-stone-300">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Cada evento do lote (criação, lances, encerramento) é serializado de forma canônica e recebe um <strong>hash SHA-256</strong>. Mudar qualquer campo
            — valor, horário, licitante — muda o hash.
          </li>
          <li>
            Cada evento guarda o <strong>hash do anterior</strong> (<Link2 className="inline size-3.5" /> elo). Remover ou inserir um evento no meio quebra a
            corrente a partir dali.
          </li>
          <li>
            Cada hash é <strong>assinado com Ed25519</strong> pela chave privada do leilão, que fica fora do banco de dados. Quem altera o banco consegue
            recalcular hashes, mas não consegue gerar assinaturas válidas.
          </li>
          <li>
            O lote guarda um <strong>selo assinado</strong> com o tamanho e o último hash da cadeia. Isso detecta a remoção dos últimos lances.
          </li>
          <li>O servidor ainda confere se o estado do lote (preço atual, líder, horário de fim, vencedor) bate com o que a cadeia descreve.</li>
        </ol>
        <p>
          A verificação acima roda <strong>duas vezes</strong>: no servidor e aqui no seu navegador, com o mesmo código, usando só a chave pública abaixo. Você
          não precisa confiar no servidor para saber se o histórico é íntegro.
        </p>
        <dl className="grid gap-2 rounded-xl bg-stone-100 p-4 text-xs sm:grid-cols-[140px_1fr] dark:bg-stone-950">
          <dt className="text-stone-500">Algoritmo</dt>
          <dd>{audit.algorithm}</dd>
          <dt className="text-stone-500">Chave pública</dt>
          <dd className="font-mono break-all">{audit.publicKey}</dd>
          <dt className="text-stone-500">API pública</dt>
          <dd className="font-mono break-all">GET /api/audit/lots/{audit.lot.id}</dd>
        </dl>
        <p>
          <strong>Privacidade:</strong> licitantes aparecem só por pseudônimo (ex.: <code>L-3FA9C2D1</code>). O mesmo licitante tem pseudônimos diferentes em
          lotes diferentes, então não é possível rastrear o que uma pessoa comprou.
        </p>
        <Link to={`/lotes/${audit.lot.id}`} className={buttonClass('secondary', 'sm')}>
          Voltar para a sala do lote
        </Link>
      </div>
    </details>
  );
}
