'use client';

import { ArrowUpRight } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

import { getHome } from '@/content/home';
import type { CitiesCopy } from '@/content/home';
import { cn } from '@/lib/cn';
import { ScrollTrigger } from '@/lib/gsap';
import { useT } from '@/lib/i18n';

import { Scene, useScene, useSceneTimeline } from '../../scene-kit';
import styles from './cities.module.css';
import { CityRows, ROW_GRID } from './CityRows';
import { def, setCitiesScreens } from './def';
import { useCities } from './useCities';

/**
 * Заголовок в три строки, как в референсе: последнее слово (у нас это «АФИШЕ») стоит отдельной строкой.
 * В контенте заголовок разбит на две строки, третья получается здесь.
 */
function toThreeLines(lines: readonly string[]): string[] {
  if (lines.length !== 2) return [...lines];
  const words = lines[1].split(' ');
  if (words.length < 2) return [...lines];
  const last = words[words.length - 1];
  return [lines[0], words.slice(0, -1).join(' '), last];
}

/** Слова с номером по порядку: по нему считается задержка появления. */
function Words({ text, from }: { text: string; from: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <>
      {words.map((word, index) => (
        <span key={`${index}-${word}`} data-word style={{ '--i': from + index } as CSSProperties}>
          {word}
          {index < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  );
}

/** Подложка под жетоном: тёплый тёмный фон и свечение сверху. К стыку с popular она гаснет. */
function CitiesBackdrop() {
  return <div data-cities="backdrop" className={styles.backdrop} />;
}

function CitiesStage({ copy }: { copy: CitiesCopy }) {
  const { t } = useT();
  const { rootRef } = useScene();
  const intro = useRef<HTMLDivElement>(null);
  const cities = useCities();
  const lines = toThreeLines(copy.title);
  const lineStarts = lines.map((_, index) => lines.slice(0, index).join(' ').split(' ').filter(Boolean).length);

  // Длина секции в экранах нужна позе жетона (def.ts): секция идёт потоком, её высота зависит от вёрстки.
  // Если высота поменялась не из-за ресайза окна (ответ API, поздний шрифт), закрепления сцен ниже
  // стоят уже не там: пересчитываем их.
  useEffect(() => {
    const section = rootRef.current;
    if (!section) return;
    let width = section.offsetWidth;
    let height = section.offsetHeight;
    let timer: number | undefined;
    setCitiesScreens(height / window.innerHeight);
    const observer = new ResizeObserver(() => {
      const nextWidth = section.offsetWidth;
      const nextHeight = section.offsetHeight;
      setCitiesScreens(nextHeight / window.innerHeight);
      if (nextWidth === width && Math.abs(nextHeight - height) > 1) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => ScrollTrigger.refresh(), 120);
      }
      width = nextWidth;
      height = nextHeight;
    });
    observer.observe(section);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [rootRef]);

  // Заголовок и абзац проявляются по словам, когда первый экран секции входит в окно.
  useEffect(() => {
    const node = intro.current;
    if (!node) return;
    node.setAttribute('data-armed', '');
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          node.setAttribute('data-in', '');
          observer.disconnect();
        }
      },
      { threshold: 0.18 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      node.removeAttribute('data-armed');
      node.removeAttribute('data-in');
    };
  }, []);

  useSceneTimeline((tl, { backdrop }) => {
    const glow = backdrop?.querySelector('[data-cities="backdrop"]');
    // Подложка гаснет на последних 8 % сцены: на стыке фон без скачка переходит к фону popular.
    if (glow) tl.to(glow, { autoAlpha: 0, duration: 0.08 }, 0.92);
  });

  return (
    <div className="px-(--gutter) pb-[9svh] md:pb-[12svh]">
      {/* Первый экран: заголовок слева сверху, абзац справа, середина пуста под жетон */}
      <div ref={intro} className={cn(styles.reveal, 'relative min-h-[100svh] md:min-h-[95svh]')}>
        <h2 className="t-title max-w-[11.5ch] pt-[calc(var(--header-h)+3svh)] leading-[0.96] md:max-w-none md:pt-[13svh]">
          {lines.map((line, index) => (
            <span key={line} className="block">
              <Words text={line} from={lineStarts[index]} />{' '}
            </span>
          ))}
        </h2>
        <p className="t-lead absolute top-[73%] right-0 w-[72%] text-right [--gap:9ms] md:top-[44svh] md:right-auto md:left-[65vw] md:w-[22.5vw] md:text-left">
          <Words text={copy.body} from={6} />
        </p>
      </div>

      {/* Шапка списка: надзаголовок, всего событий, ссылка на весь каталог */}
      <div className={cn('t-caps grid grid-cols-2 items-center pb-1', ROW_GRID)}>
        <p>{copy.eyebrow}</p>
        <p data-num className="hidden justify-center md:flex">
          {/* Ячейка проезжает над жетоном: тёмная плашка держит контраст подписи */}
          {cities.total === null ? null : (
            <span className="rounded-xs bg-bg-lit/85 px-2 py-1">{t(copy.countKey, { count: cities.total })}</span>
          )}
        </p>
        <p className="flex justify-end">
          <Link href={copy.all.href} className="inline-flex min-h-11 items-center gap-1.5">
            {copy.all.label}
            <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
          </Link>
        </p>
      </div>

      <CityRows rows={cities.rows} hrefBase={copy.cityHrefBase} />

      {cities.status === 'error' ? (
        <p role="status" className="t-body mt-6 text-fg-soft">
          {t('common.error')} {t('common.errorHint')}
        </p>
      ) : null}
    </div>
  );
}

export default function CitiesScene() {
  const { lang } = useT();
  const copy = getHome(lang).cities;

  return (
    <Scene def={def} label={copy.title.join(' ')} backdrop={<CitiesBackdrop />}>
      <CitiesStage copy={copy} />
    </Scene>
  );
}
