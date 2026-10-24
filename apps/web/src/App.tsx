import type { ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { Toaster } from 'sonner';
import type { Role } from '@leilao/shared';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { buttonClass, EmptyState, Spinner } from './components/ui';
import { useGlobalRealtime } from './hooks/useGlobalRealtime';
import { usePageTitle } from './lib/page-title';
import { useTheme } from './lib/theme';
import { AuctioneerPage } from './pages/AuctioneerPage';
import { AuditPage } from './pages/AuditPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { LotPage } from './pages/LotPage';
import { MyBidsPage } from './pages/MyBidsPage';
import { NewLotPage } from './pages/NewLotPage';
import { ReceiptPage } from './pages/ReceiptPage';
import { ShowcasePage } from './pages/ShowcasePage';
import { WalletPage } from './pages/WalletPage';

function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <Spinner />;
  if (!user) return <Navigate to={`/entrar?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (user.role !== role) {
    return (
      <EmptyState title={role === 'BIDDER' ? 'Área exclusiva de licitantes' : 'Área exclusiva de leiloeiros'}>
        <p>Você está conectado como {user.role === 'BIDDER' ? 'licitante' : 'leiloeiro'}.</p>
        <Link to="/" className={buttonClass('secondary', 'sm', 'mt-4')}>
          Voltar para a vitrine
        </Link>
      </EmptyState>
    );
  }
  return children;
}

function NotFound() {
  usePageTitle('Página não encontrada');
  return (
    <EmptyState title="Página não encontrada">
      <Link to="/" className={buttonClass('secondary', 'sm', 'mt-2')}>
        Ir para a vitrine
      </Link>
    </EmptyState>
  );
}

export function App() {
  useGlobalRealtime();
  const { isDark } = useTheme();

  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ShowcasePage />} />
          <Route path="lotes/:id" element={<LotPage />} />
          <Route path="auditoria/:id" element={<AuditPage />} />
          <Route path="comprovante/:code" element={<ReceiptPage />} />
          <Route path="entrar" element={<LoginPage />} />
          <Route path="cadastro" element={<RegisterPage />} />
          <Route
            path="carteira"
            element={
              <RequireRole role="BIDDER">
                <WalletPage />
              </RequireRole>
            }
          />
          <Route
            path="meus-arremates"
            element={
              <RequireRole role="BIDDER">
                <MyBidsPage />
              </RequireRole>
            }
          />
          <Route
            path="painel"
            element={
              <RequireRole role="AUCTIONEER">
                <AuctioneerPage />
              </RequireRole>
            }
          />
          <Route
            path="painel/novo-lote"
            element={
              <RequireRole role="AUCTIONEER">
                <NewLotPage />
              </RequireRole>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <Toaster richColors closeButton position="top-right" theme={isDark ? 'dark' : 'light'} />
    </>
  );
}
