import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { BotConfig } from './config.js';
import type { BotHandler, BotReply, TelegramUpdate } from './handlers.js';

export function verifyWebhookSecret(headerVal: string | undefined, expectedSecret: string): boolean {
  if (!expectedSecret) return true;
  if (!headerVal) return false;
  const a = Buffer.from(headerVal, 'utf8');
  const b = Buffer.from(expectedSecret, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(method: string, payload: Record<string, unknown>, timeoutMs = 35000): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const json = (await res.json()) as { ok?: boolean; result?: unknown; description?: string };
      if (!res.ok || !json.ok) {
        throw new Error(`Telegram API ${method} failed: ${json.description ?? res.status}`);
      }
      return json.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async getUpdates(offset: number, timeoutSec: number): Promise<TelegramUpdate[]> {
    const res = await this.call(
      'getUpdates',
      { offset, timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] },
      (timeoutSec + 10) * 1000,
    );
    return Array.isArray(res) ? (res as TelegramUpdate[]) : [];
  }

  async sendMessage(chatId: number | string, reply: BotReply): Promise<void> {
    await this.call('sendMessage', {
      chat_id: chatId,
      text: reply.text,
      parse_mode: reply.parse_mode,
      disable_web_page_preview: true,
      ...(reply.reply_markup ? { reply_markup: reply.reply_markup } : {}),
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

  async setWebhook(url: string, secretToken: string): Promise<void> {
    await this.call('setWebhook', {
      url,
      ...(secretToken ? { secret_token: secretToken } : {}),
      allowed_updates: ['message', 'callback_query'],
    });
  }
}

async function readBody(req: IncomingMessage, maxBytes = 256_000): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new Error('Payload too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

export function createBotHttpServer(
  config: BotConfig,
  handler: BotHandler,
  tgApi: TelegramApi | null,
): Server {
  return createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const urlPath = (req.url ?? '/').split('?')[0];

    if (method === 'GET' && urlPath === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'afisha-bot',
        mode: config.resolvedMode,
        token_configured: Boolean(config.botToken),
      });
      return;
    }

    if (method === 'POST' && urlPath === '/webhook') {
      const headerSecret = req.headers['x-telegram-bot-api-secret-token'];
      const secretStr = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret;
      if (!verifyWebhookSecret(secretStr, config.webhookSecret)) {
        sendJson(res, 401, { error: 'Unauthorized webhook secret' });
        return;
      }

      try {
        const raw = await readBody(req);
        const update = JSON.parse(raw) as TelegramUpdate;
        const result = await handler.handleUpdate(update);
        if (result && tgApi) {
          if (result.callbackQueryId) {
            await tgApi.answerCallbackQuery(result.callbackQueryId, result.reply.callback_alert);
          }
          await tgApi.sendMessage(result.chatId, result.reply);
        }
        sendJson(res, 200, { ok: true, handled: Boolean(result) });
      } catch {
        sendJson(res, 400, { error: 'Invalid webhook payload' });
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });
}
