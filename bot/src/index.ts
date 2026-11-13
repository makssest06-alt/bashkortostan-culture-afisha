import { createApiClient } from './api/client.js';
import { createBot } from './bot.js';
import { ConfigError, loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { SessionStore } from './session.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      console.error('Заполните переменные окружения по образцу bot/.env.example.');
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger(config.logLevel);
  const api = createApiClient({
    baseUrl: config.apiBaseUrl,
    timeoutMs: config.apiTimeoutMs,
  });
  const sessions = new SessionStore({ ttlMs: config.sessionTtlMs });
  const bot = createBot(config.telegramBotToken, { api, sessions, config, logger });

  try {
    const health = await api.health();
    if (health.status === 'ok') {
      logger.info('api_health', { status: health.status, base_url: config.apiBaseUrl });
    } else {
      logger.warn('api_health_degraded', { status: health.status, base_url: config.apiBaseUrl });
    }
  } catch (error) {
    logger.warn('api_health_failed', {
      error: error instanceof Error ? error.message : String(error),
      base_url: config.apiBaseUrl,
    });
  }

  let stopping = false;
  async function shutdown(signal: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    logger.info('shutdown', { signal });
    try {
      await bot.stop();
    } finally {
      process.exit(0);
    }
  }

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  logger.info('bot_starting', { api_base_url: config.apiBaseUrl });
  try {
    await bot.start({
      allowed_updates: ['message', 'callback_query'],
      onStart: (me) => {
        logger.info('bot_started', { username: me.username, id: me.id });
      },
    });
  } catch (error) {
    logger.error('bot_start_failed', { error });
    process.exitCode = 1;
  }
}

void main();
