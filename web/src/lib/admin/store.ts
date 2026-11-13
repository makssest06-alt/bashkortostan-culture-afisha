/**
 * Хранилище админки: правки демо-событий, импортированные записи, журнал, отчёты импорта, заявки.
 *
 * Пока бэкенда нет, состояние живёт в памяти процесса и в JSON-файле (по умолчанию
 * .next/cache/afisha/admin-state.json, путь меняется переменной AFISHA_DATA_FILE).
 * Файл переживает перезапуск сервера. Если писать некуда, работа продолжается в памяти.
 * Состояние перечитывается, когда файл изменился: так разные части приложения видят одно и то же.
 */

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { logEvent } from '../api/http';
import type { AdminState } from './types';

const MAX_AUDIT = 2000;
const MAX_IMPORTS = 50;
const MAX_APPLICATIONS = 500;

function dataFile(): string {
  return process.env.AFISHA_DATA_FILE ?? path.join(process.cwd(), '.next', 'cache', 'afisha', 'admin-state.json');
}

export function emptyState(): AdminState {
  return { version: 1, patches: {}, records: {}, audit: [], imports: [], applications: [] };
}

type Holder = { state: AdminState; mtimeMs: number; file: string };

const scope = globalThis as typeof globalThis & { __afishaAdminStore?: Holder };

function fileMtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function load(file: string): Holder {
  const mtimeMs = fileMtime(file);
  if (!mtimeMs) return { state: emptyState(), mtimeMs: 0, file };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<AdminState>;
    if (parsed.version !== 1) throw new Error(`неизвестная версия ${String(parsed.version)}`);
    return { state: { ...emptyState(), ...parsed } as AdminState, mtimeMs, file };
  } catch (error) {
    logEvent('warn', 'admin_state_unreadable', { file, error: error instanceof Error ? error.message : String(error) });
    return { state: emptyState(), mtimeMs, file };
  }
}

/** Текущее состояние. Возвращает общий объект: менять его можно только через mutate. */
export function readState(): AdminState {
  const file = dataFile();
  const holder = scope.__afishaAdminStore;
  if (!holder || holder.file !== file || (fileMtime(file) && fileMtime(file) !== holder.mtimeMs)) {
    scope.__afishaAdminStore = load(file);
  }
  return scope.__afishaAdminStore!.state;
}

function persist(state: AdminState): number {
  const file = dataFile();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(state), 'utf8');
    renameSync(temp, file);
    return fileMtime(file);
  } catch (error) {
    logEvent('warn', 'admin_state_not_saved', { file, error: error instanceof Error ? error.message : String(error) });
    return scope.__afishaAdminStore?.mtimeMs ?? 0;
  }
}

/** Изменение состояния: работа идёт над копией, и только удачный результат сохраняется. */
export function mutate<T>(change: (draft: AdminState) => T): T {
  const draft = structuredClone(readState());
  const result = change(draft);
  draft.audit = draft.audit.slice(-MAX_AUDIT);
  draft.imports = draft.imports.slice(-MAX_IMPORTS);
  draft.applications = draft.applications.slice(-MAX_APPLICATIONS);
  const mtimeMs = persist(draft);
  scope.__afishaAdminStore = { state: draft, mtimeMs, file: dataFile() };
  return result;
}

/** Только для тестов: начать с чистого состояния без файла. */
export function resetForTests(state: AdminState = emptyState()): void {
  const mtimeMs = persist(state);
  scope.__afishaAdminStore = { state, mtimeMs, file: dataFile() };
}
