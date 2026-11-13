/**
 * Башкирский словарь интерфейса. Набор ключей тот же, что у русского (dict.ru.ts):
 * это проверяет тип `Record<DictKey, string>`. Если ключа здесь нет, берётся русский текст.
 *
 * В башкирском после числа форма слова одна, поэтому ключи .one, .few и .many совпадают.
 * Примеры запросов к ИИ-подбору оставлены на русском: ассистент пока понимает только его.
 *
 * Перевод сделан без носителя языка. Строки под сомнением перечислены в отчёте агента
 * и помечены здесь словом «проверить»: их нужно показать носителю до защиты.
 */

import type { DictKey } from './dict.ru';

export const ba: Record<DictKey, string> = {
  // ------------------------------------------------------------ Навигация
  'nav.home': 'Төп бит',
  'nav.events': 'Саралар',
  'nav.ask': 'ЯИ-һайлау', // проверить: принятое сокращение «яһалма интеллект»
  'nav.widget': 'Виджет',
  'nav.api': 'Эшләүселәргә', // проверить: «разработчикам»
  'nav.about': 'Проект тураһында',
  'nav.menu': 'Меню',
  'nav.openMenu': 'Менюны асыу',
  'nav.closeMenu': 'Менюны ябыу',
  'nav.main': 'Төп навигация',
  'nav.skipToContent': 'Йөкмәткегә күсеү',
  'nav.telegram': 'Telegram-бот',

  // ---------------------------------------------------------------- Общее
  'common.brand': 'АФИША',
  'common.brandFull': 'Башҡортостан мәҙәниәте афишаһы',
  'common.demoData': 'Демо-мәғлүмәттәр',
  'preload.caption': 'Башҡортостан мәҙәниәте афишаһы',
  'preload.loading': 'Сәхнәләр йөкләнә', // проверить
  'common.demoDataHint': 'Саралар шартлы: улар афишаның нисек эшләгәнен күрһәтә.',
  'common.telegram': 'Telegram-бот',
  'common.telegramOpen': 'Telegram-да асыу',
  'common.loading': 'Йөкләнә…',
  'common.error': 'Мәғлүмәттәрҙе йөкләп булманы.',
  'common.errorHint': 'Интернетты тикшерегеҙ ҙә ҡабатлап ҡарағыҙ.',
  'common.retry': 'Ҡабатлау',
  'common.back': 'Артҡа',
  'common.close': 'Ябыу',
  'common.open': 'Асыу',
  'common.more': 'Тағы күрһәтеү',
  'common.all': 'Бөтәһе',
  'common.copy': 'Күсереп алыу',
  'common.copied': 'Күсерелде',
  'common.today': 'Бөгөн',
  'common.tomorrow': 'Иртәгә',
  'common.notFound.title': 'Бындай бит юҡ',
  'common.notFound.text': 'Һылтанма иҫкергән булыуы мөмкин. Бөтә саралар каталогта бар.',
  'common.notFound.action': 'Каталогты асыу',

  // ----------------------------------------------------------------- Язык
  'lang.ru': 'РУС',
  'lang.ba': 'БАШ',
  'lang.ruFull': 'Русса',
  'lang.baFull': 'Башҡортса',
  'lang.switch': 'Интерфейс теле',

  // -------------------------------------------------------------- Главная
  'home.metaTitle': 'Башҡортостан мәҙәниәте афишаһы: театрҙар, концерттар, музейҙар',
  'home.metaDescription':
    'Республиканың тикшерелгән саралары бер афишала. Көн, ҡала, хаҡ һәм йәш буйынса фильтрҙар, ирекле һөйләм буйынса һайлау.',
  'home.scrollHint': 'Артабан ҡарағыҙ', // проверить: «листайте дальше»
  'home.skipStory': 'Туранан-тура сараларға',
  'home.progress': 'Битте ҡарау барышы', // проверить: «прогресс прокрутки»

  // -------------------------------------------------------------- Каталог
  'events.title': 'Саралар',
  'events.subtitle':
    'Республиканың театрҙары, концерттары, музейҙары һәм фестивалдәре. Һәр сараның сығанағы һәм тикшерелгән ваҡыты күрһәтелгән.',
  'events.metaTitle': 'Саралар: афиша каталогы',
  'events.count.one': '{count} сара',
  'events.count.few': '{count} сара',
  'events.count.many': '{count} сара',
  'events.found.one': '{count} сара табылды',
  'events.found.few': '{count} сара табылды',
  'events.found.many': '{count} сара табылды',
  'events.filtersButton': 'Фильтрҙар',
  'events.filtersActive.one': '{count} фильтр һайланған',
  'events.filtersActive.few': '{count} фильтр һайланған',
  'events.filtersActive.many': '{count} фильтр һайланған',
  'events.showResults.one': '{count} сараны күрһәтеү',
  'events.showResults.few': '{count} сараны күрһәтеү',
  'events.showResults.many': '{count} сараны күрһәтеү',
  'events.hiddenUnknownPrice.one': 'Тағы {count} сараның хаҡы күрһәтелмәгән: хаҡ фильтрына улар инмәне',
  'events.hiddenUnknownPrice.few': 'Тағы {count} сараның хаҡы күрһәтелмәгән: хаҡ фильтрына улар инмәне',
  'events.hiddenUnknownPrice.many': 'Тағы {count} сараның хаҡы күрһәтелмәгән: хаҡ фильтрына улар инмәне',
  'events.hiddenUnknownAge.one': 'Тағы {count} сараның йәш билдәһе юҡ: йәш фильтрына улар инмәне',
  'events.hiddenUnknownAge.few': 'Тағы {count} сараның йәш билдәһе юҡ: йәш фильтрына улар инмәне',
  'events.hiddenUnknownAge.many': 'Тағы {count} сараның йәш билдәһе юҡ: йәш фильтрына улар инмәне',
  'events.hidden.show': 'Күрһәтеү', // проверить
  'events.hidden.hide': 'Йәшереү', // проверить
  'events.loadMore': 'Тағы күрһәтеү',
  'events.page': 'Бит {page} / {total}',
  'events.prev': 'Артҡа',
  'events.next': 'Алға',
  'events.loading': 'Саралар һайлана…',
  'events.error': 'Каталог йөкләнмәне.',
  'events.nearest': 'Яҡындағы саралар',
  'events.popular': 'Популяр',
  'events.card.more': 'Тулыраҡ',
  'events.card.moreSessions.one': 'һәм тағы {count} сеанс',
  'events.card.moreSessions.few': 'һәм тағы {count} сеанс',
  'events.card.moreSessions.many': 'һәм тағы {count} сеанс',
  'events.card.noImage': 'Һүрәт юҡ',

  // -------------------------------------------------------------- Фильтры
  'filters.title': 'Фильтрҙар',
  'filters.date': 'Дата',
  'filters.date.any': 'Теләһә ҡайһы көн',
  'filters.date.today': 'Бөгөн',
  'filters.date.tomorrow': 'Иртәгә',
  'filters.date.weekend': 'Ял көндәре',
  'filters.date.week': 'Ошо аҙна',
  'filters.date.calendar': 'Көндәрҙе һайлау',
  'filters.date.from': 'Башы', // проверить: подписи полей «с» и «по»
  'filters.date.to': 'Аҙағы',
  'filters.city': 'Ҡала',
  'filters.city.all': 'Бөтә республика',
  'filters.price': 'Хаҡ',
  'filters.price.any': 'Теләһә ниндәй хаҡ',
  'filters.price.max': '{amount} ₽ тиклем',
  'filters.price.maxLabel': 'Иң юғары хаҡ, ₽',
  'filters.price.freeOnly': 'Бушлай ғына',
  'filters.price.perPerson': 'бер кешегә',
  'filters.age': 'Йәш',
  'filters.age.any': 'Теләһә ниндәй йәш',
  'filters.age.child': 'Баланың йәше',
  'filters.age.childHint': 'Ошо йәштәге бала менән барырға мөмкин булған сараларҙы күрһәтәбеҙ.',
  'filters.category': 'Категория',
  'filters.category.all': 'Бөтә категориялар',
  'filters.status': 'Статус',
  'filters.status.default': 'Актуаль саралар ғына',
  'filters.status.all': 'Бөтәһе, юҡҡа сығарылғандары менән',
  'filters.time': 'Башланыу ваҡыты',
  'filters.time.from': 'Иртәрәк түгел',
  'filters.time.to': 'Һуңыраҡ түгел',
  'filters.audience.kids': 'Балалар менән',
  'filters.search': 'Эҙләү',
  'filters.search.placeholder': 'Исем, майҙансыҡ йәки жанр',
  'filters.search.clear': 'Эҙләүҙе таҙартыу',
  'filters.sort': 'Тәртипкә һалыу',
  'filters.sort.date': 'Башта яҡындағылары',
  'filters.sort.price': 'Башта арзаныраҡтары',
  'filters.sort.popularity': 'Башта популярҙары',
  'filters.reset': 'Фильтрҙарҙы таҙартыу',
  'filters.apply': 'Ҡулланыу',
  'filters.remove': 'Фильтрҙы алып ташлау: {label}',

  // ----------------------------------------------------------- Сортировка
  'sort.label': 'Тәртипкә һалыу',
  'sort.date': 'Башта яҡындағылары',
  'sort.price': 'Башта арзаныраҡтары',
  'sort.popularity': 'Башта популярҙары',

  // -------------------------------------------------------- Пустая выдача
  'empty.title': 'Был шарттар буйынса саралар юҡ',
  'empty.hint': 'Бер нәмә лә уйлап сығармайбыҙ. Бер шартты үҙгәртегеҙ, һәм варианттар табылыр:',
  'empty.relaxation': '{label}: {count}',
  'empty.noOptions': 'Көндө йәки ҡаланы үҙгәртеп ҡарағыҙ.',
  'empty.reset': 'Бөтә фильтрҙарҙы таҙартыу',
  'empty.askAi': 'ЯИ-һайлауҙан һорау',

  // ------------------------------------------------------ Карточка события
  'event.metaFallback': 'Сара',
  'event.backToCatalog': 'Бөтә саралар',
  'event.sessions': 'Сеанстар',
  'event.sessions.nearest': 'Яҡындағы сеанс',
  'event.sessions.all': 'Бөтә сеанстар',
  'event.sessions.past': 'Үткән сеанстар',
  'event.sessions.none': 'Яҡын арала сеанстар юҡ',
  'event.period.until': '{date} тиклем',
  'event.period.range': '{from} - {to}',
  'event.previousDate': 'Элек: {date}',
  'event.newDate': 'Яңы көнө: {date}',
  'event.price': 'Хаҡ',
  'event.price.note': 'Хаҡтар сығанаҡ мәғлүмәте буйынса күрһәтелгән. Теүәл хаҡты һатып алғанда тикшерегеҙ.',
  'event.venue': 'Майҙансыҡ',
  'event.address': 'Адрес',
  'event.addressUnknown': 'Адрес асыҡлана',
  'event.map': 'Карта',
  'event.openMap': 'Картала асыу',
  'event.source': 'Сығанаҡ',
  'event.sourceLink': 'Төп сығанаҡ',
  'event.checked': '{ago} тикшерелгән',
  'event.sources.one': '{count} сығанаҡтан йыйылған',
  'event.sources.few': '{count} сығанаҡтан йыйылған',
  'event.sources.many': '{count} сығанаҡтан йыйылған',
  'event.buy': 'Билет һатып алыу',
  'event.buy.soldOut': 'Билеттар бөткән',
  'event.buy.noLink': 'Билеттарға һылтанма күрһәтелмәгән',
  'event.buy.cancelled': 'Сеанс юҡҡа сығарылған',
  'event.buy.free': 'Инеү ирекле',
  'event.buy.external': 'Билет ойоштороусы сайтында һатыла',
  'event.age': 'Йәш',
  'event.category': 'Категория',
  'event.organizer': 'Ойоштороусы',
  'event.description': 'Тасуирлама',
  'event.showMore': 'Тулыһынса уҡыу',
  'event.showLess': 'Йыйыу', // проверить: «свернуть»
  'event.share': 'Уртаҡлашыу',
  'event.linkCopied': 'Һылтанма күсерелде',
  'event.similar': 'Оҡшаш саралар',
  'event.demoNote':
    'Демонстрацион карточка. Сара шартлы: ул афишаның сеанстарҙы, хаҡтарҙы һәм статустарҙы нисек күрһәткәнен аңлата.',
  'event.notFound.title': 'Бындай сара юҡ',
  'event.notFound.text': 'Һылтанма иҫкергән булыуы мөмкин. Хәҙер нимә барғанын ҡарағыҙ.',
  'event.notFound.action': 'Каталогты асыу',

  // -------------------------------------------------------------- Статусы
  'status.scheduled': 'Буласаҡ',
  'status.cancelled': 'Юҡҡа сығарылған',
  'status.postponed': 'Кисектерелгән, көнө асыҡлана',
  'status.rescheduled': 'Күсерелгән',
  'status.unknown': 'Статусы раҫланмаған',
  'status.unverified': 'Статусы раҫланмаған',
  'status.soldOut': 'Билеттар бөткән',
  'status.available': 'Билеттар бар',
  'status.availabilityUnknown': 'Билеттар барлығы раҫланмаған',
  'status.past': 'Үткән',

  // ----------------------------------------------------------------- Цена
  'price.free': 'Бушлай',
  'price.from': '{amount} һумдан',
  'price.unknown': 'Хаҡы күрһәтелмәгән',
  'price.unknownHint': 'Сығанаҡ хаҡты хәбәр итмәгән. Был инеү бушлай тигәнде аңлатмай.',
  'price.offers': 'Билеттар һәм хаҡтар',
  'price.general': 'Билет',
  'price.adult': 'Өлкәндәр өсөн',
  'price.child': 'Балалар өсөн',
  'price.reduced': 'Ташламалы',
  'price.perPerson': 'бер кешегә',

  // -------------------------------------------------------------- Возраст
  'age.label': 'Йәш сикләүе',
  'age.unknown': 'Йәше күрһәтелмәгән',
  'age.unknownHint': 'Сығанаҡ йәш сикләүен хәбәр итмәгән. Уны ойоштороусынан асыҡлағыҙ.',
  'age.0': 'Теләһә ниндәй йәш өсөн',
  'age.6': '6 йәштән',
  'age.12': '12 йәштән',
  'age.16': '16 йәштән',
  'age.18': '18 йәштән',

  // ------------------------------------------------------------ ИИ-подбор
  'ask.title': 'ЯИ-һайлау',
  'ask.subtitle':
    'Дуҫығыҙға әйткәндәй яҙығыҙ: ҡасан, ҡайҙа, кем менән һәм күпме аҡсаға. Аңлашылған шарттарҙы чиптарҙа уҡ үҙгәртергә мөмкин.',
  'ask.metaTitle': 'Сараларҙы ЯИ ярҙамында һайлау',
  'ask.intro':
    'Көн, ҡала, бюджет һәм кем менән барыуығыҙ тураһында һорағыҙ. Каталогтағы саралар менән генә яуап бирәм һәм уларҙың ни өсөн тап килеүен аңлатам.',
  'ask.inputLabel': 'Һеҙҙең һорау',
  'ask.placeholder': 'Куда пойти в субботу с ребёнком до 1000 ₽',
  'ask.send': 'Һайлау',
  'ask.examples': 'Ошолай һорап ҡарағыҙ',
  'ask.example1': 'Куда пойти в субботу с ребёнком до 1000 ₽',
  'ask.example2': 'Что-нибудь спокойное в Уфе сегодня вечером',
  'ask.example3': 'Бесплатные выставки на выходных',
  'ask.example4': 'Концерт в Стерлитамаке на этой неделе',
  'ask.chips': 'Ошолай аңланым',
  'ask.chipRemove': 'Шартты алып ташлау: {label}',
  'ask.chipEdit': 'Шартты үҙгәртеү: {label}',
  'ask.assumptions': 'Фараздар', // проверить: «допущения»
  'ask.why': 'Ни өсөн тап килә',
  'ask.caveats': 'Иғтибар итегеҙ',
  'ask.quickReplies': 'Тиҙ яуаптар',
  'ask.relax': 'Нимәне үҙгәртергә мөмкин',
  'ask.showAll': 'Бөтәһен каталогта асыу: {count}',
  'ask.thinking': 'Һайлайым…',
  'ask.reset': 'Яңынан башлау',
  'ask.you': 'Һеҙ',
  'ask.assistant': 'Афиша',
  'ask.error': 'Яуап алып булманы. Ҡабатлап ҡарағыҙ.',
  'ask.stubNote':
    'Хәҙер һорауҙы нейрочелтәрһеҙ, ҡағиҙәләргә нигеҙләнгән демо-алгоритм тикшерә. Яуап форматы ЯИ-ассистенттыҡы менән бер үк.',
  'ask.cannotBuy': 'Билеттар бында һатылмай: уларҙы ойоштороусы сайтында һатып алалар.',
  'ask.langNote': 'Ассистент әлегә русса һорауҙарҙы ғына аңлай.',

  // --------------------------------------------------------------- Виджет
  'widget.title': 'Сайтығыҙ өсөн афиша виджеты',
  'widget.subtitle': 'Бер юл код, һәм биттә тере афиша барлыҡҡа килә. Саралар үҙҙәре яңыра.',
  'widget.metaTitle': 'Афиша виджеты',
  'widget.preview': 'Виджет министрлыҡ битендә ошолай күренә',
  'widget.previewNote': 'Тирәләге бит макет. Эсендәге виджет ысын: ул сараларҙы шул уҡ API-нан ала.',
  'widget.code': 'Ҡуйыу коды', // проверить: «код вставки»
  'widget.code.script': 'Скрипт',
  'widget.code.iframe': 'Iframe',
  'widget.code.scriptHint': 'Юлды афиша күренергә тейешле урынға ҡуйығыҙ.',
  'widget.code.iframeHint': 'Сайтта сит скрипттар тыйылған булһа тап килә.',
  'widget.settings': 'Көйләүҙәр',
  'widget.settings.city': 'Ҡала',
  'widget.settings.category': 'Категория',
  'widget.settings.limit': 'Нисә сара',
  'widget.settings.theme': 'Тема',
  'widget.settings.theme.light': 'Яҡты',
  'widget.settings.theme.dark': 'Ҡараңғы',
  'widget.settings.lang': 'Тел',
  'widget.heading': 'Саралар афишаһы',
  'widget.allEvents': 'Бөтә саралар',
  'widget.poweredBy': 'Башҡортостан мәҙәниәте афишаһы',
  'widget.empty': 'Бындай көйләүҙәр менән саралар әлегә юҡ.',
  'widget.features.title': 'Виджет нимә эшләй ала',
  'widget.features.live': 'Үҙе яңыра: саралар афиша API-нан килә.',
  'widget.features.filters': 'Кәрәкле ҡаланы һәм категорияны күрһәтә.',
  'widget.features.responsive': 'Телефонға ла, компьютерға ла яраҡлаша.',
  'widget.features.trust': 'Сеанс статусын, хаҡын һәм тикшерелгән ваҡытын күрһәтә.',
  'widget.mock.badge': 'Бит макеты',
  'widget.mock.org': 'Министрлыҡ сайты (макет)',
  'widget.mock.nav.news': 'Яңылыҡтар',
  'widget.mock.nav.docs': 'Документтар',
  'widget.mock.nav.activity': 'Эшмәкәрлек',
  'widget.mock.nav.contacts': 'Бәйләнеш',
  'widget.mock.title': 'Республиканың мәҙәни тормошо',
  'widget.mock.text':
    'Бында ведомство битенең ғәҙәти тексы. Виджет уға тағы бер блок булып ҡуйыла һәм киңлеккә яраҡлаша.',

  // -------------------------------------------------------- Разработчикам
  'developers.title': 'Афишаның REST API-һы',
  'developers.subtitle':
    'Сайттағы менән бер үк мәғлүмәттәр: саралар, сеанстар, белешмәләр һәм һөйләм буйынса һайлау. Асҡыс кәрәкмәй.',
  'developers.metaTitle': 'Эшләүселәргә: афишаның REST API-һы',
  'developers.baseUrl': 'Төп адрес',
  'developers.endpoints': 'Методтар',
  'developers.endpoint.events': 'Фильтрлы саралар исемлеге',
  'developers.endpoint.event': 'Бөтә сеанстары менән сара карточкаһы',
  'developers.endpoint.dictionaries': 'Белешмәләр',
  'developers.endpoint.facets': 'Ҡалалар һәм категориялар буйынса саралар һаны',
  'developers.endpoint.assistant': 'Ирекле һөйләм буйынса һайлау',
  'developers.endpoint.health': 'API эшен тикшереү',
  'developers.params': 'Параметрҙар',
  'developers.param.name': 'Параметр',
  'developers.param.type': 'Тип',
  'developers.param.description': 'Тасуирлама',
  'developers.request': 'Һорау миҫалы',
  'developers.response': 'Яуап миҫалы',
  'developers.try': 'Һорауҙы үтәү',
  'developers.trying': 'Үтәлә…',
  'developers.tryResult': 'Сервер яуабы',
  'developers.errors': 'Хаталар',
  'developers.errors.text':
    'Хата HTTP коды һәм {"error": {"code", "message"}} есеме менән килә. Хәбәр кеше өсөн яҙылған: уны үҙгәртмәйенсә күрһәтергә мөмкин.',
  'developers.cors': 'CORS асыҡ',
  'developers.cors.text':
    'API Access-Control-Allow-Origin: * башлығы менән яуап бирә. Уны теләһә ниндәй сайттан браузер аша саҡырырға мөмкин.',
  'developers.demo': 'Демо-мәғлүмәттәр',
  'developers.demo.text':
    'Хәҙер API synthetic: true билдәле демонстрацион сараларҙы бирә. Яуап форматы эш API-һындағы менән бер үк буласаҡ.',
  'developers.connect.title': 'Афишаны министрлыҡ сайтына нисек тоташтырырға',
  'developers.connect.step1': 'Иң тиҙ юл: виджетты бер юл менән ҡуйығыҙ. Код «Виджет» битендә бар.',
  'developers.connect.step2':
    'Үҙ дизайнығыҙ кәрәк: фильтрҙар менән GET /api/v1/events һорағыҙ һәм карточкаларҙы үҙ версткағыҙҙа сығарығыҙ.',
  'developers.connect.step3':
    'Һәр сараның сығанағын, сеанс статусын һәм тикшерелгән ваҡытын күрһәтегеҙ. Афишаға шулай ышаналар.',
  'developers.connect.step4':
    'Категория, ҡала һәм статус яҙыуҙарын ике телдә GET /api/v1/dictionaries аша алығыҙ.',
  'developers.docsLink': 'API-ның тулы тасуирламаһы',

  // ------------------------------------------------------------ О проекте
  'about.title': 'Проект тураһында',
  'about.subtitle':
    'Афиша Башҡортостандың мәҙәни сараларын бер урынға йыя һәм тикшереп булғанын ғына күрһәтә.',
  'about.metaTitle': 'Проект тураһында: афиша нисек ҡоролған',
  'about.collect.title': 'Саралар нисек йыйыла',
  'about.collect.text':
    'Афиша сараларҙы асыҡ сығанаҡтарҙан ала: мәҙәниәт учреждениелары сайттарынан һәм афиша сервистарынан. Тәүге яҙма үҙгәрешһеҙ һаҡлана, шуға күрә карточканың теләһә ниндәй юлының сығанағын табырға мөмкин.',
  'about.verify.title': 'Саралар нисек тикшерелә',
  'about.verify.text':
    'Һәр яҙма төп сығанаҡ менән даими сағыштырыла. Карточкала һуңғы тикшереү ваҡыты һәм сеанс статусы күренә: буласаҡ, күсерелгән йәки юҡҡа сығарылған.',
  'about.verify.unknown':
    'Сығанаҡ хаҡты, йәште йәки статусты хәбәр итмәһә, афиша «күрһәтелмәгән» тип яҙа. Билдәһеҙ хаҡ «бушлай»ға, ә билдәһеҙ статус «буласаҡ»ҡа әйләнмәй.',
  'about.dedup.title': 'Ҡабатланыуҙар нисек бөтөрөлә', // проверить: «дедупликация»
  'about.dedup.text':
    'Бер үк сараны йыш ҡына бер нисә сығанаҡ баҫтыра. Афиша ундай яҙмаларҙы бер карточкаға берләштерә һәм уның нисә сығанаҡтан йыйылғанын күрһәтә.',
  'about.dedup.step1': 'Исемдәрҙе, даталарҙы, ваҡытты һәм майҙансыҡтарҙы бер төрлө рәүешкә килтерәбеҙ.',
  'about.dedup.step2': 'Кандидаттарҙы эҙләйбеҙ: бер майҙансыҡ, яҡын ваҡыт, оҡшаш исем.',
  'about.dedup.step3':
    'Көслө тап килеүҙәр булғанда һәм ҡаршылыҡтар булмағанда ғына берләштерәбеҙ. Бәхәсле парҙар модераторға китә һәм айырым ҡала.',
  'about.dedup.step4': 'Берләштереүҙе кире ҡайтарып була: тәүге яҙмалар юйылмай, хатаны төҙәтергә мөмкин.',
  'about.dedup.principle':
    'Ике төрлө сараны яңылыш берләштереү дубль ҡалдырыуҙан насарыраҡ. Шуға күрә шикле осраҡтарҙа афиша берләштермәй.',
  'about.ai.title': 'ЯИ-һайлау нисек эшләй',
  'about.ai.text':
    'Ассистент һөйләмде шарттарға әйләндерә: көн, ҡала, бюджет, йәш. Шарттарҙы код сара юлдары буйынса тикшерә, шуға күрә йәш йәки хаҡ буйынса тап килмәгән сара һайланмаға эләкмәй. Каталогта булмаған сараларҙы ассистент атамай.',
  'about.demo.title': 'Демо-мәғлүмәттәр',
  'about.demo.text':
    'Хәҙер афиша демонстрацион мәғлүмәттәрҙә эшләй. Майҙансыҡтар ысын, ә саралар, даталар һәм хаҡтар шартлы: улар сервистың төрлө хәлдәрҙә үҙен нисек тотҡанын күрһәтә. Һәр шундай карточка «Демо-мәғлүмәттәр» тип билдәләнгән.',
  'about.demo.source':
    '«Демо-сығанаҡ» ошо бүлеккә алып килә. Эш версияһында уның урынында ойоштороусы сайтындағы сара битенә һылтанма буласаҡ.',
  'about.team.title': 'Проект ҡайҙан',
  'about.team.text':
    'Прототип «Кибер 102» хакатонында Башҡортостан Республикаһы Мәҙәниәт министрлығы бурысы буйынса эшләнгән.',

  // --------------------------------------------------------------- Подвал
  'footer.wordmark': 'АФИША-102',
  'footer.tagline': 'Республиканың бөтә мәҙәниәте. Бер афишала.',
  'footer.sections': 'Бүлектәр',
  'footer.developers': 'Эшләүселәргә',
  'footer.channels': 'Тағы ҡайҙа ҡарарға',
  'footer.language': 'Тел',
  'footer.telegram': 'Афиша Telegram-да',
  'footer.api': 'REST API',
  'footer.widget': 'Сайт өсөн виджет',
  'footer.about': 'Сараларҙы нисек тикшерәбеҙ',
  'footer.demoNote': '«Кибер 102» хакатоны прототибы. Саралар демонстрацион.',
  'footer.madeFor': 'Башҡортостан Республикаһы Мәҙәниәт министрлығы кейсы',
  'footer.top': 'Өҫкә',
};
