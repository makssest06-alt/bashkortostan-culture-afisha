/**
 * Переключатель ИИ для режима моков (когда бэк не подключён).
 * При подключённом бэке состояние хранится в его БД (app_settings.ai_enabled),
 * а этот модуль не используется.
 */
let aiEnabled = true;

export function isAiEnabled(): boolean {
  return aiEnabled;
}

export function setAiEnabled(value: boolean): void {
  aiEnabled = value;
}
