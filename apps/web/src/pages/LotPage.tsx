import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Crown, ExternalLink, Gavel, ReceiptText, ShieldCheck, Timer, TrendingUp, Trophy, UserRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { computeLotStatus, validateBid, type LotDetailDTO, type PublicBidDTO, type WalletBalanceDTO } from '@leilao/shared';
import { SESSION_KEY, useAuth, type Session } from '../auth/AuthContext';
import { CurrencyInput } from '../components/CurrencyInput';
import { Countdown, ItemImage, StatusBadge } from '../components/lot-bits';
import { Alert, Badge, Button, buttonClass, Card, EmptyState, LoadError, Spinner } from '../components/ui';
import { applyLotUpdate, useLotRoom } from '../hooks/useLotRoom';
import { api, ApiError, errorMessage } from '../lib/api';
import { useNow } from '../lib/clock';
import { formatBRL, formatDateTime, formatTime, ordinal } from '../lib/format';
import { usePageTitle } from '../lib/page-title';
import { useSocketConnected } from '../lib/socket';

const REJECTION_TITLES: Record<string, string> = {
  BELOW_MINIMUM: 'Lance abaixo do mínimo',
  INSUFFICIENT_FUNDS: 'Saldo insuficiente',
  ALREADY_WINNING: 'Você já está ganhando',
  LOT_NOT_STARTED: 'Lote ainda não iniciado',
  LOT_ENDED: 'Lote encerrado',
  LOT_CANCELLED: 'Lote cancelado',
  ROLE_NOT_ALLOWED: 'Ação não permitida',
};

interface BidResponse {
  bid: PublicBidDTO;
  lot: Parameters<typeof applyLotUpdate>[1];
  wallet: WalletBalanceDTO;
}

/** Maior lance de cada licitante, do maior para o menor (1º = líder). */
function rankBidders(bids: PublicBidDTO[]) {
  const best = new Map<string, number>();
  for (const bid of bids) best.set(bid.bidder, Math.max(best.get(bid.bidder) ?? 0, bid.amountCents));
  return [...best.entries()].sort((a, b) => b[1] - a[1]);
}

export function LotPage() {
  const { id } = useParams();
  const query = useQuery({
    queryKey: ['lot', id],
    queryFn: ({ signal }) => api<LotDetailDTO>(`/lots/${id}`, { signal }),
    enabled: !!id,
  });
  useLotRoom(id);
  usePageTitle(query.data?.title);

  if (query.isPending) return <Spinner label="Abrindo a sala do lote..." />;
  // Só troca a sala pelo erro se não há dados: uma falha numa atualização em segundo plano mantém a sala na tela.
  if (!query.data) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return (
        <EmptyState title="Lote não encontrado">
          <p>{errorMessage(query.error)}</p>
          <Link to="/" className={buttonClass('secondary', 'sm', 'mt-4')}>
            Voltar para a vitrine
          </Link>
        </EmptyState>
      );
    }
    return <LoadError title="Não foi possível abrir a sala do lote" error={query.error} onRetry={() => void query.refetch()} />;
  }
  return <LotRoom lot={query.data} />;
}

