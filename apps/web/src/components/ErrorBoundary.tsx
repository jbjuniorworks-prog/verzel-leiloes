import { AlertTriangle } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, EmptyState } from './ui';

/**
 * Se uma tela quebrar durante a renderização, mostra um aviso no lugar dela
 * (com o cabeçalho funcionando) em vez de deixar a página em branco.
 * Trocar de rota (`resetKey`) limpa o erro.
 */
export class ErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <EmptyState icon={<AlertTriangle className="size-8" />} title="Algo deu errado nesta tela">
        <p>Recarregue a página para tentar de novo. Seus lances e saldo não são afetados.</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => window.location.reload()}>
          Recarregar
        </Button>
      </EmptyState>
    );
  }
}
