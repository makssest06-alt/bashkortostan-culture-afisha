import Image from 'next/image';

export type DeskPictureProps = {
  /** Картинка первого экрана: предзагрузка из разметки сервера. */
  preload?: boolean;
  /** Картинка загрузилась и показана. */
  onReady?: () => void;
};

/**
 * Стол зрителя на весь экран. Картинка декоративная и временная (её заменят по тому же пути),
 * поэтому сцена на её детали не опирается: кадр чуть укрупнён и притемнён, слева, сверху и снизу
 * лежит затемнение под знак, шапку и подписи. Гасит стол сцена: opacity у .intro-desk.
 */
export function DeskPicture({ preload = false, onReady }: DeskPictureProps) {
  return (
    <div className="intro-desk absolute inset-0 min-h-[100lvh] overflow-clip bg-bg">
      <Image
        src="/images/scenes/desk.webp"
        alt=""
        fill
        sizes="100vw"
        preload={preload}
        loading={preload ? undefined : 'eager'}
        onLoad={onReady}
        className="origin-[75%_40%] scale-110 object-cover object-[68%_50%] md:object-center md:blur-[1.5px]"
      />
      {/* Затемнение заливкой вместо filter: brightness; размытие только на компьютере: на телефоне фильтры стоят памяти */}
      <div className="absolute inset-0 bg-[rgb(0_0_0/0.2)]" />
      {/* Слева под знак и карточку, сверху под шапку, снизу под подписи */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,oklch(0.162_0.006_39.3/0.5)_0%,oklch(0.162_0.006_39.3/0.38)_27%,transparent_54%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,oklch(0.162_0.006_39.3/0.5)_0%,transparent_17%,transparent_82%,oklch(0.162_0.006_39.3/0.55)_100%)]" />
    </div>
  );
}