function LotRoom({ lot }: { lot: LotDetailDTO }) {
  const now = useNow();
  const status = computeLotStatus(lot, new Date(now));
  const me = lot.viewer?.pseudonym ?? null;
  const ranking = useMemo(() => rankBidders(lot.bids), [lot.bids]);
  const position = me ? ranking.findIndex(([bidder]) => bidder === me) + 1 || null : null;
  const myBest = me ? (ranking.find(([bidder]) => bidder === me)?.[1] ?? null) : null;
  const isLeader = !!me && lot.leaderPseudonym === me;

  // No celular a ordem muda (max-md:contents + order): imagem, título e logo em seguida o painel de lance;
  // os detalhes do item vêm depois, para ninguém rolar a página inteira até achar o botão.
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_400px]">
      <section className="max-md:contents md:space-y-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1 justify-self-start text-sm text-stone-500 hover:text-stone-800 max-md:order-1 dark:hover:text-stone-200"
        >
          <ArrowLeft className="size-4" /> Vitrine
        </Link>
        <div className="max-md:contents md:grid md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] md:gap-6 xl:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <ItemImage
            src={lot.imageUrl}
            alt={lot.title}
            className="mx-auto aspect-[488/680] w-full max-w-64 rounded-[18px] shadow-2xl shadow-stone-900/20 max-md:order-2 md:max-w-none"
          />
          <div className="max-md:contents md:space-y-5">
            <div className="min-w-0 space-y-2 max-md:order-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={status} />
                <Badge>Lote #{lot.number}</Badge>
                {lot.category && <Badge tone="warning">{lot.category}</Badge>}
              </div>
              <h1 className="font-display text-3xl font-semibold tracking-tight wrap-anywhere sm:text-4xl">{lot.title}</h1>
              <p className="text-stone-500 dark:text-stone-400">{lot.subtitle}</p>
              <p className="text-sm text-stone-500 wrap-anywhere">
                Leiloeiro: <span className="font-medium text-stone-700 dark:text-stone-300">{lot.sellerName}</span>
              </p>
            </div>

            <div className="min-w-0 space-y-5 max-md:order-5">
              {lot.description && <p className="leading-relaxed whitespace-pre-line text-stone-700 wrap-anywhere dark:text-stone-300">{lot.description}</p>}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-stone-200 p-4 text-sm dark:border-stone-800">
                {lot.attributes.map((attribute) => (
                  <div key={attribute.label} className="min-w-0">
                    <dt className="text-xs text-stone-500">{attribute.label}</dt>
                    <dd className="truncate font-medium" title={attribute.value}>
                      {attribute.value}
                    </dd>
                  </div>
                ))}
              </dl>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ['Lance inicial', formatBRL(lot.startingPriceCents)],
                  ['Incremento mínimo', formatBRL(lot.minIncrementCents)],
                  ['Início', formatDateTime(lot.startsAt)],
                  ['Fim original', formatDateTime(lot.originalEndsAt)],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0 rounded-xl bg-stone-100 p-3 dark:bg-stone-900">
                    <dt className="text-xs text-stone-500">{label}</dt>
                    <dd className="font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>

              {lot.externalUrl && (
                <a
                  href={lot.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-amber-700 hover:underline dark:text-amber-400"
                >
                  Ver ficha completa no Scryfall <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Fixo ao rolar só em telas altas: numa tela baixa o botão de lance ficaria cortado. */}
      <aside className="min-w-0 space-y-4 max-md:order-4 lg:row-span-2 lg:self-start lg:tall:sticky lg:tall:top-24">
        <BidPanel lot={lot} status={status} me={me} isLeader={isLeader} myBest={myBest} position={position} />
      </aside>

      <BidHistory lot={lot} status={status} me={me} className="max-md:order-6" />
    </div>
  );
}

/* -------------------------------------------------------------- painel */

