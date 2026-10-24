import clsx from 'clsx';
import { Gavel, UserRound } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { Role } from '@leilao/shared';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Card, Field, Input } from '../components/ui';
import { errorMessage } from '../lib/api';
import { usePageTitle } from '../lib/page-title';

const DEMO_ACCOUNTS = [
  { email: 'leiloeiro@demo.com', label: 'Leiloeiro', name: 'Casa Martelo' },
  { email: 'ana@demo.com', label: 'Licitante', name: 'Ana Souza' },
  { email: 'bruno@demo.com', label: 'Licitante', name: 'Bruno Lima' },
];

/** Só aceita caminhos internos no ?next= (evita redirecionamento para outro site). */
const safeNext = (value: string | null) => (value && value.startsWith('/') && !value.startsWith('//') ? value : null);

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-6">
      <div className="mb-6 text-center">
        <span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-stone-900 text-amber-400 dark:bg-amber-400 dark:text-stone-950">
          <Gavel className="size-6" />
        </span>
        <h1 className="font-display text-3xl font-semibold">{title}</h1>
        <p className="text-stone-500">{subtitle}</p>
      </div>
      <Card className="p-6">{children}</Card>
    </div>
  );
}

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  usePageTitle('Entrar');

  if (user) return <Navigate to={next ?? (user.role === 'AUCTIONEER' ? '/painel' : '/')} replace />;

  const signIn = async (emailToUse: string, passwordToUse: string) => {
    setLoading(true);
    setError(null);
    try {
      const signed = await login(emailToUse, passwordToUse);
      toast.success(`Bem-vindo(a), ${signed.name}!`);
      navigate(next ?? (signed.role === 'AUCTIONEER' ? '/painel' : '/'), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void signIn(email, password);
  };

  return (
    <AuthShell title="Entrar" subtitle="Acesse sua conta para dar lances ou gerenciar lotes.">
      <form className="space-y-4" onSubmit={onSubmit}>
        <Field label="E-mail" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Senha" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" className="w-full" loading={loading}>
          Entrar
        </Button>
      </form>

      <div className="mt-6 space-y-2 border-t border-stone-200 pt-5 dark:border-stone-800">
        <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Contas de demonstração (senha demo1234)</p>
        {DEMO_ACCOUNTS.map((account) => (
          <button
            key={account.email}
            disabled={loading}
            onClick={() => void signIn(account.email, 'demo1234')}
            className="flex w-full items-center gap-3 rounded-lg border border-stone-200 px-3 py-2 text-left text-sm hover:border-amber-500 hover:bg-amber-50 disabled:opacity-50 dark:border-stone-800 dark:hover:bg-amber-950/40"
          >
            <UserRound className="size-4 text-stone-400" />
            <span className="flex-1">
              <span className="font-semibold">{account.name}</span> <span className="text-stone-500">· {account.email}</span>
            </span>
            <span className="text-xs text-stone-500">{account.label}</span>
          </button>
        ))}
      </div>

      <p className="mt-6 text-center text-sm text-stone-500">
        Não tem conta?{' '}
        <Link to="/cadastro" className="font-semibold text-amber-700 hover:underline dark:text-amber-400">
          Criar conta
        </Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register, user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'BIDDER' as Role });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  usePageTitle('Criar conta');

  // Quem já está logado sai daqui. Durante o cadastro (loading) não: quem decide o destino
  // (carteira ou novo lote) é o onSubmit, senão este redirecionamento chegaria primeiro.
  if (user && !loading) return <Navigate to="/" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const created = await register(form);
      toast.success('Conta criada!', {
        description: created.role === 'BIDDER' ? 'Faça um depósito simulado para começar a dar lances.' : 'Crie seu primeiro lote.',
      });
      // Sem setLoading(false) aqui: o React Router aplica a navegação como transição (baixa prioridade)
      // e o loading=false renderizaria antes, disparando o <Navigate to="/"> acima por cima dela.
      navigate(created.role === 'BIDDER' ? '/carteira' : '/painel/novo-lote', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Criar conta" subtitle="Escolha como você vai participar.">
      <form className="space-y-4" onSubmit={onSubmit}>
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="mb-1.5 text-sm font-medium text-stone-700 dark:text-stone-300">Eu quero…</legend>
          {(
            [
              ['BIDDER', 'Dar lances', 'Licitante: deposita saldo, dá lances e arremata.'],
              ['AUCTIONEER', 'Leiloar itens', 'Leiloeiro: cria e gerencia lotes. Não dá lances.'],
            ] as const
          ).map(([role, label, description]) => (
            <button
              key={role}
              type="button"
              onClick={() => setForm((f) => ({ ...f, role }))}
              aria-pressed={form.role === role}
              className={clsx(
                'rounded-xl border p-3 text-left transition-colors',
                form.role === role ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40' : 'border-stone-200 hover:border-stone-400 dark:border-stone-800',
              )}
            >
              <span className="block font-semibold">{label}</span>
              <span className="text-xs text-stone-500">{description}</span>
            </button>
          ))}
        </fieldset>
        <Field label="Nome" htmlFor="name" hint="Não aparece para outros usuários: em lances e comprovantes você é identificado por pseudônimo.">
          <Input
            id="name"
            required
            minLength={2}
            maxLength={80}
            autoComplete="name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </Field>
        <Field label="E-mail" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </Field>
        <Field label="Senha" htmlFor="password" hint="Mínimo de 8 caracteres.">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" className="w-full" loading={loading}>
          Criar conta
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-stone-500">
        Já tem conta?{' '}
        <Link to="/entrar" className="font-semibold text-amber-700 hover:underline dark:text-amber-400">
          Entrar
        </Link>
      </p>
    </AuthShell>
  );
}
