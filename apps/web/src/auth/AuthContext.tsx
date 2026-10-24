import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { Role, UserDTO, WalletBalanceDTO } from '@leilao/shared';
import { api } from '../lib/api';
import { reconnectSocket } from '../lib/socket';

export interface Session {
  user: UserDTO;
  wallet: WalletBalanceDTO | null;
}

interface AuthContextValue {
  session: Session | null;
  user: UserDTO | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<UserDTO>;
  register: (input: { name: string; email: string; password: string; role: Role }) => Promise<UserDTO>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
export const SESSION_KEY = ['session'] as const;

const fetchSession = () => api<Session | null>('/auth/me');

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, staleTime: 60_000, retry: false });

  // Ao trocar de usuário, nada do cache do usuário anterior pode sobrar.
  const startSession = useCallback(async () => {
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
    // staleTime 0: sem isso o fetchQuery devolve a sessão anônima do cache (se buscada há < 15 s)
    // e o cabeçalho continua mostrando "Entrar" mesmo com o login feito.
    await queryClient.fetchQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, staleTime: 0 });
    reconnectSocket();
  }, [queryClient]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { user } = await api<{ user: UserDTO }>('/auth/login', { method: 'POST', body: { email, password } });
      await startSession();
      return user;
    },
    [startSession],
  );

  const register = useCallback(
    async (input: { name: string; email: string; password: string; role: Role }) => {
      const { user } = await api<{ user: UserDTO }>('/auth/register', { method: 'POST', body: input });
      await startSession();
      return user;
    },
    [startSession],
  );

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    queryClient.setQueryData(SESSION_KEY, null);
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
    reconnectSocket();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ session: data ?? null, user: data?.user ?? null, isLoading, login, register, logout }),
    [data, isLoading, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth fora do AuthProvider');
  return context;
}