function BidPanel({
  lot,
  status,
  me,
  isLeader,
  myBest,
  position,
}: {
  lot: LotDetailDTO;
  status: ReturnType<typeof computeLotStatus>;
  me: string | null;
  isLeader: boolean;
  myBest: number | null;
  position: number | null;
}) {
  const { user, session } = useAuth();
  const queryClient = useQueryClient();
  const now = useNow();
  // null = campo intocado (sugere o mínimo); { value: null } = usuário apagou o campo.
  const [typed, setTyped] = useState<{ value: number | null } | null>(null);
  const [rejection, setRejection] = useState<{ code: string; message: string } | null>(null);
  const amount = typed ? typed.value : lot.minimumNextBidCents;
  const choose = (value: number | null) => {
    setTyped({ value });
    setRejection(null);
  };
  const available = session?.wallet?.availableCents ?? lot.viewer?.availableCents ?? 0;
  const isBidder = user?.role === 'BIDDER';
  const inSnipingWindow = status === 'LIVE' && Date.parse(lot.endsAt) - now <= 2 * 60_000;

  // Se alguém cobriu e o valor digitado ficou abaixo do novo mínimo, volta a sugerir o mínimo.
  useEffect(() => {
    if (typed?.value != null && typed.value < lot.minimumNextBidCents) setTyped(null);
  }, [lot.minimumNextBidCents]);

  const mutation = useMutation({
    mutationFn: (amountCents: number) => api<BidResponse>(`/lots/${lot.id}/bids`, { method: 'POST', body: { amountCents } }),
    onSuccess: (response) => {
      queryClient.setQueryData<LotDetailDTO>(['lot', lot.id], (current) => (current ? applyLotUpdate(current, response.lot) : current));
      queryClient.setQueryData<Session | null>(SESSION_KEY, (session) => (session ? { ...session, wallet: response.wallet } : session));
      setTyped(null);
      setRejection(null);
      toast.success(`Lance de ${formatBRL(response.bid.amountCents)} registrado!`, {
        description: response.bid.extendedEndsAt ? 'Lance nos últimos 2 minutos: o lote foi prorrogado.' : 'Você está liderando este lote.',
      });
    },
    onError: (error) => {
      const code = error instanceof ApiError ? error.code : 'ERROR';
      setRejection({ code, message: errorMessage(error) });
      toast.error(REJECTION_TITLES[code] ?? 'Lance não aceito', { description: errorMessage(error) });
      void queryClient.invalidateQueries({ queryKey: ['lot', lot.id] });
    },
  });

  const submit = () => {
    if (!me) return;
    if (amount === null) {
      setRejection({ code: 'EMPTY', message: 'Informe o valor do lance.' });
      return;
    }
    // Mesma função de regras do servidor, só para responder na hora. Quem decide é a API.
    const check = validateBid({
      lot: {
        startsAt: new Date(lot.startsAt),
        endsAt: new Date(lot.endsAt),
        cancelledAt: lot.cancelledAt ? new Date(lot.cancelledAt) : null,
        closedAt: lot.closedAt ? new Date(lot.closedAt) : null,
        startingPriceCents: lot.startingPriceCents,
        minIncrementCents: lot.minIncrementCents,
        currentPriceCents: lot.currentPriceCents,
        leaderId: lot.leaderPseudonym,
      },
      bidderId: me,
      amountCents: amount,
      availableCents: available,
      now: new Date(now),
    });
    if (!check.ok) {
      setRejection({ code: check.code, message: check.message });
      return;
    }
    mutation.mutate(amount);
  };

  const leaderLabel = lot.leaderPseudonym ? (lot.leaderPseudonym === me ? 'você' : lot.leaderPseudonym) : null;

  return (
    <Card className="overflow-hidden">
      <div className="space-y-5 p-5">
        <div>
          <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">
            {status === 'ENDED' && lot.result === 'SOLD' ? 'Arrematado por' : lot.currentPriceCents ? 'Lance atual' : 'Lance inicial'}
          </p>
          <p key={lot.currentPriceCents} className="animate-flash rounded-md font-display text-3xl font-semibold tabular-nums wrap-break-word sm:text-4xl">
            {formatBRL(lot.currentPriceCents ?? lot.startingPriceCents)}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-500">
            {leaderLabel && (
              <span className="inline-flex items-center gap-1">
                <Crown className="size-3.5 text-amber-500" /> {leaderLabel}
              </span>
            )}
            <span>
              {lot.bidCount} {lot.bidCount === 1 ? 'lance' : 'lances'} · {lot.distinctBidders} {lot.distinctBidders === 1 ? 'licitante' : 'licitantes'}
            </span>
          </p>
        </div>

        <TimeBox lot={lot} status={status} inSnipingWindow={inSnipingWindow} />

        <div aria-live="polite" className="space-y-3">
          {isBidder &&
            myBest !== null &&
            status === 'LIVE' &&
            (isLeader ? (
              <div className="flex items-start gap-3 rounded-xl bg-emerald-600 p-4 text-white">
                <TrendingUp className="mt-0.5 size-5 shrink-0" />
                <div>
                  <p className="font-semibold">Você está ganhando!</p>
                  <p className="text-sm text-emerald-50">Seu lance de {formatBRL(myBest)} é o maior. O valor está comprometido na sua carteira.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-xl bg-rose-600 p-4 text-white">
                <Gavel className="mt-0.5 size-5 shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold">Você foi superado</p>
                  <p className="text-sm text-rose-50">
                    Seu maior lance: {formatBRL(myBest)} — você está em {ordinal(position ?? 0)} de {lot.distinctBidders}. O valor voltou para o seu saldo
                    disponível.
                  </p>
                </div>
              </div>
            ))}

          {status === 'ENDED' && <ResultBox lot={lot} me={me} />}
          {status === 'CANCELLED' && (
            <Alert tone="danger" title="Lote cancelado pelo leiloeiro">
              {lot.cancelReason ?? 'Sem motivo informado.'} Valores comprometidos foram estornados automaticamente.
            </Alert>
          )}
        </div>

        {!user && status !== 'ENDED' && status !== 'CANCELLED' && (
          <div className="space-y-3 rounded-xl border border-dashed border-stone-300 p-4 text-center dark:border-stone-700">
            <p className="text-sm text-stone-600 dark:text-stone-400">Entre como licitante para dar lances.</p>
            <div className="flex justify-center gap-2">
              <Link to={`/entrar?next=/lotes/${lot.id}`} className={buttonClass('strong', 'sm')}>
                Entrar
              </Link>
              <Link to="/cadastro" className={buttonClass('secondary', 'sm')}>
                Criar conta
              </Link>
            </div>
          </div>
        )}

        {user?.role === 'AUCTIONEER' && (status === 'LIVE' || status === 'SCHEDULED') && (
          <Alert tone="info">Leiloeiros não podem dar lances — você está acompanhando a sala como observador.</Alert>
        )}

        {isBidder && (status === 'LIVE' || status === 'SCHEDULED') && (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {status === 'SCHEDULED' && (
              <Alert tone="info" title="Lote ainda não iniciado">
                Os lances abrem em {formatDateTime(lot.startsAt)}.
              </Alert>
            )}
            {isLeader ? (
              <p className="text-sm text-stone-500">Você é o líder: não é possível cobrir o próprio lance. Se alguém superar, você será avisado aqui.</p>
            ) : (
              <>
                <CurrencyInput large value={amount} onChange={choose} ariaLabel="Valor do lance" disabled={status !== 'LIVE'} />
                <div className="flex flex-wrap gap-2">
                  {[
                    ['Mínimo', lot.minimumNextBidCents],
                    ['+1 incremento', lot.minimumNextBidCents + lot.minIncrementCents],
                    ['+5 incrementos', lot.minimumNextBidCents + 5 * lot.minIncrementCents],
                  ].map(([label, value]) => (
                    <button
                      key={label}
                      type="button"
                      disabled={status !== 'LIVE'}
                      onClick={() => choose(value as number)}
                      className={clsx(
                        'rounded-full border px-3 py-1 text-xs font-medium tabular-nums transition-colors disabled:opacity-50',
                        amount === value
                          ? 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                          : 'border-stone-300 hover:border-stone-400 dark:border-stone-700',
                      )}
                    >
                      {label}: {formatBRL(value as number)}
                    </button>
                  ))}
                </div>
                <p className="flex flex-wrap justify-between gap-x-3 text-xs text-stone-500">
                  <span>Mínimo: {formatBRL(lot.minimumNextBidCents)}</span>
                  <span>
                    Disponível: <strong className={clsx(amount !== null && available < amount && 'text-rose-600')}>{formatBRL(available)}</strong>
                  </span>
                </p>

                {rejection && (
                  <Alert tone="danger" title={REJECTION_TITLES[rejection.code] ?? 'Lance não aceito'} role="alert">
                    {rejection.message}
                    {rejection.code === 'INSUFFICIENT_FUNDS' && (
                      <>
                        {' '}
                        <Link to="/carteira" className="font-semibold underline">
                          Depositar na carteira
                        </Link>
                      </>
                    )}
                  </Alert>
                )}

                <Button type="submit" size="lg" className="w-full" loading={mutation.isPending} disabled={status !== 'LIVE' || amount === null}>
                  <Gavel className="size-5" /> {amount === null ? 'Dar lance' : `Dar lance de ${formatBRL(amount)}`}
                </Button>
              </>
            )}
          </form>
        )}
      </div>

      <div className="space-y-2 border-t border-stone-200 bg-stone-50 px-5 py-4 text-sm dark:border-stone-800 dark:bg-stone-950/50">
        {me && (
          <p className="flex items-center gap-2 text-stone-600 dark:text-stone-400">
            <UserRound className="size-4" /> Seu pseudônimo neste lote: <code className="font-semibold text-stone-900 dark:text-stone-100">{me}</code>
          </p>
        )}
        <Link to={`/auditoria/${lot.id}`} className="flex items-center gap-2 font-medium text-amber-700 hover:underline dark:text-amber-400">
          <ShieldCheck className="size-4" /> Auditar o histórico deste lote (público)
        </Link>
      </div>
    </Card>
  );
}

