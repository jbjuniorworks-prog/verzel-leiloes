import clsx from 'clsx';
import { Gavel, LogOut, Menu, Monitor, Moon, Sun, Wallet, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { formatBRL } from '../lib/format';
import { useTheme } from '../lib/theme';
import { buttonClass } from './ui';

function ThemeToggle() {
  const { preference, cycle } = useTheme();
  const Icon = preference === 'dark' ? Moon : preference === 'light' ? Sun : Monitor;
  const label = { dark: 'Tema escuro', light: 'Tema claro', system: 'Tema do sistema' }[preference];
  return (
    <button onClick={cycle} className={buttonClass('ghost', 'icon')} aria-label={`${label} (clique para trocar)`} title={label}>
      <Icon className="size-4" />
    </button>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
      : 'text-stone-600 hover:bg-stone-200/70 dark:text-stone-300 dark:hover:bg-stone-800',
  );

export function Layout() {
  const { user, session, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const links =
    user?.role === 'AUCTIONEER'
      ? [
          { to: '/', label: 'Vitrine', end: true },
          { to: '/painel', label: 'Painel do leiloeiro' },
          { to: '/painel/novo-lote', label: 'Novo lote' },
        ]
      : user?.role === 'BIDDER'
        ? [
            { to: '/', label: 'Vitrine', end: true },
            { to: '/meus-arremates', label: 'Meus arremates' },
            { to: '/carteira', label: 'Carteira' },
          ]
        : [{ to: '/', label: 'Vitrine', end: true }];

  const handleLogout = async () => {
    await logout();
    setOpen(false);
    navigate('/');
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-stone-50/85 backdrop-blur dark:border-stone-800/80 dark:bg-stone-950/85">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
            <span className="grid size-8 place-items-center rounded-lg bg-stone-900 text-amber-400 dark:bg-amber-400 dark:text-stone-950">
              <Gavel className="size-4" />
            </span>
            <span className="font-display text-xl font-semibold tracking-tight">Martelo</span>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Principal">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={navClass}>
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {user?.role === 'BIDDER' && session?.wallet && (
              <Link
                to="/carteira"
                className="hidden items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm sm:flex dark:border-stone-800 dark:bg-stone-900"
                title="Saldo disponível para lances"
              >
                <Wallet className="size-4 text-amber-600 dark:text-amber-400" />
                <span className="font-semibold tabular-nums">{formatBRL(session.wallet.availableCents)}</span>
                <span className="text-xs text-stone-500">disponível</span>
              </Link>
            )}
            <ThemeToggle />
            {user ? (
              <div className="hidden items-center gap-2 md:flex">
                <div className="text-right leading-tight">
                  <p className="text-sm font-semibold">{user.name}</p>
                  <p className="text-xs text-stone-500">{user.role === 'AUCTIONEER' ? 'Leiloeiro' : 'Licitante'}</p>
                </div>
                <button onClick={handleLogout} className={buttonClass('ghost', 'icon')} aria-label="Sair" title="Sair">
                  <LogOut className="size-4" />
                </button>
              </div>
            ) : (
              <div className="hidden gap-2 md:flex">
                <Link to="/entrar" className={buttonClass('ghost', 'sm')}>
                  Entrar
                </Link>
                <Link to="/cadastro" className={buttonClass('strong', 'sm')}>
                  Criar conta
                </Link>
              </div>
            )}
            <button className={buttonClass('ghost', 'icon', 'md:hidden')} onClick={() => setOpen((v) => !v)} aria-label="Menu" aria-expanded={open}>
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        {open && (
          <nav className="border-t border-stone-200 px-4 py-3 md:hidden dark:border-stone-800" aria-label="Menu móvel">
            <div className="flex flex-col gap-1">
              {links.map((link) => (
                <NavLink key={link.to} to={link.to} end={link.end} className={navClass} onClick={() => setOpen(false)}>
                  {link.label}
                </NavLink>
              ))}
              {user?.role === 'BIDDER' && session?.wallet && (
                <p className="px-3 py-2 text-sm text-stone-500">
                  Disponível: <strong className="text-stone-900 dark:text-stone-100">{formatBRL(session.wallet.availableCents)}</strong>
                </p>
              )}
              {user ? (
                <button onClick={handleLogout} className={clsx(navClass({ isActive: false }), 'text-left')}>
                  Sair ({user.name})
                </button>
              ) : (
                <>
                  <NavLink to="/entrar" className={navClass} onClick={() => setOpen(false)}>
                    Entrar
                  </NavLink>
                  <NavLink to="/cadastro" className={navClass} onClick={() => setOpen(false)}>
                    Criar conta
                  </NavLink>
                </>
              )}
            </div>
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>

      <footer className="border-t border-stone-200 py-6 text-center text-xs text-stone-500 dark:border-stone-800">
        <p>
          Martelo · Casa de leilões de demonstração — dinheiro simulado. Itens e imagens via{' '}
          <a className="underline hover:text-stone-700 dark:hover:text-stone-300" href="https://scryfall.com" target="_blank" rel="noreferrer">
            Scryfall
          </a>
          ; Magic: The Gathering é marca da Wizards of the Coast.
        </p>
      </footer>
    </div>
  );
}
