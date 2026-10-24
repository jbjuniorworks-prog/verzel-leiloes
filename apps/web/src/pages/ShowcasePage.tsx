import { useInfiniteQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { LotListDTO } from '@leilao/shared';
import { LotCard } from '../components/LotCard';
import { Button, EmptyState, inputClass, LoadError, Skeleton } from '../components/ui';
import { api } from '../lib/api';

type Tab = 'live' | 'scheduled' | 'ended';

const TABS: Array<{ id: Tab; label: string; empty: string }> = [
  { id: 'live', label: 'Ao vivo', empty: 'Nenhum lote recebendo lances agora.' },
  { id: 'scheduled', label: 'Agendados', empty: 'Nenhum lote agendado.' },
  { id: 'ended', label: 'Encerrados', empty: 'Nenhum lote encerrado ainda.' },
];

const RARITIES = ['Comum', 'Incomum', 'Rara', 'Mítica', 'Especial', 'Bônus'];

const SORTS = [
  { id: '', label: 'Relevância (fim/início mais próximo)' },
  { id: 'price_desc', label: 'Maior valor' },
  { id: 'price_asc', label: 'Menor valor' },
  { id: 'bids', label: 'Mais disputados' },
  { id: 'newest', label: 'Mais recentes' },
];

/** "12,50" ou "-3" digitados no filtro viram centavos válidos (ou nada), nunca um erro da API. */
function reaisToCents(reais: string) {
  const value = Number(reais.replace(',', '.'));
  return reais.trim() && Number.isFinite(value) && value >= 0 ? String(Math.round(value * 100)) : null;
}

export function ShowcasePage() {
  const [params, setParams] = useSearchParams();
  const status = (['live', 'scheduled', 'ended'].includes(params.get('status') ?? '') ? params.get('status') : 'live') as Tab;
  const q = params.get('q') ?? '';
  const category = params.get('raridade') ?? '';
  const sort = params.get('ordem') ?? '';
  const minReais = params.get('min') ?? '';
  const maxReais = params.get('max') ?? '';
  const [search, setSearch] = useState(q);
  const [showFilters, setShowFilters] = useState(Boolean(category || minReais || maxReais || sort));

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };

  // Busca com debounce: só consulta a API 350 ms depois da última tecla.
  useEffect(() => {
    if (search === q) return;
    const timer = setTimeout(() => update({ q: search.trim() }), 350);
    return () => clearTimeout(timer);
  }, [search]);

  // A URL mudou por fora (clique no logo, link "Vitrine"): o campo acompanha.
  useEffect(() => {
    if (q !== search.trim()) setSearch(q);
  }, [q]);

  const filters = { status, q, category, sort, minReais, maxReais };
  const query = useInfiniteQuery({
    queryKey: ['lots', filters],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => {
      const search = new URLSearchParams({ status, page: String(pageParam) });
      if (q) search.set('q', q);
      if (category) search.set('category', category);
      if (sort) search.set('sort', sort);
      const minCents = reaisToCents(minReais);
      const maxCents = reaisToCents(maxReais);
      if (minCents) search.set('minPrice', minCents);
      if (maxCents) search.set('maxPrice', maxCents);
      return api<LotListDTO>(`/lots?${search}`, { signal });
    },
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });

  const counts = query.data?.pages[0]?.counts;
  const lots = query.data?.pages.flatMap((page) => page.lots) ?? [];
  const hasFilters = Boolean(q || category || minReais || maxReais || sort);

  return (
    <div>
      <section className="mb-10 grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div className="space-y-3">
          <p className="text-xs font-semibold tracking-[0.2em] text-amber-600 uppercase dark:text-amber-400">Casa de leilões online</p>
          <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
            Cartas raras, <span className="text-amber-600 italic dark:text-amber-400">lances ao vivo.</span>
          </h1>
          <p className="max-w-xl text-stone-600 dark:text-stone-400">
            Do Black Lotus ao Jace: dispute peças históricas de Magic: The Gathering em tempo real. Cada lance é encadeado e assinado — qualquer pessoa pode
            auditar o histórico de um lote.
          </p>
        </div>
      </section>

      <div className="sticky top-16 z-30 -mx-4 mb-6 border-b border-stone-200 bg-stone-50/90 px-4 pt-2 pb-3 backdrop-blur sm:-mx-6 sm:px-6 dark:border-stone-800 dark:bg-stone-950/90">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div role="tablist" aria-label="Situação dos lotes" className="grid grid-cols-3 gap-1 sm:flex">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={status === tab.id}
                onClick={() => update({ status: tab.id === 'live' ? '' : tab.id })}
                className={clsx(
                  'flex items-center justify-center gap-1.5 rounded-full px-1 py-2 text-xs font-semibold transition-colors sm:gap-2 sm:px-4 sm:text-sm',
                  status === tab.id
                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                    : 'text-stone-600 hover:bg-stone-200/70 dark:text-stone-400 dark:hover:bg-stone-800',
                )}
              >
                {tab.id === 'live' && <span className="size-2 rounded-full bg-rose-500 motion-safe:animate-pulse" aria-hidden />}
                {tab.label}
                {counts && <span className="rounded-full bg-stone-500/15 px-1.5 text-xs tabular-nums">{counts[tab.id]}</span>}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <label className="relative flex-1 lg:w-72">
              <span className="sr-only">Buscar lotes</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar carta, coleção, artista…"
                className={clsx(inputClass, 'pl-9')}
              />
            </label>
            <Button variant={showFilters ? 'strong' : 'secondary'} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
              <SlidersHorizontal className="size-4" /> <span className="hidden sm:inline">Filtros</span>
            </Button>
          </div>
        </div>

        {showFilters && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.4fr_auto] lg:items-end">
            <label className="space-y-1 text-xs font-medium text-stone-600 dark:text-stone-400">
              Raridade
              <select value={category} onChange={(event) => update({ raridade: event.target.value })} className={inputClass}>
                <option value="">Todas</option>
                {RARITIES.map((rarity) => (
                  <option key={rarity}>{rarity}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-stone-600 dark:text-stone-400">
              Preço mínimo (R$)
              <input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={minReais}
                onChange={(event) => update({ min: event.target.value })}
                className={inputClass}
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-stone-600 dark:text-stone-400">
              Preço máximo (R$)
              <input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={maxReais}
                onChange={(event) => update({ max: event.target.value })}
                className={inputClass}
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-stone-600 dark:text-stone-400">
              Ordenar por
              <select value={sort} onChange={(event) => update({ ordem: event.target.value })} className={inputClass}>
                {SORTS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="ghost"
              disabled={!hasFilters}
              onClick={() => {
                setSearch('');
                update({ q: '', raridade: '', min: '', max: '', ordem: '' });
              }}
            >
              <X className="size-4" /> Limpar
            </Button>
          </div>
        )}
      </div>

      {query.isPending ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="aspect-[3/5]" />
          ))}
        </div>
      ) : !query.data ? (
        <LoadError title="Não foi possível carregar os lotes" error={query.error} onRetry={() => void query.refetch()} />
      ) : lots.length === 0 ? (
        <EmptyState title={hasFilters ? 'Nenhum lote encontrado com esses filtros' : TABS.find((tab) => tab.id === status)!.empty}>
          {hasFilters ? 'Tente outros termos ou limpe os filtros.' : 'Volte daqui a pouco — novos lotes entram o tempo todo.'}
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {lots.map((lot) => (
              <LotCard key={lot.id} lot={lot} />
            ))}
          </div>
          {query.hasNextPage && (
            <div className="mt-8 flex justify-center">
              <Button variant="secondary" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                Carregar mais lotes
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
