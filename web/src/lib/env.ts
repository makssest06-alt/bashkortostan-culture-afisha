/**
 * Режим данных. Пока NEXT_PUBLIC_DATA_MODE не равен `live`, сайт работает на демонстрационных
 * данных и обязан это показывать (компонент DemoDataNotice).
 */

export type DataMode = 'demo' | 'live';

export const DATA_MODE: DataMode = process.env.NEXT_PUBLIC_DATA_MODE === 'live' ? 'live' : 'demo';

export const IS_DEMO_DATA = DATA_MODE !== 'live';
