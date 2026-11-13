'use client';

import { ArrowDown } from '@phosphor-icons/react';
import { useRef } from 'react';

import { getHome } from '@/content/home';
import type { TrustCopy } from '@/content/home';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';

import { Scene, setHeaderTone, useScene, useSceneProgress, useSceneTimeline } from '../../scene-kit';
import { def, TRUST } from './def';
import { FitWord } from './FitWord';
import { jawsPose, LOWER_CLIP, LOWER_VARS, STILL_CLIP, STILL_VARS, UPPER_CLIP, UPPER_VARS } from './jaws';
import { Lines } from './Lines';
import { ShadeRing } from './ShadeRing';
import styles from './trust.module.css';
import { TrustBlock } from './TrustBlock';

/** Кривая проявления фактуры из чёрного: 44 % пути к трети времени, 64 % к половине (кадры 323-331). */
function textureFade(t: number): number {
  return 1 - (1 - t) ** 1.45;
}

/** Подсказка прокрутки: видна, пока экран закреплён. На компьютере по центру снизу, на телефоне справа снизу. */
function ScrollHint() {
  const { t } = useT();
  return (
    <p
      data-trust="hint"
      aria-hidden="true"
      className="t-caps pointer-events-none absolute right-(--gutter) bottom-5 flex items-center gap-2 md:right-auto md:bottom-[3.3%] md:left-1/2 md:-translate-x-1/2"
    >
      <span className="order-2 inline-flex size-6 items-center justify-center rounded-full border border-current md:order-1">
        <ArrowDown size={11} weight="bold" />
      </span>
      <span className="order-1 md:order-2">{t('home.scrollHint')}</span>
    </p>
  );
}

/**
 * Закреплённый экран. Слои снизу вверх: экран со словом (тёмный, после порога кремовый), чёрная плашка
 * затемнения, две подвижные половины фактуры, неподвижная сомкнутая фактура левее шарнира, подсказка прокрутки.
 * Фактура нарисована трижды (одна неподвижная и две половины), половины живут слоями только на раскрытии.
 */
