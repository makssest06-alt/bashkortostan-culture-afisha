import type { BotEvent } from './api-client.js';

export const CATEGORY_LABELS: Record<string, string> = {
  concert: 'Концерт',
  performance: 'Спектакль',
  exhibition: 'Выставка',
  festival: 'Фестиваль',
  cinema: 'Кино',
  excursion: 'Экскурсия',
  other: 'Другое',
};

export const CITY_LABELS: Record<string, string> = {
  ufa: 'Уфа',
  sterlitamak: 'Стерлитамак',
  salavat: 'Салават',
  neftekamsk: 'Нефтекамск',
  oktyabrsky: 'Октябрьский',
  beloretsk: 'Белорецк',
  sibay: 'Сибай',
  kumertau: 'Кумертау',
};

export const PERIOD_LABELS: Record<string, string> = {
  today: 'Сегодня',
  tomorrow: 'Завтра',
  weekend: 'Выходные',
  week: 'Неделя',
};

export function escapeHtml(text: string): string {
  return text
    .replace(/\b(javascript|vbscript|data):/gi, '[blocked-uri]:')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function assertCallbackData64(data: string): string {
  const bytes = Buffer.byteLength(data, 'utf8');
  if (bytes > 64) {
    throw new Error(`callback_data exceeds 64 bytes (${bytes}): ${data}`);
  }
  return data;
}

const DATE_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Yekaterinburg',
});

const DATE_TIME_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Yekaterinburg',
});

export function formatEventDate(dateStart: string | null, precision?: 'minute' | 'date'): string {
  if (!dateStart) return 'Дата уточняется';
  const d = new Date(dateStart);
  if (Number.isNaN(d.getTime())) return escapeHtml(dateStart);
  return precision === 'date' || !dateStart.includes('T') ? DATE_FMT.format(d) : DATE_TIME_FMT.format(d);
}

export function formatPrice(event: Pick<BotEvent, 'is_free' | 'price_min' | 'price_max'>): string {
  if (event.is_free) return 'Бесплатно';
  if (event.price_min === null) return 'Цена не указана';
  if (event.price_max !== null && event.price_max !== event.price_min) {
    return `от ${event.price_min} до ${event.price_max} ₽`;
  }
  return event.price_min === 0 ? 'Бесплатно' : `от ${event.price_min} ₽`;
}

export function formatEventShortLine(event: BotEvent, index: number): string {
  const cat = CATEGORY_LABELS[event.category] ?? event.category;
  const when = formatEventDate(event.date_start, event.time_precision);
  const price = formatPrice(event);
  const age = event.age_limit !== null ? `${event.age_limit}+` : 'возраст не указан';
  const cancelled = event.status === 'cancelled' ? ' [ОТМЕНЕНО]' : '';
  return (
    `${index}. <b>${escapeHtml(event.title)}</b>${cancelled}\n` +
    `   ${escapeHtml(cat)} · ${escapeHtml(when)} · ${escapeHtml(event.city)}, ${escapeHtml(event.venue)}\n` +
    `   ${escapeHtml(price)} · ${escapeHtml(age)}`
  );
}

export function formatEventCardHtml(
  event: BotEvent,
  options: { publicWebUrl: string; reasons?: string[]; caveats?: string[] },
): string {
  const lines: string[] = [];
  const cat = CATEGORY_LABELS[event.category] ?? event.category;
  if (event.status === 'cancelled') {
    lines.push('🚫 <b>Мероприятие отменено</b>');
  }
  lines.push(`<b>${escapeHtml(event.title)}</b>`);
  lines.push(`📂 ${escapeHtml(cat)} · 🔞 ${event.age_limit !== null ? `${event.age_limit}+` : 'возраст не указан'}`);
  lines.push(`🗓 ${escapeHtml(formatEventDate(event.date_start, event.time_precision))}`);
  lines.push(
    `📍 ${escapeHtml(event.city)}, ${escapeHtml(event.venue)}${event.address ? ` (${escapeHtml(event.address)})` : ''}`,
  );
  lines.push(`💳 ${escapeHtml(formatPrice(event))}`);

  const desc = event.description.trim();
  if (desc) {
    const shortDesc = desc.length > 420 ? `${desc.slice(0, 417)}...` : desc;
    lines.push('', escapeHtml(shortDesc));
  }

  if (options.reasons && options.reasons.length > 0) {
    lines.push('', `✨ <b>Почему подходит:</b> ${escapeHtml(options.reasons.join('; '))}`);
  }
  if (options.caveats && options.caveats.length > 0) {
    lines.push(`⚠️ ${escapeHtml(options.caveats.join('; '))}`);
  }

  const webCardUrl = safeHttpUrl(`${options.publicWebUrl}/events/${event.id}`);
  const srcUrl = safeHttpUrl(event.source_url);
  const ticketUrl = safeHttpUrl(event.org_link);

  const links: string[] = [];
  if (webCardUrl) links.push(`<a href="${escapeHtml(webCardUrl)}">Карточка на сайте</a>`);
  if (ticketUrl) links.push(`<a href="${escapeHtml(ticketUrl)}">Билеты / сайт</a>`);
  if (srcUrl) links.push(`<a href="${escapeHtml(srcUrl)}">Источник</a>`);
  if (links.length > 0) {
    lines.push('', links.join(' · '));
  }

  return lines.join('\n');
}
