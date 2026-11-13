/*!
 * Виджет «Афиша культуры Башкортостана»: список ближайших событий для любого сайта.
 * Один файл, без зависимостей и без cookie. Подключение одной строкой:
 *
 *   <script src="https://<адрес афиши>/widget.js" data-city="ufa" data-category="theatre"
 *           data-limit="5" data-theme="light" data-lang="ru" async></script>
 *
 * Параметры (все необязательные):
 *   data-city      код города или несколько через запятую: ufa, sterlitamak, salavat ...
 *   data-category  код категории: theatre, concert, museum, exhibition, festival, kids
 *   data-limit     сколько событий показать, от 1 до 10 (по умолчанию 5)
 *   data-theme     light (по умолчанию) или dark
 *   data-lang      ru или ba (по умолчанию язык страницы: <html lang="ba"> даёт башкирский)
 *   data-target    CSS-селектор элемента, куда поставить виджет (по умолчанию сразу после тега script)
 *
 * Как устроен:
 *   - адрес API берётся из адреса самого скрипта: <адрес афиши>/api/v1/events;
 *   - разметка живёт в Shadow DOM: стили страницы на виджет не действуют, стили виджета на страницу тоже;
 *   - всё, что пришло из API, попадает на страницу только через textContent;
 *   - если браузер не умеет Shadow DOM, вместо списка встаёт iframe со страницей /embed.
 */
