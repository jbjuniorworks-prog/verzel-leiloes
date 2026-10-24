import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, CheckCircle2, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { CatalogItemDTO, CatalogSearchDTO, CreateLotInput, LotSummaryDTO } from '@leilao/shared';
import { CurrencyInput } from '../components/CurrencyInput';
import { ItemImage } from '../components/lot-bits';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, inputClass, PageHeader, Spinner } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import { serverNow } from '../lib/clock';
import { formatBRL, formatDateTime } from '../lib/format';
import { usePageTitle } from '../lib/page-title';

const SUGGESTIONS = ['Black Lotus', 'Dragon', 'Jace', 'Mox', 'Liliana', 'Force of Will'];

const MINUTE = 60_000;
const RESULTS_STEP = 30;
const DURATIONS = [
  { label: '3 min', ms: 3 * MINUTE },
  { label: '10 min', ms: 10 * MINUTE },
  { label: '1 hora', ms: 60 * MINUTE },
  { label: '1 dia', ms: 24 * 60 * MINUTE },
  { label: '3 dias', ms: 3 * 24 * 60 * MINUTE },
  { label: '7 dias', ms: 7 * 24 * 60 * MINUTE },
];

/** Date → valor do <input type="datetime-local"> no fuso do navegador. */
function toLocalInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * MINUTE);
  return local.toISOString().slice(0, 16);
}

export function NewLotPage() {
  const [selected, setSelected] = useState<CatalogItemDTO | null>(null);
  usePageTitle('Novo lote');

  return (
    <div>
      <Link to="/painel" className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800 dark:hover:text-stone-200">
        <ArrowLeft className="size-4" /> Painel
      </Link>
      <PageHeader
        eyebrow="Leiloeiro"
        title="Novo lote"
        description="Busque a carta na API pública do Scryfall, escolha a impressão e defina as condições do leilão. Os dados e a imagem são copiados para o nosso banco na criação."
      />
      {selected ? <LotForm item={selected} onBack={() => setSelected(null)} /> : <CatalogSearch onSelect={setSelected} />}
    </div>
  );
}

