import { createApiClient } from './api/client.js';
import { createBot } from './bot.js';
import { ConfigError, loadConfig } from './config.js';
import { DirectoryService } from './directory-service.js';
import { createLogger } from './logger.js';
import { SessionStore } from './session.js';
import { BOT_COMMANDS } from './texts.js';

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
    retryAttempts: config.apiRetryAttempts,
  });
  const sessions = new SessionStore({ ttlMs: config.sessionTtlMs });
  const directories = new DirectoryService();

  const [healthResult, catalogsResult] = await Promise.allSettled([
    api.health(),
    directories.refresh(api),
  ]);

  if (healthResult.status === 'fulfilled') {
    const health = healthResult.value;
    if (health.status === 'ok') {
      logger.info('api_health', { status: health.status, base_url: config.apiBaseUrl });
    } else {
      logger.warn('api_health_degraded', { status: health.status, base_url: config.apiBaseUrl });
    }
  } else {
    logger.warn('api_health_failed', {
      error:
        healthResult.reason instanceof Error
          ? healthResult.reason.message
          : String(healthResult.reason),
      base_url: config.apiBaseUrl,
    });
  }

  if (catalogsResult.status === 'rejected') {
    logger.warn('directories_refresh_failed', {
      error:
        catalogsResult.reason instanceof Error
          ? catalogsResult.reason.message
          : String(catalogsResult.reason),
    });
  } else {
    const catalogs = catalogsResult.value;
    if (catalogs.cities.loaded && catalogs.categories.loaded) {
      logger.info('directories_loaded', {
        cities: catalogs.cities.count,
        categories: catalogs.categories.count,
      });
    } else {
      logger.warn('directories_fallback', {
        cities: catalogs.cities,
        categories: catalogs.categories,
      });
    }
    if (catalogs.cities.truncated || catalogs.categories.truncated) {
      logger.warn('directories_truncated', {
        cities: catalogs.cities.truncated ? catalogs.cities.count : undefined,
        categories: catalogs.categories.truncated ? catalogs.categories.count : undefined,
      });
    }
  }

  const bot = createBot(config.telegramBotToken, {
    api,
    sessions,
    config,
    logger,
    directories,
  });

  try {
    await bot.api.setMyCommands(BOT_COMMANDS);
    logger.info('bot_commands_set', { count: BOT_COMMANDS.length });
  } catch (error) {
    logger.warn('bot_commands_failed', { error });
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