(function () {
  'use strict';

  var READY_ATTR = 'data-afisha-ready';
  var HOST_ATTR = 'data-afisha-widget';
  var MAX_LIMIT = 10;
  var DEFAULT_LIMIT = 5;
  var TIMEOUT_MS = 12000;
  var NBSP = ' ';

  // ------------------------------------------------------------------ Подписи

  var TEXT = {
    ru: {
      heading: 'Афиша событий',
      allEvents: 'Все события',
      brand: 'Афиша культуры Башкортостана',
      demo: 'Демо-данные',
      loading: 'Загружаем события',
      empty: 'Событий с такими настройками пока нет.',
      error: 'Афиша не загрузилась.',
      errorHint: 'Проверьте интернет и попробуйте ещё раз.',
      retry: 'Повторить',
      newTab: 'откроется в новой вкладке',
      free: 'Бесплатно',
      priceUnknown: 'Цена не указана',
      checked: 'проверено {ago}',
      months: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
      weekdays: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
      status: {
        scheduled: 'Состоится',
        cancelled: 'Отменён',
        postponed: 'Перенесён, дата уточняется',
        rescheduled: 'Перенесён',
        sold_out: 'Билеты кончились',
        unverified: 'Статус не подтверждён'
      }
    },
    ba: {
      heading: 'Саралар афишаһы',
      allEvents: 'Бөтә саралар',
      brand: 'Башҡортостан мәҙәниәте афишаһы',
      demo: 'Демо-мәғлүмәттәр',
      loading: 'Саралар йөкләнә',
      empty: 'Бындай көйләүҙәр менән саралар әлегә юҡ.',
      error: 'Афиша йөкләнмәне.',
      errorHint: 'Интернетты тикшерегеҙ ҙә ҡабатлап ҡарағыҙ.',
      retry: 'Ҡабатлау',
      newTab: 'яңы вкладкала асыла',
      free: 'Бушлай',
      priceUnknown: 'Хаҡы күрһәтелмәгән',
      checked: '{ago} тикшерелгән',
      months: ['ғинуар', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'],
      weekdays: ['йк', 'дш', 'шш', 'шр', 'кс', 'йм', 'шб'],
      status: {
        scheduled: 'Буласаҡ',
        cancelled: 'Юҡҡа сығарылған',
        postponed: 'Кисектерелгән, көнө асыҡлана',
        rescheduled: 'Күсерелгән',
        sold_out: 'Билеттар бөткән',
        unverified: 'Статусы раҫланмаған'
      }
    }
  };

  // ------------------------------------------------------------------- Стили

  var CSS = [
    ':host{all:initial;display:block}',
    '*,*::before,*::after{box-sizing:border-box}',
    '.aw{--bg:#fffdf8;--fg:#2b2622;--soft:#4f4842;--muted:#675f56;--line:rgba(43,38,34,.16);--line2:rgba(43,38,34,.42);',
    '--hover:rgba(43,38,34,.06);--accent:#96461f;--ok:#1d6a43;--bad:#a1243a;--warn:#755600;--sold:#4f44a3;--unv:#5c564e;',
    'container-type:inline-size;position:relative;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:6px;',
    'font:400 16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif;',
    'text-align:left;direction:ltr;font-synthesis:none;-webkit-text-size-adjust:100%;-webkit-font-smoothing:antialiased}',
    '.aw[data-theme=dark]{--bg:#171311;--fg:#fefdf8;--soft:#cbc9c2;--muted:#a39e95;--line:rgba(254,253,248,.14);--line2:rgba(254,253,248,.34);',
    '--hover:rgba(254,253,248,.08);--accent:#ee9966;--ok:#84d6a5;--bad:#f58fa0;--warn:#ecc55f;--sold:#b9b0ec;--unv:#b8b2a7}',
    '.aw :focus-visible{outline:2px solid var(--fg);outline-offset:3px;border-radius:2px}',
    '.aw__head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 16px;padding:16px 16px 14px}',
    '.aw__title{margin:0;font-size:20px;font-weight:650;line-height:1.15;letter-spacing:-.02em}',
    '.aw__caps{margin:0;font-size:12px;font-weight:700;line-height:1.25;letter-spacing:.02em;text-transform:uppercase}',
    '.aw__scope{color:var(--muted)}',
    '.aw__list{list-style:none;margin:0;padding:0}',
    '.aw__item{position:relative;display:grid;gap:4px;padding:14px 16px;border-top:1px solid var(--line);transition:background-color .18s ease}',
    '.aw__date{color:var(--accent);font-variant-numeric:tabular-nums}',
    '.aw__date span+span::before{content:", "}',
    '.aw__name{margin:0;font-size:17px;font-weight:600;line-height:1.25;letter-spacing:-.01em;overflow-wrap:anywhere}',
    '.aw__link{color:inherit;text-decoration:none}',
    '.aw__link::after{content:"";position:absolute;inset:0}',
    '.aw__link:focus-visible{outline:none}',
    '.aw__link:focus-visible::after{outline:2px solid var(--fg);outline-offset:-3px;border-radius:4px}',
    '.aw__place{margin:0;font-size:14px;line-height:1.4;color:var(--soft);overflow-wrap:anywhere}',
    '.aw__facts{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin:4px 0 0;font-size:14px;line-height:1.3}',
    '.aw__price{font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.aw__price[data-kind=free]{color:var(--ok)}',
    '.aw__price[data-kind=unknown]{font-weight:400;color:var(--muted)}',
    '.aw__status{display:inline-block;padding:2px 6px;border:1px solid;border-radius:4px;font-size:11px;font-weight:700;line-height:1.3;letter-spacing:.02em;text-transform:uppercase}',
    '.aw__status[data-status=scheduled]{color:var(--ok)}',
    '.aw__status[data-status=cancelled]{color:var(--bad)}',
    '.aw__status[data-status=postponed],.aw__status[data-status=rescheduled]{color:var(--warn)}',
    '.aw__status[data-status=sold_out]{color:var(--sold)}',
    '.aw__status[data-status=unverified]{color:var(--unv);border-style:dashed}',
    '.aw__checked{font-size:13px;color:var(--muted)}',
    '.aw__foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0 16px;padding:4px 16px;border-top:1px solid var(--line)}',
    '.aw__foot-side{display:flex;flex-wrap:wrap;align-items:center;gap:0 16px}',
    '.aw__a{display:inline-flex;align-items:center;gap:6px;min-height:44px;color:var(--fg);font-size:15px;font-weight:600;text-decoration:underline;text-decoration-color:var(--line2);text-decoration-thickness:1px;text-underline-offset:.3em;transition:text-decoration-color .18s ease}',
    '.aw__a[data-quiet]{font-size:13px;font-weight:400;color:var(--soft)}',
    '.aw__sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}',
    '.aw__note{margin:0;padding:20px 16px 8px;border-top:1px solid var(--line)}',
    '.aw__note-title{margin:0;font-size:17px;font-weight:600;line-height:1.3}',
    '.aw__note-text{margin:4px 0 0;font-size:14px;color:var(--soft)}',
    '.aw__note-actions{padding:8px 16px 12px}',
    '.aw__btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin:0;padding:0 20px;border:1px solid var(--line2);border-radius:4px;background:transparent;color:var(--fg);font:inherit;font-size:15px;font-weight:500;cursor:pointer;transition:background-color .14s ease,transform .14s ease}',
    '.aw__btn:active{transform:scale(.97)}',
    '.aw__sk{display:block;height:12px;border-radius:4px;background:var(--hover)}',
    '@media (hover:hover) and (pointer:fine){.aw__item:hover{background:var(--hover)}.aw__item:hover .aw__link{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.2em}',
    '.aw__a:hover{text-decoration-color:currentColor}.aw__btn:hover{background:var(--hover)}}',
    '@container (min-width:560px){.aw__head{padding:20px 20px 16px}.aw__title{font-size:22px}',
    '.aw__item{grid-template-columns:8.5em minmax(0,1fr) auto;column-gap:20px;align-items:start;padding:16px 20px}',
    '.aw__date{grid-row:1/span 2;display:flex;flex-direction:column;gap:2px;padding-top:4px}.aw__date span+span::before{content:none}',
    '.aw__name,.aw__place{grid-column:2}',
    '.aw__facts{grid-column:3;grid-row:1/span 2;flex-direction:column;align-items:flex-end;gap:6px;margin:0;padding-top:2px;text-align:right}',
    '.aw__foot{padding:4px 20px}.aw__note{padding:24px 20px 8px}.aw__note-actions{padding:8px 20px 16px}}',
    '@media (prefers-reduced-motion:no-preference){',
    '.aw__item[data-in]{animation:aw-in .28s cubic-bezier(.23,1,.32,1) both;animation-delay:calc(var(--i,0)*40ms)}',
    '.aw__sk{animation:aw-pulse 1.2s ease-in-out infinite alternate}}',
    '@keyframes aw-in{from{opacity:0;transform:translateY(6px)}}',
    '@keyframes aw-pulse{from{opacity:1}to{opacity:.45}}'
  ].join('');

  // ---------------------------------------------------------------- Утилиты

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function groupDigits(value) {
    var parts = String(value).split('.');
    var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    return parts[1] ? whole + ',' + parts[1] : whole;
  }

  function pluralRu(count, forms) {
    var abs = Math.abs(count) % 100;
    var last = abs % 10;
    if (abs > 10 && abs < 20) return forms[2];
    if (last === 1) return forms[0];
    if (last >= 2 && last <= 4) return forms[1];
    return forms[2];
  }

  /** «14 ноября» из строки ГГГГ-ММ-ДД. Дата разбирается как текст: пояс браузера на неё не влияет. */
  function formatDay(date, lang, withWeekday) {
    var year = Number(date.slice(0, 4));
    var month = Number(date.slice(5, 7));
    var day = Number(date.slice(8, 10));
    var text = day + NBSP + TEXT[lang].months[month - 1];
    if (!withWeekday) return text;
    var weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return TEXT[lang].weekdays[weekday] + ', ' + text;
  }

  /**
   * Части подписи сеанса: [день, время] или [период] для выставки без времени начала.
   * Сеанс приходит в форме контракта: date_start с поясом и time_precision (minute или date).
   */
  function occurrenceParts(occurrence, lang, today) {
    var startText = String(occurrence.date_start || '');
    var from = startText.slice(0, 10);
    if (!from) return [];
    if (occurrence.time_precision !== 'date') return [formatDay(from, lang, true), startText.slice(11, 16)];
    var to = occurrence.date_end ? String(occurrence.date_end).slice(0, 10) : '';
    if (!to) return [formatDay(from, lang, false)];
    if (today && from <= today) {
      return [lang === 'ba' ? formatDay(to, lang, false) + ' тиклем' : 'до ' + formatDay(to, lang, false)];
    }
    if (lang === 'ba') return [formatDay(from, lang, false) + ' - ' + formatDay(to, lang, false)];
    if (from.slice(0, 7) === to.slice(0, 7)) return ['с ' + Number(from.slice(8, 10)) + ' по ' + formatDay(to, lang, false)];
    return ['с ' + formatDay(from, lang, false) + ' по ' + formatDay(to, lang, false)];
  }

  function formatAgo(checkedAt, lang) {
    var stamp = Date.parse(checkedAt);
    if (isNaN(stamp)) return '';
    var minutes = Math.floor(Math.max(0, Date.now() - stamp) / 60000);
    var hours = Math.floor(minutes / 60);
    var days = Math.floor(hours / 24);
    if (lang === 'ba') {
      if (minutes < 1) return 'әле генә';
      if (hours < 1) return minutes + NBSP + 'минут элек';
      if (days < 1) return hours + NBSP + 'сәғәт элек';
      if (days === 1) return 'кисә';
      return days + NBSP + 'көн элек';
    }
    if (minutes < 1) return 'только что';
    if (hours < 1) return minutes + NBSP + pluralRu(minutes, ['минуту', 'минуты', 'минут']) + ' назад';
    if (days < 1) return hours + NBSP + pluralRu(hours, ['час', 'часа', 'часов']) + ' назад';
    if (days === 1) return 'вчера';
    return days + NBSP + pluralRu(days, ['день', 'дня', 'дней']) + ' назад';
  }

  /** Вид цены по полям п. 8.1: is_free, price_min (рубли, null: не указана). */
  function priceKind(event) {
    if (event.is_free) return 'free';
    return typeof event.price_min === 'number' ? 'from' : 'unknown';
  }

  /** Цена: «Бесплатно», «от 500 ₽» и «Цена не указана» это три разных состояния. */
  function formatPrice(event, lang) {
    var kind = priceKind(event);
    if (kind === 'free') return TEXT[lang].free;
    if (kind !== 'from') return TEXT[lang].priceUnknown;
    var amount = groupDigits(event.price_min);
    return lang === 'ba' ? amount + NBSP + 'һумдан' : 'от' + NBSP + amount + NBSP + '₽';
  }

  /** Статус и наличие билетов одним значением: правило то же, что на сайте афиши. */
  function displayStatus(occurrence) {
    if (occurrence.status === 'cancelled') return 'cancelled';
    if (occurrence.status === 'postponed') return 'postponed';
    if (occurrence.status === 'unknown' || occurrence.status_verified === false) return 'unverified';
    if (occurrence.availability === 'sold_out') return 'sold_out';
    if (occurrence.status === 'rescheduled') return 'rescheduled';
    return 'scheduled';
  }

  function externalLink(href, className, label, hint) {
    var link = el('a', className, label);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    link.appendChild(el('span', 'aw__sr', ' (' + hint + ')'));
    return link;
  }

  // ------------------------------------------------------------- Настройки

  function readConfig(script) {
    var base;
    try {
      base = new URL(script.src, document.baseURI).origin;
    } catch (error) {
      base = window.location.origin;
    }

    var limit = parseInt(script.getAttribute('data-limit') || '', 10);
    if (isNaN(limit)) limit = DEFAULT_LIMIT;
    limit = Math.min(MAX_LIMIT, Math.max(1, limit));

    var lang = (script.getAttribute('data-lang') || '').toLowerCase();
    if (lang !== 'ru' && lang !== 'ba') {
      lang = /^ba\b/i.test(document.documentElement.lang || '') ? 'ba' : 'ru';
    }

    return {
      base: base,
      city: (script.getAttribute('data-city') || '').trim().toLowerCase(),
      category: (script.getAttribute('data-category') || '').trim().toLowerCase(),
      limit: limit,
      theme: (script.getAttribute('data-theme') || '').toLowerCase() === 'dark' ? 'dark' : 'light',
      lang: lang,
      target: (script.getAttribute('data-target') || '').trim()
    };
  }

  function queryString(config, withLimit) {
    var parts = [];
    if (config.city) parts.push('city=' + encodeURIComponent(config.city));
    if (config.category) parts.push('category=' + encodeURIComponent(config.category));
    if (withLimit) {
      parts.push('page_size=' + config.limit);
      parts.push('sort=date');
    }
    return parts.length ? '?' + parts.join('&') : '';
  }

  // --------------------------------------------------------------- Разметка

  function renderHead(config, scope) {
    var t = TEXT[config.lang];
    var head = el('div', 'aw__head');
    head.appendChild(el('h2', 'aw__title', t.heading));
    if (scope) head.appendChild(el('p', 'aw__caps aw__scope', scope));
    return head;
  }

  function renderFoot(config, demo, filtered) {
    var t = TEXT[config.lang];
    var foot = el('div', 'aw__foot');
    foot.appendChild(
      externalLink(config.base + '/events' + (filtered ? queryString(config, false) : ''), 'aw__a', t.allEvents, t.newTab)
    );
    var side = el('div', 'aw__foot-side');
    if (demo) {
      var demoLink = externalLink(config.base + '/about#demo', 'aw__a', t.demo, t.newTab);
      demoLink.setAttribute('data-quiet', '');
      side.appendChild(demoLink);
    }
    var brand = externalLink(config.base + '/', 'aw__a', t.brand, t.newTab);
    brand.setAttribute('data-quiet', '');
    side.appendChild(brand);
    foot.appendChild(side);
    return foot;
  }

  function renderItem(event, config, today, index) {
    var t = TEXT[config.lang];
    var occurrences = event.occurrences || [];
    var occurrence = null;
    for (var i = 0; i < occurrences.length; i += 1) {
      if (occurrences[i].id === event.primary_occurrence_id) occurrence = occurrences[i];
    }
    occurrence = occurrence || occurrences[0] || null;

    var item = el('li', 'aw__item');
    item.setAttribute('data-in', '');
    item.style.setProperty('--i', String(index));

    if (occurrence) {
      var parts = occurrenceParts(occurrence, config.lang, today);
      if (parts.length) {
        var time = el('time', 'aw__caps aw__date');
        time.setAttribute('datetime', String(occurrence.date_start));
        for (var p = 0; p < parts.length; p += 1) time.appendChild(el('span', '', parts[p]));
        item.appendChild(time);
      }
    }

    var name = el('h3', 'aw__name');
    var title = config.lang === 'ba' && event.title_ba ? event.title_ba : event.title;
    name.appendChild(externalLink(config.base + '/events/' + encodeURIComponent(event.id), 'aw__link', title, t.newTab));
    item.appendChild(name);

    var place = [event.venue, event.city].filter(Boolean).join(', ');
    if (place) item.appendChild(el('p', 'aw__place', place));

    var facts = el('p', 'aw__facts');
    var price = el('span', 'aw__price', formatPrice(event, config.lang));
    price.setAttribute('data-kind', priceKind(event));
    facts.appendChild(price);
    if (occurrence) {
      var status = displayStatus(occurrence);
      var badge = el('span', 'aw__status', t.status[status]);
      badge.setAttribute('data-status', status);
      facts.appendChild(badge);
    }
    var ago = event.verified_at ? formatAgo(event.verified_at, config.lang) : '';
    if (ago) facts.appendChild(el('span', 'aw__checked', t.checked.replace('{ago}', ago)));
    item.appendChild(facts);

    return item;
  }

  function renderSkeleton(config) {
    var list = el('ul', 'aw__list');
    list.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < config.limit; i += 1) {
      var item = el('li', 'aw__item');
      var widths = ['28%', '72%', '48%'];
      for (var w = 0; w < widths.length; w += 1) {
        var bar = el('span', 'aw__sk');
        bar.style.width = widths[w];
        if (w === 1) bar.style.height = '18px';
        item.appendChild(bar);
      }
      list.appendChild(item);
    }
    return list;
  }

  /** Подпись под заголовком: «Уфа, театр». Названия берём из счётчиков того же ответа. */
  function scopeLabel(data, config) {
    var facets = data.facets || {};
    var labels = [];
    function collect(ids, entries) {
      if (!ids || !entries) return;
      for (var i = 0; i < ids.length; i += 1) {
        for (var j = 0; j < entries.length; j += 1) {
          if (entries[j].id === ids[i] && entries[j].name) labels.push(entries[j].name[config.lang] || entries[j].name.ru);
        }
      }
    }
    var applied = data.applied || {};
    collect(applied.city, facets.cities);
    collect(applied.category, facets.categories);
    return labels.join(', ');
  }

  // ------------------------------------------------------------------ Запуск

  function mount(script) {
    var config = readConfig(script);
    var t = TEXT[config.lang];

    var host = document.createElement('div');
    host.className = 'afisha-widget';
    host.setAttribute(HOST_ATTR, '');

    var target = null;
    if (config.target) {
      try {
        target = document.querySelector(config.target);
      } catch (error) {
        target = null;
      }
      if (!target && window.console) console.warn('[afisha-widget] элемент по data-target не найден:', config.target);
    }
    if (target) {
      var previous = target.querySelectorAll('[' + HOST_ATTR + ']');
      for (var i = 0; i < previous.length; i += 1) previous[i].parentNode.removeChild(previous[i]);
      target.appendChild(host);
    } else if (script.parentNode && script.parentNode !== document.head) {
      script.parentNode.insertBefore(host, script.nextSibling);
    } else {
      // Скрипт стоит в <head>: места «рядом» нет, виджет встаёт в конец страницы.
      (document.body || document.documentElement).appendChild(host);
    }

    if (!host.attachShadow) {
      var frame = document.createElement('iframe');
      var scope = queryString(config, false);
      frame.src =
        config.base + '/embed' + (scope ? scope + '&' : '?') +
        'limit=' + config.limit + '&theme=' + config.theme + '&lang=' + config.lang;
      frame.title = t.heading;
      frame.loading = 'lazy';
      frame.style.cssText = 'display:block;width:100%;border:0;height:' + (160 + config.limit * 112) + 'px';
      host.appendChild(frame);
      return;
    }

    var root = host.attachShadow({ mode: 'open' });
    var sheetApplied = false;
    try {
      if ('adoptedStyleSheets' in root && typeof CSSStyleSheet === 'function') {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        root.adoptedStyleSheets = [sheet];
        sheetApplied = true;
      }
    } catch (error) {
      sheetApplied = false;
    }
    if (!sheetApplied) root.appendChild(el('style', '', CSS));

    var box = el('section', 'aw');
    box.setAttribute('data-theme', config.theme);
    box.setAttribute('lang', config.lang);
    box.setAttribute('aria-label', t.heading);
    root.appendChild(box);

    var controller = null;

    function showLoading() {
      clear(box);
      box.setAttribute('aria-busy', 'true');
      box.setAttribute('data-state', 'loading');
      box.appendChild(renderHead(config, ''));
      box.appendChild(el('p', 'aw__sr', t.loading));
      box.appendChild(renderSkeleton(config));
    }

    function showNote(state, title, text, withRetry) {
      clear(box);
      box.removeAttribute('aria-busy');
      box.setAttribute('data-state', state);
      box.appendChild(renderHead(config, ''));
      var note = el('div', 'aw__note');
      note.setAttribute('role', state === 'error' ? 'alert' : 'status');
      note.appendChild(el('p', 'aw__note-title', title));
      if (text) note.appendChild(el('p', 'aw__note-text', text));
      box.appendChild(note);
      if (withRetry) {
        var actions = el('div', 'aw__note-actions');
        var button = el('button', 'aw__btn', t.retry);
        button.type = 'button';
        button.addEventListener('click', load);
        actions.appendChild(button);
        box.appendChild(actions);
      }
      box.appendChild(renderFoot(config, false, false));
    }

    function showList(data) {
      var items = data.items || [];
      if (!items.length) {
        showNote('empty', t.empty, '', false);
        return;
      }
      clear(box);
      box.removeAttribute('aria-busy');
      box.setAttribute('data-state', 'ready');
      box.appendChild(renderHead(config, scopeLabel(data, config)));
      var list = el('ul', 'aw__list');
      var demo = false;
      for (var i = 0; i < items.length; i += 1) {
        if (items[i].synthetic) demo = true;
        list.appendChild(renderItem(items[i], config, data.reference_date || '', i));
      }
      box.appendChild(list);
      box.appendChild(renderFoot(config, demo, true));
    }

    function load() {
      if (controller) controller.abort();
      controller = typeof AbortController === 'function' ? new AbortController() : null;
      var current = controller;
      var timer = window.setTimeout(function () {
        if (current) current.abort();
      }, TIMEOUT_MS);
      showLoading();

      fetch(config.base + '/api/v1/events' + queryString(config, true), {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        signal: current ? current.signal : undefined
      })
        .then(function (response) {
          return response.json().then(
            function (body) {
              return { ok: response.ok, status: response.status, body: body };
            },
            function () {
              return { ok: false, status: response.status, body: null };
            }
          );
        })
        .then(function (result) {
          window.clearTimeout(timer);
          if (current !== controller) return;
          if (result.ok && result.body && Array.isArray(result.body.items)) {
            showList(result.body);
            return;
          }
          // 400: в настройках виджета неизвестный город или категория. Сообщение API написано для человека.
          var message = result.status === 400 && result.body ? String(result.body.message || '') : '';
          showNote('error', t.error, message || t.errorHint, !message);
        })
        .catch(function () {
          window.clearTimeout(timer);
          if (current !== controller) return;
          showNote('error', t.error, t.errorHint, true);
        });
    }

    load();
  }

  function findScript() {
    var current = document.currentScript;
    if (current && !current.hasAttribute(READY_ATTR)) return current;
    var all = document.querySelectorAll('script[src*="widget.js"]');
    for (var i = all.length - 1; i >= 0; i -= 1) {
      if (!all[i].hasAttribute(READY_ATTR)) return all[i];
    }
    return null;
  }

  var script = findScript();
  if (!script) return;
  script.setAttribute(READY_ATTR, '');

  if (document.body) {
    mount(script);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      mount(script);
    });
  }
})();