function CatalogSearch({ onSelect }: { onSelect: (item: CatalogItemDTO) => void }) {
  const [text, setText] = useState('');
  const [search, setSearch] = useState({ q: '', page: 1 });
  // O Scryfall devolve até 175 impressões por página; mostramos aos poucos.
  const [visible, setVisible] = useState(RESULTS_STEP);
  const goTo = (next: { q: string; page: number }) => {
    setSearch(next);
    setVisible(RESULTS_STEP);
  };
  const query = useQuery({
    queryKey: ['catalog', search.q, search.page],
    queryFn: ({ signal }) => api<CatalogSearchDTO>(`/catalog/search?${new URLSearchParams({ q: search.q, page: String(search.page) })}`, { signal }),
    enabled: search.q.length >= 2,
    staleTime: 5 * MINUTE,
    retry: false,
  });

  const run = (q: string) => {
    setText(q);
    goTo({ q: q.trim(), page: 1 });
  };

  return (
    <div className="space-y-6">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          run(text);
        }}
      >
        <label className="relative flex-1">
          <span className="sr-only">Buscar carta</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Nome da carta (em inglês), ex.: Black Lotus"
            className="pl-9"
            autoFocus
          />
        </label>
        <Button type="submit" variant="strong" disabled={text.trim().length < 2}>
          Buscar
        </Button>
      </form>

      {!search.q && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-stone-500">Sugestões:</span>
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => run(suggestion)}
              className="rounded-full border border-stone-300 px-3 py-1 hover:border-stone-500 dark:border-stone-700"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {query.isFetching && <Spinner label="Consultando o Scryfall..." />}
      {query.isError && (
        <Alert tone={query.error instanceof ApiError && query.error.status === 503 ? 'warning' : 'danger'} title="Não foi possível buscar">
          {errorMessage(query.error)}
        </Alert>
      )}

      {query.data && !query.isFetching && (
        <>
          {query.data.notice && (
            <Alert tone="warning" title="Resultados do cache">
              {query.data.notice}
            </Alert>
          )}
          {query.data.items.length === 0 ? (
            <EmptyState title="Nenhuma carta encontrada">Tente o nome em inglês, como aparece no Scryfall.</EmptyState>
          ) : (
            <>
              <p className="text-sm text-stone-500">{query.data.total} impressões encontradas, ordenadas pelo valor de mercado. Escolha uma:</p>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {query.data.items.slice(0, visible).map((item) => (
                  <button
                    key={item.externalId}
                    onClick={() => onSelect(item)}
                    className="group overflow-hidden rounded-xl border border-stone-200 bg-white text-left transition hover:-translate-y-0.5 hover:border-amber-500 hover:shadow-lg dark:border-stone-800 dark:bg-stone-900"
                  >
                    <ItemImage src={item.imageUrl} alt={item.title} className="aspect-[488/680]" />
                    <div className="space-y-1 p-3">
                      <p className="truncate text-sm font-semibold">{item.title}</p>
                      <p className="truncate text-xs text-stone-500">{item.subtitle}</p>
                      <div className="flex items-center justify-between">
                        {item.category && <Badge tone="warning">{item.category}</Badge>}
                        {item.referencePriceUsdCents !== null && (
                          <span className="text-xs text-stone-500 tabular-nums">US$ {(item.referencePriceUsdCents / 100).toLocaleString('pt-BR')}</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {visible < query.data.items.length ? (
                  <Button variant="secondary" onClick={() => setVisible((v) => v + RESULTS_STEP)}>
                    Mostrar mais ({query.data.items.length - visible} restantes)
                  </Button>
                ) : (
                  <>
                    <Button variant="secondary" disabled={search.page <= 1} onClick={() => goTo({ ...search, page: search.page - 1 })}>
                      Página anterior
                    </Button>
                    <Button variant="secondary" disabled={!query.data.hasMore} onClick={() => goTo({ ...search, page: search.page + 1 })}>
                      Próxima página
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function LotForm({ item, onBack }: { item: CatalogItemDTO; onBack: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState('');
  const [startingPrice, setStartingPrice] = useState<number | null>(100_00);
  const [increment, setIncrement] = useState<number | null>(10_00);
  const [startMode, setStartMode] = useState<'now' | 'scheduled'>('now');
  const [startLocal, setStartLocal] = useState(() => toLocalInput(new Date(serverNow() + 60 * MINUTE)));
  const [durationMs, setDurationMs] = useState<number | 'custom'>(DURATIONS[3]!.ms);
  const [endLocal, setEndLocal] = useState(() => toLocalInput(new Date(serverNow() + 2 * 24 * 60 * MINUTE)));

  const startsAt = startMode === 'now' ? new Date(serverNow()) : new Date(startLocal);
  const endsAt = durationMs === 'custom' ? new Date(endLocal) : new Date(startsAt.getTime() + durationMs);
  const scheduleError =
    Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())
      ? 'Datas inválidas.'
      : endsAt.getTime() - startsAt.getTime() < MINUTE
        ? 'O lote precisa durar pelo menos 1 minuto.'
        : startMode === 'scheduled' && startsAt.getTime() < serverNow()
          ? 'O início agendado já passou.'
          : null;

  const mutation = useMutation({
    mutationFn: (input: CreateLotInput) => api<LotSummaryDTO>('/lots', { method: 'POST', body: input }),
    onSuccess: (lot) => {
      toast.success(`Lote #${lot.number} publicado!`, {
        description: lot.status === 'LIVE' ? 'Já está recebendo lances.' : `Começa em ${formatDateTime(lot.startsAt)}.`,
      });
      navigate(`/lotes/${lot.id}`);
    },
    onError: (error) => toast.error('Não foi possível criar o lote', { description: errorMessage(error) }),
  });

  const submit = () => {
    if (!startingPrice || !increment || scheduleError) return;
    mutation.mutate({
      externalId: item.externalId,
      title: title.trim() || undefined,
      description: description.trim() || undefined,
      startingPriceCents: startingPrice,
      minIncrementCents: increment,
      // "Agora" usa o relógio do servidor no momento do envio.
      startsAt: (startMode === 'now' ? new Date(serverNow()) : startsAt).toISOString(),
      endsAt: (startMode === 'now' && durationMs !== 'custom' ? new Date(serverNow() + durationMs) : endsAt).toISOString(),
    });
  };

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <ItemImage src={item.imageUrl} alt={item.title} className="mx-auto aspect-[488/680] w-full max-w-60 rounded-[16px] shadow-xl lg:max-w-none" />
        <Card className="space-y-2 p-4 text-sm">
          {item.attributes.slice(0, 7).map((attribute) => (
            <div key={attribute.label} className="flex justify-between gap-3">
              <span className="text-stone-500">{attribute.label}</span>
              <span className="truncate text-right font-medium">{attribute.value}</span>
            </div>
          ))}
        </Card>
        <Button variant="secondary" className="w-full" onClick={onBack}>
          Escolher outra carta
        </Button>
      </div>

      <Card className="p-6">
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> {item.title} — {item.subtitle}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Título do lote" htmlFor="title">
              <Input id="title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={140} />
            </Field>
            <Field
              label="Lance inicial"
              htmlFor="start"
              hint={item.referencePriceUsdCents ? `Referência de mercado: US$ ${(item.referencePriceUsdCents / 100).toLocaleString('pt-BR')}` : undefined}
            >
              <CurrencyInput id="start" value={startingPrice} onChange={setStartingPrice} />
            </Field>
          </div>

          <Field label="Descrição / estado de conservação (opcional)" htmlFor="description">
            <textarea
              id="description"
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Ex.: Near Mint, sem marcas de uso, guardada em sleeve desde a abertura."
              className={clsx(inputClass, 'h-auto py-2')}
            />
          </Field>

          <Field label="Incremento mínimo" htmlFor="increment" hint="Cada lance precisa superar o atual em pelo menos este valor.">
            <CurrencyInput id="increment" value={increment} onChange={setIncrement} className="sm:max-w-[calc(50%-0.5rem)]" />
          </Field>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-stone-700 dark:text-stone-300">Início</legend>
            <div className="flex flex-wrap gap-2">
              {(['now', 'scheduled'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setStartMode(mode)}
                  className={clsx(
                    'rounded-full border px-4 py-1.5 text-sm font-medium',
                    startMode === mode
                      ? 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                      : 'border-stone-300 dark:border-stone-700',
                  )}
                >
                  {mode === 'now' ? 'Começar agora' : 'Agendar'}
                </button>
              ))}
            </div>
            {startMode === 'scheduled' && (
              <input
                type="datetime-local"
                value={startLocal}
                onChange={(event) => setStartLocal(event.target.value)}
                className={clsx(inputClass, 'sm:max-w-xs')}
              />
            )}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-stone-700 dark:text-stone-300">Duração</legend>
            <div className="flex flex-wrap gap-2">
              {[...DURATIONS, { label: 'Personalizado', ms: 'custom' as const }].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setDurationMs(option.ms)}
                  className={clsx(
                    'rounded-full border px-4 py-1.5 text-sm font-medium',
                    durationMs === option.ms
                      ? 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                      : 'border-stone-300 dark:border-stone-700',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {durationMs === 'custom' && (
              <label className="block space-y-1 text-xs text-stone-500">
                Termina em
                <input
                  type="datetime-local"
                  value={endLocal}
                  onChange={(event) => setEndLocal(event.target.value)}
                  className={clsx(inputClass, 'sm:max-w-xs')}
                />
              </label>
            )}
          </fieldset>

          <div className="rounded-xl bg-stone-100 p-4 text-sm wrap-anywhere dark:bg-stone-800/60">
            <p>
              <strong>Resumo:</strong> lance inicial {startingPrice ? formatBRL(startingPrice) : '—'}, incremento {increment ? formatBRL(increment) : '—'}.
            </p>
            {!scheduleError && (
              <p className="text-stone-600 dark:text-stone-400">
                {startMode === 'now' ? 'Começa assim que publicar' : `Começa em ${formatDateTime(startsAt.toISOString())}`} e termina em{' '}
                {formatDateTime(endsAt.toISOString())} (lances nos 2 minutos finais prorrogam o fim).
              </p>
            )}
          </div>

          {scheduleError && <Alert tone="danger">{scheduleError}</Alert>}

          <Button type="submit" size="lg" className="w-full sm:w-auto" loading={mutation.isPending} disabled={!startingPrice || !increment || !!scheduleError}>
            Publicar lote
          </Button>
        </form>
      </Card>
    </div>
  );
}