function TimeBox({ lot, status, inSnipingWindow }: { lot: LotDetailDTO; status: string; inSnipingWindow: boolean }) {
  if (status === 'LIVE') {
    return (
      <div className={clsx('rounded-xl p-4', inSnipingWindow ? 'bg-rose-50 dark:bg-rose-950/40' : 'bg-stone-100 dark:bg-stone-800/60')}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-400">
            <Timer className="size-4" /> Termina em
          </span>
          {lot.extensionCount > 0 && <Badge tone="warning">Prorrogado {lot.extensionCount}×</Badge>}
        </div>
        <Countdown target={lot.endsAt} className="block font-display text-3xl font-semibold" />
        <p className="text-xs text-stone-500">{formatDateTime(lot.endsAt)}</p>
        {inSnipingWindow && (
          <p className="mt-2 text-xs font-medium text-rose-700 dark:text-rose-300">
            Reta final: qualquer lance aceito agora prorroga o fim para 2 minutos depois dele (anti-sniping).
          </p>
        )}
      </div>
    );
  }
  if (status === 'SCHEDULED') {
    return (
      <div className="rounded-xl bg-sky-50 p-4 dark:bg-sky-950/40">
        <p className="flex items-center gap-2 text-sm text-sky-800 dark:text-sky-300">
          <Timer className="size-4" /> Começa em
        </p>
        <Countdown target={lot.startsAt} className="block font-display text-3xl font-semibold" />
        <p className="text-xs text-stone-500">
          {formatDateTime(lot.startsAt)} → {formatDateTime(lot.endsAt)}
        </p>
      </div>
    );
  }
  if (status === 'ENDED') {
    return <p className="text-sm text-stone-500">Lote encerrado em {formatDateTime(lot.endsAt)} — não aceita mais lances.</p>;
  }
  return null;
}

