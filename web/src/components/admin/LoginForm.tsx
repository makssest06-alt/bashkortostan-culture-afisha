'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

import { Button, Field, Input } from '@/components/ui';

import { AdminError, adminFetch, jsonBody } from './api';
import { Notice } from './bits';
import type { SessionInfo } from './useSession';

/** Вход модератора: имя для журнала и токен (в демо-режиме без токена). */
export function LoginForm({ mode, onDone }: { mode: SessionInfo['mode']; onDone: (session: SessionInfo) => void }) {
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminError | null>(null);

  if (mode === 'disabled') {
    return (
      <Notice tone="info">
        Админка выключена: на сервере не задан ADMIN_TOKEN. Задайте переменную окружения ADMIN_TOKEN (в production — от 32 знаков) и
        перезапустите сайт.
      </Notice>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await adminFetch<SessionInfo>('/session', { method: 'POST', ...jsonBody({ name, token }) });
      onDone(data);
    } catch (caught) {
      setError(caught instanceof AdminError ? caught : new AdminError(0, 'unknown', 'Не удалось войти'));
    } finally {
      setBusy(false);
    }
  };

  const fieldErrors = error?.fieldErrors() ?? {};
  return (
    <form onSubmit={submit} noValidate className="flex max-w-md flex-col gap-5">
      {mode === 'open' ? (
        <Notice tone="info">Демо-режим: токен не нужен. Изменения видны всем посетителям сайта.</Notice>
      ) : null}
      <Field label="Ваше имя" hint="Попадёт в журнал изменений" error={fieldErrors.name}>
        <Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={60} required />
      </Field>
      {mode === 'token' ? (
        <Field label="Токен модератора" error={fieldErrors.token}>
          <Input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="current-password" required />
        </Field>
      ) : null}
      {error && !Object.keys(fieldErrors).length ? <Notice tone="error">{error.message}</Notice> : null}
      <Button type="submit" disabled={busy}>
        {busy ? 'Входим…' : 'Войти'}
      </Button>
    </form>
  );
}