function TrustStage({ copy }: { copy: TrustCopy }) {
  const { env } = useScene();
  const root = useRef<HTMLDivElement>(null);
  const upper = useRef<HTMLDivElement>(null);
  const lower = useRef<HTMLDivElement>(null);
  const still = useRef<HTMLDivElement>(null);
  const stillInner = useRef<HTMLDivElement>(null);
  const applied = useRef({ light: false, texts: false, pose: '' });

  // Пороги и раскрытие половин: значения пишутся прямо в DOM, без состояния React.
  useSceneProgress((progress, sceneEnv) => {
    const node = root.current;
    const state = applied.current;
    if (!node) return;

    // Инверсия: тема экрана и цвет шапки меняются на пороге, сам переход играет CSS за 0,17 с.
    const light = progress >= TRUST.inversion;
    setHeaderTone(def.id, light ? 'dark' : 'light');
    if (light !== state.light) {
      state.light = light;
      if (light) node.dataset.theme = 'light';
      else delete node.dataset.theme;
    }

    const texts = progress >= TRUST.textsAt;
    if (texts !== state.texts) {
      state.texts = texts;
      node.toggleAttribute('data-texts', texts);
    }

    const top = upper.current;
    const bottom = lower.current;
    const rest = still.current;
    const restInner = stillInner.current;
    if (!top || !bottom || !rest || !restInner) return;
    // Меньше движения: половины не вращаются, фактура просто растворяется (см. таймлайн ниже).
    // Телефон: половины едут плоско и без смаза (см. jawsPose).
    const pose = jawsPose(sceneEnv.reduced ? 0 : progress, sceneEnv.mobile);
    const closed = pose.upper === 'none';
    // Отдельными слоями половины и рамка шарнира становятся только на время раскрытия: после него
    // фактура скрыта (visibility у родителя), и слои отпускаются.
    const live = !closed && progress < TRUST.openTo + 0.02;
    const key = `${pose.upper}|${live}`;
    if (key === state.pose) return;
    state.pose = key;
    const blur = pose.blur > 0.05 ? `blur(${pose.blur.toFixed(1)}px)` : '';
    const layer = live ? 'transform' : '';
    for (const jaw of [top, bottom]) {
      jaw.style.visibility = closed ? '' : 'inherit';
      jaw.style.transform = closed ? '' : jaw === top ? pose.upper : pose.lower;
      jaw.style.filter = blur;
      jaw.style.willChange = !live ? '' : sceneEnv.mobile ? 'transform' : 'transform, filter';
    }
    // Левее шарнира фактура ещё сомкнута: её показывает неподвижный слой. Обрезка по шарниру сделана
    // сдвигами (рамка влево, содержимое вправо), поэтому слой на раскрытии не перерисовывается.
    const cut = (100 - pose.hinge).toFixed(2);
    rest.style.transform = closed ? '' : `translateX(-${cut}%)`;
    restInner.style.transform = closed ? '' : `translateX(${cut}%)`;
    rest.style.willChange = layer;
    restInner.style.willChange = layer;
    rest.style.visibility = pose.hinge <= 0 ? 'hidden' : '';
  });

  useSceneTimeline((tl, { q, env: sceneEnv }) => {
    const scrim = q('[data-trust="scrim"]');
    const texture = q('[data-trust="texture"]');
    const word = q('h2');
    const hint = q('[data-trust="hint"]');

    // 1. Сцена начинается в темноте (её оставила dedup), затем фактура проявляется из чёрного.
    tl.fromTo(
      texture,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: TRUST.textureShown - TRUST.textureIn, ease: textureFade },
      TRUST.textureIn,
    );
    // 2. Экран со словом включается под уже непрозрачной фактурой.
    tl.fromTo(q('[data-trust="screen"]'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.004 }, TRUST.textureShown + 0.004);
    // 3. Раскрытие: плашка уходит, в клине видно серое слово, к концу раскрытия оно полное.
    tl.to(scrim, { autoAlpha: 0, duration: 0.08 }, TRUST.openFrom);
    tl.fromTo(word, { opacity: 0 }, { opacity: 0.45, duration: 0.05 }, TRUST.openFrom);
    tl.to(word, { opacity: 1, duration: TRUST.wordTo - TRUST.wordFrom }, TRUST.wordFrom);
    if (sceneEnv.reduced) {
      // Без вращения: фактура растворяется, пока проявляется слово.
      tl.to(texture, { autoAlpha: 0, duration: TRUST.openTo - 0.38 }, 0.38);
    } else {
      tl.to(texture, { autoAlpha: 0, duration: 0.004 }, TRUST.openTo);
    }
    // Подсказка прокрутки гаснет перед тем, как закрепление отпустит экран.
    tl.fromTo(hint, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.03 }, 0.03);
    tl.to(hint, { autoAlpha: 0, duration: 0.015 }, 0.985);
  });

  return (
    <div ref={root} data-trust="root" className={styles.root}>
      <div data-trust="screen" className={styles.screen}>
        <div className={styles.shade} aria-hidden="true">
          <div className={styles.shadeDrift}>
            <ShadeRing viewport={env.h} />
          </div>
        </div>

        <p
          className={cn(
            styles.eyebrow,
            't-caps absolute top-[14%] left-1/2 -translate-x-1/2 -translate-y-1/2 md:top-[9.2%]',
          )}
        >
          {copy.eyebrow}
        </p>

        <FitWord
          text={copy.word}
          width={env.w}
          className="absolute inset-x-(--gutter) top-0 flex h-1/2 items-end md:right-[4.5vw] md:h-[55.5%]"
          wordClassName="translate-y-[0.39em] md:translate-y-[0.122em]"
        >
          {/* Подпись стоит в единицах кегля слова: над строчными буквами, как в референсе */}
          <span className="absolute inset-x-0 bottom-[0.42em] flex justify-center leading-none md:bottom-[0.66em] md:justify-start">
            <span
              className={cn(
                styles.caption,
                'text-[clamp(14px,4.27vw,18px)] leading-[1.1] font-medium tracking-[0.01em] uppercase md:text-[clamp(13px,1.25vw,24px)]',
              )}
            >
              {copy.caption}
            </span>
          </span>
        </FitWord>

        <Lines
          text={copy.body}
          width={env.w}
          className="absolute top-[74%] left-1/2 w-[calc(100%-2*var(--gutter))] max-w-[23rem] -translate-x-1/2 text-center text-[clamp(15px,4.27vw,18px)] leading-[1.5] font-medium md:top-[64.3%] md:w-[25vw] md:max-w-none md:min-w-[18.5rem] md:text-[clamp(15px,1.25vw,22px)]"
        />
      </div>

      <div data-trust="scrim" className={styles.scrim} />

      <div data-trust="texture" className={styles.texture} aria-hidden="true">
        <div ref={upper} className={cn(styles.half, styles.jaw, styles.jawUpper)} style={UPPER_VARS}>
          <div className={styles.face} style={{ clipPath: UPPER_CLIP }} />
        </div>
        <div ref={lower} className={cn(styles.half, styles.jaw, styles.jawLower)} style={LOWER_VARS}>
          <div className={styles.face} style={{ clipPath: LOWER_CLIP }} />
        </div>
        <div ref={still} className={styles.still}>
          <div ref={stillInner} className={styles.stillInner}>
            <div className={cn(styles.half, styles.stillHalf)} style={STILL_VARS}>
              <div className={styles.face} style={{ clipPath: STILL_CLIP }} />
            </div>
          </div>
        </div>
      </div>

      <ScrollHint />
    </div>
  );
}

export default function TrustScene() {
  const { lang } = useT();
  const copy = getHome(lang).trust;

  return (
    <Scene def={def} label={copy.blockTitle} after={<TrustBlock copy={copy} />}>
      <TrustStage copy={copy} />
    </Scene>
  );
}
