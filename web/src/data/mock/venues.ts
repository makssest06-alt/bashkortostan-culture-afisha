/**
 * Площадки демонстрационного каталога.
 *
 * Названия учреждений настоящие, события на них условные (synthetic: true).
 * Улица и дом указаны только там, где адрес не вызывает сомнений; у остальных
 * площадок адреса нет, и интерфейс показывает один город. Координаты заданы
 * у трёх площадок в центре Уфы, чтобы карточка умела показывать оба случая.
 */

import type { MockVenue } from './types';

export const MOCK_VENUES: readonly MockVenue[] = [
  // Уфа
  {
    id: 'ven_ufa_opera',
    name: 'Башкирский государственный театр оперы и балета',
    city: 'ufa',
    address: 'ул. Ленина, 5/1',
    lat: 54.7222,
    lon: 55.9447,
  },
  {
    id: 'ven_ufa_gafuri',
    name: 'Башкирский академический театр драмы им. М. Гафури',
    city: 'ufa',
    address: 'ул. Заки Валиди, 34',
  },
  {
    id: 'ven_ufa_rusdram',
    name: 'Русский академический театр драмы Республики Башкортостан',
    city: 'ufa',
    address: 'проспект Октября, 79',
  },
  {
    id: 'ven_ufa_nmt',
    name: 'Национальный молодёжный театр им. М. Карима',
    city: 'ufa',
    address: null,
  },
  {
    id: 'ven_ufa_puppet',
    name: 'Башкирский государственный театр кукол',
    city: 'ufa',
    address: 'проспект Октября, 158',
  },
  {
    id: 'ven_ufa_philharmonic',
    name: 'Башкирская государственная филармония им. Х. Ахметова',
    city: 'ufa',
    address: 'ул. Гоголя, 58',
  },
  {
    id: 'ven_ufa_gkz',
    name: 'Государственный концертный зал «Башкортостан»',
    city: 'ufa',
    address: 'ул. Ленина, 50',
  },
  {
    id: 'ven_ufa_toratau',
    name: 'Конгресс-холл «Торатау»',
    city: 'ufa',
    address: 'ул. Заки Валиди, 2',
    lat: 54.7183,
    lon: 55.9258,
  },
  {
    id: 'ven_ufa_national_museum',
    name: 'Национальный музей Республики Башкортостан',
    city: 'ufa',
    address: 'ул. Советская, 14',
    lat: 54.7203,
    lon: 55.9461,
  },
  {
    id: 'ven_ufa_nesterov',
    name: 'Башкирский государственный художественный музей им. М. В. Нестерова',
    city: 'ufa',
    address: null,
  },

  // Стерлитамак
  {
    id: 'ven_str_tko',
    name: 'Стерлитамакское государственное театрально-концертное объединение',
    city: 'sterlitamak',
    address: null,
  },
  {
    id: 'ven_str_museum',
    name: 'Стерлитамакский историко-краеведческий музей',
    city: 'sterlitamak',
    address: null,
  },
  {
    id: 'ven_str_gallery',
    name: 'Стерлитамакская картинная галерея',
    city: 'sterlitamak',
    address: null,
  },

  // Салават
  {
    id: 'ven_slv_theatre',
    name: 'Салаватский государственный башкирский драматический театр',
    city: 'salavat',
    address: null,
  },
  {
    id: 'ven_slv_gallery',
    name: 'Салаватская картинная галерея',
    city: 'salavat',
    address: null,
  },

  // Нефтекамск
  {
    id: 'ven_nfk_philharmonic',
    name: 'Нефтекамская государственная филармония',
    city: 'neftekamsk',
    address: null,
  },

  // Октябрьский
  {
    id: 'ven_okt_gdk',
    name: 'Городской дом культуры',
    city: 'oktyabrsky',
    address: null,
  },
  {
    id: 'ven_okt_museum',
    name: 'Октябрьский историко-краеведческий музей им. А. П. Шокурова',
    city: 'oktyabrsky',
    address: null,
  },

  // Белорецк
  {
    id: 'ven_blr_museum',
    name: 'Белорецкий историко-краеведческий музей',
    city: 'beloretsk',
    address: null,
  },

  // Сибай
  {
    id: 'ven_sib_theatre',
    name: 'Сибайский государственный башкирский театр драмы им. А. Мубарякова',
    city: 'sibay',
    address: null,
  },

  // Кумертау
  {
    id: 'ven_kmt_museum',
    name: 'Кумертауский историко-краеведческий музей',
    city: 'kumertau',
    address: null,
  },
];
