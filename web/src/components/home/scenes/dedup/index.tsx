'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

import { getHome } from '@/content/home';
import { listEvents } from '@/lib/api/client';
import { formatOccurrence } from '@/lib/api/format';
import type { EventListItem } from '@/lib/api/types';
import { useT } from '@/lib/i18n';

import { Scene, useSceneTimeline } from '../../scene-kit';
import { lineIndexes, useCues } from '../blueprint/lib/cues';
import { SceneLink } from '../blueprint/lib/SceneLink';
import { Chars, Words } from '../blueprint/lib/text';
import { ANGLE_FRAME, ANGLE_ORIGIN, ANGLE_SCRIM } from '../filters/frame';
import { DEDUP_T as T, def } from './def';
import { GHOST_FAN, MergeCard } from './MergeCard';
import type { MergeEvent } from './MergeCard';

/**
 * dedup: «ОДНО СОБЫТИЕ. ОДНА КАРТОЧКА.» (S9 референса).
 * От прокрутки: наезд камеры до макро, уход цвета в чёрно-белое, затемнение.
 * По времени после порога: надстрочник, титул из размытия, абзац по строкам, карточка и слияние записей.
 */

/** Событие для карточки: то, что сведено из наибольшего числа источников (демо-данные API). */
function useMergedEvent(): EventListItem | null {
  const [event, setEvent] = useState<EventListItem | null>(null);

  useEffect(() => {
    let alive = true;
    listEvents({ sort: 'popularity', page_size: 12 })
      .then((response) => {
        if (!alive) return;
        const merged = response.items.filter((item) => item.source.sources_count >= 2);
        merged.sort((a, b) => b.source.sources_count - a.source.sources_count);
        setEvent(merged[0] ?? null);
      })
      .catch((error: unknown) => {
        // Без события карточка остаётся схемой с полосами-заглушками: сцена читается и так.
        if (process.env.NODE_ENV !== 'production') console.warn('[dedup] событие для карточки не загрузилось', error);
      });
    return () => {
      alive = false;
    };
  }, []);

  return event;
}

