import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDownLeft, ArrowUpRight, Lock, LockOpen, PiggyBank, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { WalletBalanceDTO, WalletDTO, WalletTransactionType } from '@leilao/shared';
import { SESSION_KEY, type Session } from '../auth/AuthContext';
import { CurrencyInput } from '../components/CurrencyInput';
import { Alert, Button, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatBRL, formatDateTime } from '../lib/format';

const TX_META: Record<WalletTransactionType, { label: string; icon: typeof Wallet; tone: string }> = {
  DEPOSIT: { label: 'Depósito', icon: PiggyBank, tone: 'text-emerald-600 dark:text-emerald-400' },
  HOLD: { label: 'Comprometido', icon: Lock, tone: 'text-amber-600 dark:text-amber-400' },
  RELEASE: { label: 'Liberado', icon: LockOpen, tone: 'text-sky-600 dark:text-sky-400' },
  PAYMENT: { label: 'Arremate', icon: ArrowUpRight, tone: 'text-rose-600 dark:text-rose-400' },
  PAYOUT: { label: 'Venda', icon: ArrowDownLeft, tone: 'text-emerald-600 dark:text-emerald-400' },
};

const QUICK_DEPOSITS = [100_00, 1_000_00, 10_000_00, 50_000_00];

export function WalletPage() {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState<number | null>(1_000_00);
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: ({ signal }) => api<WalletDTO>('/wallet', { signal }) });

  const depositMutation = useMutation({
    mutationFn: (amountCents: number) => api<WalletBalanceDTO>('/wallet/deposits', { method: 'POST', body: { amountCents } }),
    onSuccess: (balance, amountCents) => {
      queryClient.setQueryData<Session | null>(SESSION_KEY, (session) => (session ? { ...session, wallet: balance } : session));
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      toast.success(`Depósito de ${formatBRL(amountCents)} realizado`, { description: `Disponível agora: ${formatBRL(balance.availableCents)}` });
    },
    onError: (error) => toast.error('Depósito não realizado', { description: errorMessage(error) }),
  });

  if (wallet.isPending) return <Spinner />;
  if (wallet.isError) return <Alert tone="danger">{errorMessage(wallet.error)}</Alert>;
  const data = wallet.data;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Licitante"
        title="Carteira"
        description="Saldo simulado para dar lances. Enquanto você lidera um lote, o valor do lance fica comprometido; se for superado, volta na hora para o disponível."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Saldo total', value: data.balanceCents, hint: 'Tudo o que está na carteira', className: '' },
          { label: 'Comprometido', value: data.committedCents, hint: 'Em lances que você lidera', className: 'text-amber-600 dark:text-amber-400' },
          {
            label: 'Disponível',
            value: data.availableCents,
            hint: 'Total − comprometido: pode ser usado em lances',
            className: 'text-emerald-600 dark:text-emerald-400',
          },
        ].map((stat) => (
          <Card key={stat.label} className="p-5">
            <p className="text-sm text-stone-500">{stat.label}</p>
            <p className={clsx('font-display text-3xl font-semibold tabular-nums', stat.className)}>{formatBRL(stat.value)}</p>
            <p className="mt-1 text-xs text-stone-500">{stat.hint}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <h2 className="font-display text-xl font-semibold">Depósito simulado</h2>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (amount) depositMutation.mutate(amount);
              }}
            >
              <CurrencyInput large value={amount} onChange={setAmount} ariaLabel="Valor do depósito" />
              <div className="flex flex-wrap gap-2">
                {QUICK_DEPOSITS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAmount(value)}
                    className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium hover:border-stone-400 dark:border-stone-700"
                  >
                    {formatBRL(value)}
                  </button>
                ))}
              </div>
              <Button type="submit" className="w-full" loading={depositMutation.isPending} disabled={!amount || amount < 100}>
                Depositar {amount ? formatBRL(amount) : ''}
              </Button>
              <p className="text-xs text-stone-500">Dinheiro fictício — nenhuma cobrança real é feita.</p>
            </form>
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="font-display text-xl font-semibold">Valores comprometidos</h2>
            {data.holds.length === 0 ? (
              <p className="text-sm text-stone-500">Você não lidera nenhum lote agora.</p>
            ) : (
              <ul className="space-y-2">
                {data.holds.map((hold) => (
                  <li key={hold.lotId} className="flex items-center justify-between gap-3 text-sm">
                    <Link to={`/lotes/${hold.lotId}`} className="min-w-0 truncate hover:underline">
                      #{hold.lotNumber} · {hold.title}
                    </Link>
                    <span className="font-semibold tabular-nums">{formatBRL(hold.amountCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="p-5">
          <h2 className="mb-4 font-display text-xl font-semibold">Extrato</h2>
          {data.transactions.length === 0 ? (
            <EmptyState title="Nenhuma movimentação ainda">Faça um depósito para começar a dar lances.</EmptyState>
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-stone-800">
              {data.transactions.map((tx) => {
                const meta = TX_META[tx.type];
                const Icon = meta.icon;
                return (
                  <li key={tx.id} className="flex items-center gap-3 py-3">
                    <span className={clsx('grid size-9 shrink-0 place-items-center rounded-full bg-stone-100 dark:bg-stone-800', meta.tone)}>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{tx.description}</p>
                      <p className="text-xs text-stone-500">
                        {meta.label} · {formatDateTime(tx.createdAt)}
                        {tx.lotId && (
                          <>
                            {' · '}
                            <Link to={`/lotes/${tx.lotId}`} className="hover:underline">
                              lote #{tx.lotNumber}
                            </Link>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={clsx('font-semibold tabular-nums', meta.tone)}>{formatBRL(tx.amountCents)}</p>
                      <p className="text-xs text-stone-500 tabular-nums">disp. {formatBRL(tx.balanceAfterCents - tx.committedAfterCents)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
