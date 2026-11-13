/**
 * Готовность тяжёлых ресурсов главной для экрана загрузки (Preloader).
 * Ресурс сообщает о себе один раз: markAssetReady('token'). Экран загрузки ждёт нужные ключи.
 * Модуль без React: им пользуются и холст жетона, и сцены.
 */

type Listener = () => void;

const ready = new Set<string>();
const listeners = new Set<Listener>();

/** 3D-жетон: карты рельефа посчитаны (или холст ушёл в CSS-заглушку). */
export const ASSET_TOKEN = 'token';

export function markAssetReady(key: string): void {
  if (ready.has(key)) return;
  ready.add(key);
  for (const listener of listeners) listener();
}

export function isAssetReady(key: string): boolean {
  return ready.has(key);
}

export function subscribeAssets(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
