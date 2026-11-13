'use client';

import { useCallback, useEffect, useState } from 'react';

import { adminFetch } from './api';

export interface SessionInfo {
  mode: 'token' | 'open' | 'disabled';
  authenticated: boolean;
  actor: string | null;
}

/** Состояние входа в админку: режим сервера, вошёл ли модератор, его имя. */
export function useSession() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data } = await adminFetch<SessionInfo>('/session');
      setSession(data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    adminFetch<SessionInfo>('/session')
      .then(({ data }) => alive && setSession(data))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const logout = useCallback(async () => {
    await adminFetch('/session', { method: 'DELETE' }).catch(() => undefined);
    await refresh();
  }, [refresh]);

  return { session, setSession, failed, refresh, logout };
}
