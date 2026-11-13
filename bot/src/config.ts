export type BotMode = 'auto' | 'polling' | 'webhook' | 'standby';

export interface BotConfig {
  botToken: string;
  apiBaseUrl: string;
  publicWebUrl: string;
  mode: BotMode;
  resolvedMode: 'polling' | 'webhook' | 'standby';
  webhookUrl: string;
  webhookSecret: string;
  port: number;
  pollTimeoutSec: number;
  requestTimeoutMs: number;
  assistantTimeoutMs: number;
}

export function loadBotConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const botToken = (env.BOT_TOKEN ?? '').trim();
  const rawMode = (env.BOT_MODE ?? 'auto').trim().toLowerCase();
  const mode: BotMode =
    rawMode === 'polling' || rawMode === 'webhook' || rawMode === 'standby' ? rawMode : 'auto';
  const webhookUrl = (env.WEBHOOK_URL ?? '').trim();

  let resolvedMode: 'polling' | 'webhook' | 'standby' = 'standby';
  if (botToken && mode !== 'standby') {
    if (mode === 'webhook' || (mode === 'auto' && webhookUrl)) {
      resolvedMode = 'webhook';
    } else {
      resolvedMode = 'polling';
    }
  }

  return {
    botToken,
    apiBaseUrl: (env.API_BASE_URL ?? 'http://localhost:8000').replace(/\/+$/, ''),
    publicWebUrl: (env.PUBLIC_WEB_URL ?? 'http://localhost:3210').replace(/\/+$/, ''),
    mode,
    resolvedMode,
    webhookUrl,
    webhookSecret: (env.WEBHOOK_SECRET ?? '').trim(),
    port: Math.max(1, Number.parseInt(env.BOT_PORT ?? '8081', 10) || 8081),
    pollTimeoutSec: Math.max(5, Number.parseInt(env.POLL_TIMEOUT_SEC ?? '25', 10) || 25),
    requestTimeoutMs: Math.max(1000, Number.parseInt(env.API_TIMEOUT_MS ?? '6000', 10) || 6000),
    assistantTimeoutMs: Math.max(2000, Number.parseInt(env.ASSISTANT_TIMEOUT_MS ?? '12000', 10) || 12000),
  };
}
