import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api, ApiRequestError, setCsrfToken } from './api';
import type { Capability } from '../../shared/permissions';
import type { SessionPayload } from '../../shared/types';

interface SessionContextValue {
  session: SessionPayload | null;
  isLoading: boolean;
  can: (capability: Capability) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        const payload = await api.get<SessionPayload>('/auth/session');
        setCsrfToken(payload.csrfToken);
        return payload;
      } catch (error) {
        if (error instanceof ApiRequestError && error.isAuthError) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  const session = data ?? null;

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['session'] });
  }, [queryClient]);

  const signOut = useCallback(async () => {
    await api.post('/auth/sign-out');
    setCsrfToken('');
    queryClient.clear();
    queryClient.setQueryData(['session'], null);
  }, [queryClient]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      isLoading,
      can: (capability: Capability) => Boolean(session?.capabilities.includes(capability)),
      refresh,
      signOut,
    }),
    [session, isLoading, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider');
  return context;
}

/** Convenience hook for the authenticated area, where a session is guaranteed. */
export function useCurrentSession(): SessionPayload {
  const { session } = useSession();
  if (!session) throw new Error('No active session');
  return session;
}
