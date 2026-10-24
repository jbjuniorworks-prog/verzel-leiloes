import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { AuthProvider, SESSION_KEY } from './auth/AuthContext';
import { ApiError } from './lib/api';
import { syncServerClock } from './lib/clock';
import { ThemeProvider } from './lib/theme';
import './index.css';

// Sessão expirou (ou saiu em outra aba): esquece o usuário e as telas protegidas mandam para o login.
const onAuthError = (error: unknown) => {
  if (error instanceof ApiError && error.status === 401) queryClient.setQueryData(SESSION_KEY, null);
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Erros 4xx são definitivos (não adianta tentar de novo).
      retry: (failureCount, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 2,
    },
  },
});

void syncServerClock();
setInterval(() => void syncServerClock(), 5 * 60_000);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
