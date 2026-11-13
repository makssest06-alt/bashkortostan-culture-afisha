import { BackendApiClient } from './api-client.js';
import { loadBotConfig } from './config.js';
import { BotHandler } from './handlers.js';
import { SessionStore } from './session.js';
import { createBotHttpServer, TelegramApi } from './telegram.js';

async function main() {
  const config = loadBotConfig();
  const api = new BackendApiClient(
    config.apiBaseUrl,
    fetch,
    config.requestTimeoutMs,
    config.assistantTimeoutMs,
  );
  const sessions = new SessionStore();
  const handler = new BotHandler(api, sessions, config);
  const tgApi = config.botToken ? new TelegramApi(config.botToken) : null;

  const server = createBotHttpServer(config, handler, tgApi);
  server.listen(config.port, () => {
    console.log(
      JSON.stringify({
        time: new Date().toISOString(),
        level: 'info',
        message: 'bot_started',
        mode: config.resolvedMode,
        port: config.port,
        api_base_url: config.apiBaseUrl,
      }),
    );
  });

  if (config.resolvedMode === 'standby') {
    console.log(
      JSON.stringify({
        time: new Date().toISOString(),
        level: 'info',
        message: 'bot_standby_no_token',
      }),
    );
    return;
  }

  if (config.resolvedMode === 'webhook' && tgApi && config.webhookUrl) {
    await tgApi.setWebhook(config.webhookUrl, config.webhookSecret);
    return;
  }

  let running = true;
  process.once('SIGINT', () => {
    running = false;
    server.close();
  });
  process.once('SIGTERM', () => {
    running = false;
    server.close();
  });

  let offset = 0;
  while (running && tgApi) {
    try {
      const updates = await tgApi.getUpdates(offset, config.pollTimeoutSec);
      for (const upd of updates) {
        offset = Math.max(offset, upd.update_id + 1);
        const result = await handler.handleUpdate(upd);
        if (result) {
          if (result.callbackQueryId) {
            await tgApi.answerCallbackQuery(result.callbackQueryId, result.reply.callback_alert);
          }
          await tgApi.sendMessage(result.chatId, result.reply);
        }
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          time: new Date().toISOString(),
          level: 'error',
          message: 'bot_polling_error',
          error: err instanceof Error ? err.message : 'unknown',
        }),
      );
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

void main();