/** Aguardando a liquidação. O aviso normalmente chega pelo WebSocket; consultar de tempos em tempos cobre uma conexão caída. */
function Settling({ lotId }: { lotId: string }) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const timer = setInterval(() => void queryClient.invalidateQueries({ queryKey: ['lot', lotId] }), 3000);
    return () => clearInterval(timer);
  }, [lotId, queryClient]);
  return <Spinner className="py-2" label="Encerrado — liquidando o lote..." />;
}

function ResultBox({ lot, me }: { lot: LotDetailDTO; me: string | null }) {
  if (!lot.closedAt) return <Settling lotId={lot.id} />;
  if (lot.result !== 'SOLD')
    return (
      <Alert tone="info" title="Encerrado sem lances">
        O lote fechou sem vencedor.
      </Alert>
    );

  const iWon = !!me && lot.leaderPseudonym === me;
  return (
    <div className={clsx('space-y-3 rounded-xl p-4', iWon ? 'bg-emerald-600 text-white' : 'bg-stone-100 dark:bg-stone-800/60')}>
      <p className="flex items-center gap-2 font-semibold">
        <Trophy className="size-5 shrink-0" /> {iWon ? 'Você arrematou este lote!' : `Arrematado por ${lot.leaderPseudonym}`}
      </p>
      {lot.receiptCode && (
        <Link to={`/comprovante/${lot.receiptCode}`} className={buttonClass(iWon ? 'secondary' : 'strong', 'sm')}>
          <ReceiptText className="size-4" /> Ver comprovante de arremate
        </Link>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ histórico */

const EMPTY_HISTORY: Record<ReturnType<typeof computeLotStatus>, string> = {
  LIVE: 'Nenhum lance ainda. Seja o primeiro!',
  SCHEDULED: 'Nenhum lance ainda: os lances abrem no início do lote.',
  ENDED: 'Nenhum lance foi dado neste lote.',
  CANCELLED: 'Nenhum lance foi dado neste lote.',
};

function BidHistory({ lot, status, me, className }: { lot: LotDetailDTO; status: ReturnType<typeof computeLotStatus>; me: string | null; className?: string }) {
  const connected = useSocketConnected();
  // Lances que chegaram depois da abertura da página ganham destaque.
  const seen = useRef<Set<number> | null>(null);
  if (seen.current === null) seen.current = new Set(lot.bids.map((bid) => bid.seq));
  const today = new Date().toDateString();

  return (
    <Card className={clsx('p-5', className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-xl font-semibold">Histórico de lances</h2>
        {(status === 'LIVE' || status === 'SCHEDULED') && (
          <span className="flex items-center gap-2 text-xs text-stone-500">
            <span className={clsx('size-2 rounded-full', connected ? 'animate-pulse bg-emerald-500' : 'bg-amber-500')} aria-hidden />
            {connected ? 'atualiza ao vivo' : 'reconectando…'}
          </span>
        )}
      </div>
      {lot.bids.length === 0 ? (
        <p className="py-6 text-center text-sm text-stone-500">{EMPTY_HISTORY[status]}</p>
      ) : (
        <ol className="divide-y divide-stone-100 dark:divide-stone-800">
          {lot.bids.map((bid, index) => {
            const fresh = !seen.current!.has(bid.seq);
            const mine = bid.bidder === me;
            return (
              <li
                key={bid.seq}
                className={clsx('flex items-center gap-3 rounded-lg px-2 py-2.5', fresh && 'animate-slide-in', index === 0 && fresh && 'animate-flash')}
              >
                <span className="w-6 text-center">
                  {index === 0 ? (
                    <Crown className="mx-auto size-4 text-amber-500" aria-label="Lance atual" />
                  ) : (
                    <span className="text-xs text-stone-400">#{bid.seq}</span>
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  <code className={clsx('min-w-0 text-[13px] wrap-anywhere sm:text-sm', mine && 'font-bold text-amber-700 dark:text-amber-400')}>
                    {bid.bidder}
                  </code>
                  {mine && <Badge tone="warning">você</Badge>}
                  {bid.extendedEndsAt && <Badge tone="info">prorrogou +2 min</Badge>}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-semibold tabular-nums">{formatBRL(bid.amountCents)}</span>
                  <span className="block text-xs text-stone-500 tabular-nums">
                    {new Date(bid.placedAt).toDateString() === today ? formatTime(bid.placedAt) : formatDateTime(bid.placedAt)}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