function DedupStage() {
  const { t, lang } = useT();
  const copy = getHome(lang).dedup;
  const item = useMergedEvent();

  const occurrence = item ? (item.occurrences.find((entry) => entry.id === item.primary_occurrence_id) ?? null) : null;
  const event: MergeEvent | null = item
    ? {
        id: item.id,
        title: (lang === 'ba' ? item.title_ba : undefined) ?? item.title,
        place: item.venue.name,
        when: occurrence ? formatOccurrence(occurrence, lang) : '',
        count: item.source.sources_count,
      }
    : null;

  useSceneTimeline((tl, { q, env: e, backdrop }) => {
    const angle = backdrop?.querySelector('.dd-angle') ?? null;
    const macro = backdrop?.querySelector('.dd-macro') ?? null;
    const depth = backdrop?.querySelector('.dd-depth') ?? null;
    const d = (range: readonly [number, number]) => range[1] - range[0];
    const move = !e.reduced;

    if (angle && macro && depth) {
      // Наезд: кадр стола растёт от точки жетона и растворяется в макрокадре кромки.
      // autoAlpha везде, где слой гаснет: скрытый слой (visibility) не держит текстуру, а кадр стола
      // и макрокадр это слои больше экрана.
      tl.fromTo(
        angle,
        { scale: 1, autoAlpha: 1, transformOrigin: e.mobile ? ANGLE_ORIGIN.mobile : ANGLE_ORIGIN.desktop },
        { scale: move ? 3.4 : 1, duration: 0.16, ease: 'power2.in' },
        0,
      );
      tl.to(angle, { autoAlpha: 0, duration: 0.09 }, 0.07);
      tl.fromTo(macro, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.1 }, 0.05);
      tl.fromTo(macro, { scale: move ? 1.5 : 1 }, { scale: move ? 1.04 : 1, duration: T.zoom[1] - 0.03, ease: 'power3.out' }, 0.03);
      tl.to(macro, { scale: 1, duration: d(T.drift) }, T.drift[0]);
      // Цвет уходит равномерно, затем кадр темнеет.
      tl.fromTo(
        macro,
        { filter: 'grayscale(0) brightness(1.6) contrast(1)' },
        { filter: 'grayscale(1) brightness(2.6) contrast(1.05)', duration: d(T.gray) },
        T.gray[0],
      );
      tl.to(macro, { filter: 'grayscale(1) brightness(1.4) contrast(1.15)', duration: d(T.dark) }, T.dark[0]);
      tl.fromTo(depth, { autoAlpha: 0 }, { autoAlpha: 1, duration: d(T.dark) }, T.dark[0]);
      // Затемнение: макрокадр гаснет, следом уходит и чёрная подложка, открывая фон страницы.
      // Так стык со следующей сценой идёт без скачка, каким бы ни было её свечение. Карточка гаснет последней.
      tl.to(macro, { autoAlpha: 0, duration: 0.04 }, T.out[0]);
      const base = backdrop?.querySelector('.dd-base');
      if (base) tl.to(base, { opacity: 0, duration: 0.03 }, 0.97);
    }
    tl.to(q('.dd-box'), { autoAlpha: 0, duration: 0.03 }, 0.968);
  });

  useCues(
    (cue, { q, env: e }) => {
      const rise = e.reduced ? 0 : 135;
      const hidden = e.reduced ? 0 : 1;
      const blur = e.reduced ? 'blur(0px)' : 'blur(12px)';
      const words = q('.dd-body .w');
      const lines = lineIndexes(words.map((word) => word.parentElement ?? word));
      const wipe = e.reduced ? 'inset(0% 0% 0% 0%)' : 'inset(0% 0% 0% 100%)';

      cue({ from: T.texts[0], to: T.texts[1] }, (tl) => {
        tl.fromTo(q('.dd-eyebrow'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 }, 0);
        tl.fromTo(q('.dd-title .dd-line'), { autoAlpha: 0, filter: blur }, { autoAlpha: 1, filter: 'blur(0px)', duration: 0.5, ease: 'power2.out', stagger: 0.1 }, 0.05);
        words.forEach((word, index) => {
          tl.fromTo(word, { yPercent: rise, autoAlpha: hidden }, { yPercent: 0, autoAlpha: 1, duration: 0.5, ease: 'power3.out' }, 0.2 + lines[index] * 0.05);
        });
        tl.fromTo(q('.dd-cta'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, 0.45);
        tl.addLabel('on');
        // Выход: надстрочник и титул стираются слева направо, абзац построчно сверху вниз.
        tl.fromTo(q('.dd-eyebrow'), { clipPath: 'inset(0% 0% 0% 0%)' }, { clipPath: wipe, autoAlpha: 0, duration: 0.25, ease: 'power1.in', immediateRender: false }, 'on');
        tl.fromTo(q('.dd-title'), { clipPath: 'inset(0% 0% 0% 0%)' }, { clipPath: wipe, autoAlpha: 0.2, duration: 0.35, ease: 'power1.in', immediateRender: false }, 'on');
        words.forEach((word, index) => {
          tl.to(word, { yPercent: -rise, autoAlpha: hidden, duration: 0.28, ease: 'power2.in' }, `on+=${lines[index] * 0.04}`);
        });
        tl.to(q('.dd-cta'), { autoAlpha: 0, duration: 0.2 }, 'on');
      });

      // Карточка: шапка растёт от левого края, записи источников встают веером и сходятся в одну.
      cue({ from: T.card }, (tl) => {
        const ghosts = q('.dd-ghost');
        const dots = q('.dd-dot');
        tl.fromTo(q('.dd-card'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.15 }, 0);
        tl.fromTo(q('.dd-head'), { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.3, ease: 'power2.out' }, 0);
        tl.fromTo(q('.dd-label-a'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 }, 0.2);
        tl.fromTo(q('.dd-arc'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, 0.25);
        if (e.reduced) {
          tl.set(ghosts, { autoAlpha: 0 }, 0);
        } else {
          ghosts.forEach((ghost, index) => {
            const fan = GHOST_FAN[index] ?? GHOST_FAN[0];
            tl.fromTo(ghost, { autoAlpha: 0, xPercent: fan.x, yPercent: fan.y, rotation: fan.r }, { autoAlpha: 1, duration: 0.25, ease: 'power2.out' }, 0.18 + index * 0.08);
            tl.to(ghost, { xPercent: 0, yPercent: 0, rotation: 0, duration: 0.75, ease: 'power3.inOut' }, 0.8 + index * 0.04);
            tl.to(ghost, { autoAlpha: 0, duration: 0.2 }, 1.45);
          });
          dots.forEach((dot, index) => {
            const fan = GHOST_FAN[index] ?? GHOST_FAN[0];
            // Точки стоят на дуге по разные стороны и скатываются к середине.
            tl.fromTo(dot, { x: fan.x * 1.1, y: fan.x === 0 ? 0 : -4.75 }, { x: 0, y: 0, duration: 0.75, ease: 'power3.inOut' }, 0.8 + index * 0.04);
          });
        }
        const merged = e.reduced ? 0.35 : 1.45;
        tl.to(q('.dd-label-a'), { autoAlpha: 0, duration: 0.15 }, merged - 0.1);
        tl.fromTo(q('.dd-label-b, .dd-count'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, merged);
        tl.fromTo(q('.dd-content'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35 }, merged);
      });
    },
    [lang, event?.id ?? null],
  );

  return (
    <>
      <div className="absolute inset-x-(--gutter) top-[10%] flex flex-col items-center text-center md:top-[12.1%]">
        <p className="dd-eyebrow t-caps text-fg">{copy.eyebrow}</p>
        <h2 className="dd-title mt-[3.2vh] text-[clamp(28px,8.4vw,50px)] leading-[0.94] font-semibold tracking-[-0.035em] uppercase md:mt-[4vh] md:text-[clamp(32px,3.54vw,76px)]">
          {copy.title.map((line) => (
            <span key={line} className="dd-line block will-change-[filter,opacity]">
              <Chars text={line} mask={false} />
            </span>
          ))}
        </h2>
        <p className="dd-body mt-[2.4vh] max-w-[36ch] text-[0.9375rem] leading-[1.45] text-fg md:mt-[2.9vh] md:max-w-[27vw] md:text-[clamp(15px,1.25vw,24px)] md:leading-[1.33]">
          <Words text={copy.body} />
        </p>
      </div>

      <MergeCard
        event={event}
        sourcesLabel={copy.sourcesLabel}
        cardLabel={copy.cardLabel}
        sourcesText={event ? t('event.sources', { count: event.count }) : null}
        demoLabel={t('common.demoData')}
      />

      <div className="dd-cta absolute inset-x-0 bottom-[3.5%] flex justify-center md:bottom-[5%]">
        <SceneLink href={copy.cta.href}>{copy.cta.label}</SceneLink>
      </div>
    </>
  );
}

export default function DedupScene() {
  const { lang } = useT();
  return (
    <Scene
      def={def}
      label={getHome(lang).dedup.eyebrow}
      backdrop={
        <div className="absolute inset-0 min-h-[100lvh]">
          <div className="dd-base absolute inset-0 bg-bg" />
          <div className={`dd-angle will-change-transform ${ANGLE_FRAME}`}>
            <Image src="/images/scenes/desk-angle.webp" alt="" fill sizes="(min-width: 768px) 130vw, 300vw" className="object-cover" />
            {/* Притемнение заливкой, а не filter на картинке: чёрное 40 % это brightness(0.6). Фильтр на картинке
                шириной 300vw WebKit рисует через отдельный буфер её размера. */}
            <div className="absolute inset-0 bg-[rgb(0_0_0/0.4)]" />
            <div className={ANGLE_SCRIM} />
          </div>
          <div className="dd-macro absolute inset-0 opacity-0 will-change-[transform,filter]">
            <Image src="/images/scenes/macro.webp" alt="" fill sizes="100vw" className="object-cover" />
          </div>
          {/* Размытие по глубине заменено затемнением сверху и снизу: текст и подвал сцены читаются на любом кадре. */}
          <div className="dd-depth absolute inset-0 bg-[linear-gradient(to_bottom,oklch(0.13_0_0/0.72)_0%,oklch(0.13_0_0/0.5)_30%,oklch(0.13_0_0/0.12)_55%,oklch(0.13_0_0/0.12)_72%,oklch(0.1_0_0/0.7)_100%)] opacity-0" />
        </div>
      }
    >
      <DedupStage />
    </Scene>
  );
}
