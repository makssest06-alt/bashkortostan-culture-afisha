'use client';

/**
 * choose (S13): «ВЫБЕРИТЕ СВОЮ АФИШУ».
 *
 * Компьютер. Экран сцены липкий на 1,5 экрана (кадры 469-480). Доли закрепления q:
 *   0,00-0,82  знак уменьшается с 48vw до 39vw (origin по центру), с 0,36 поднимается на 18 % высоты окна;
 *   0,09-0,82  жетон уезжает вниз и наклоняется в три четверти (поза в ./pose.ts), свечение гаснет;
 *   0,27       порог: вкладки появляются по одной (по времени);
 *   0,64       порог: слева печатается абзац, справа по одному появляются пункты (по времени);
 *   0,82-1,00  удержание, затем всё уезжает вверх обычной прокруткой вместе с жетоном.
 * Ниже три колонки сравнения в обычном потоке. Вкладки это ссылки-якоря на колонки:
 * нажатие отмечает колонку и доводит прокрутку до сравнения.
 *
 * Телефон: обычный поток без закрепления. Вёрстка и раскладки: ./choose.module.css
 */

import { ArrowUpRight, Code, SealCheck, Translate } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';

import { KurayIcon, KuskarRing } from '@/components/ornament';
import { scrollToTarget } from '@/components/shell/scroll';
import { Button } from '@/components/ui';
import { getHome } from '@/content/home';
import type { ChooseColumn, ChooseColumnId, HomeLink } from '@/content/home';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';

import { Scene, useScene, useSceneProgress, useSceneTimeline } from '../../scene-kit';
import styles from './choose.module.css';
import { def } from './def';
import { EchoWordmark } from './EchoWordmark';
import { CHOOSE_PIN, chooseGeometry, choosePinProgress, chooseProgressAt, isChoosePinned } from './pose';

/** Пороги появления по времени, в долях закрепления (кадры 472 и 476 референса). */
const TABS_AT = 0.27;
const DETAILS_AT = 0.64;

/** Начальное состояние знака относительно итогового: масштаб 48 / 39 и центр на 0,479 высоты окна вместо 0,2965. */
const SIGN_SCALE_FROM = 1 / 0.81;
const SIGN_SHIFT_FROM = 0.1825;
const TABS_SHIFT_FROM = 0.19;
/** Центр кольца на полу под жетоном, в долях высоты окна. */
const FLOOR_CENTER = 0.8;

const POINT_ICONS: Icon[] = [Code, Translate, SealCheck];

function columnAnchor(id: ChooseColumnId): string {
  return `choose-${id}`;
}

function ActionLink({ link, variant }: { link: HomeLink; variant: 'primary' | 'link' }) {
  return (
    <Button href={link.href} external={link.external} variant={variant} size="md">
      {link.label}
      {link.external ? <ArrowUpRight size={15} weight="bold" aria-hidden="true" /> : null}
    </Button>
  );
}

function ChooseStage() {
  const { lang } = useT();
  const copy = getHome(lang).choose;
  const { env, rootRef } = useScene();
  const root = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const compare = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<ChooseColumnId>(copy.columns[0]?.id ?? 'site');
  const [geometry, setGeometry] = useState({ total: chooseGeometry.total, anchor: chooseGeometry.anchor });

  // Замеры секции для позы жетона: высота в экранах и место под жетон (там, где сцена идёт без закрепления).
  useEffect(() => {
    const section = rootRef.current;
    const place = slot.current;
    if (!section || !place) return;

    const measure = () => {
      const viewport = window.innerHeight;
      if (viewport <= 0) return;
      const sectionBox = section.getBoundingClientRect();
      const placeBox = place.getBoundingClientRect();
      const total = sectionBox.height / viewport;
      const anchor = (placeBox.top + placeBox.height / 2 - sectionBox.top) / viewport;
      if (Math.abs(total - chooseGeometry.total) < 0.004 && Math.abs(anchor - chooseGeometry.anchor) < 0.004) return;
      chooseGeometry.total = total;
      chooseGeometry.anchor = anchor;
      setGeometry({ total, anchor });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(section);
    return () => observer.disconnect();
  }, [rootRef, env]);

  useSceneTimeline(
    (tl, { q, env: sceneEnv, backdrop }) => {
      const floor = backdrop?.querySelector<HTMLElement>('[data-choose="floor"]') ?? null;
      const glow = backdrop?.querySelector<HTMLElement>('[data-choose="glow"]') ?? null;
      const screen = 1 / (chooseGeometry.total + 1);
      const height = sceneEnv.h;

      if (!isChoosePinned(sceneEnv)) {
        // Свечение сверху гаснет, пока сцена входит в окно: дальше фон почти чёрный.
        if (glow) tl.to(glow, { autoAlpha: 0, duration: 0.22 }, 0.08);
        // Без закрепления кольцо на полу едет вместе со страницей: его центр стоит в месте под жетон.
        if (floor) {
          tl.fromTo(
            floor,
            { autoAlpha: 1, y: (1 + chooseGeometry.anchor) * height },
            { y: (chooseGeometry.anchor - chooseGeometry.total) * height, duration: 1 },
            0,
          );
        }
        return;
      }

      const at = chooseProgressAt;
      const length = (share: number) => CHOOSE_PIN * share * screen;
      const head = q('[data-choose="head"]');
      const tabs = q('[data-choose="tabs"]');

      // Знак: масштаб почти линейно (чуть быстрее в начале), подъём линейно с резкой остановкой.
      tl.fromTo(head, { scale: SIGN_SCALE_FROM }, { scale: 1, duration: length(0.82), ease: 'power1.out' }, at(0));
      tl.fromTo(head, { y: SIGN_SHIFT_FROM * height }, { y: 0, duration: length(0.46) }, at(0.36));
      // Вкладки держатся под знаком и поднимаются вместе с ним.
      tl.fromTo(tabs, { y: TABS_SHIFT_FROM * height }, { y: 0, duration: length(0.46) }, at(0.36));
      // Свечение гаснет, фон становится почти чёрным (доли закрепления 0,10-0,60).
      if (glow) tl.to(glow, { autoAlpha: 0, duration: length(0.5) }, at(0.1));

      if (floor) {
        // Кольцо проявляется, когда жетон почти лёг в три четверти (наклон в pose.ts идёт на 0,2-0,62):
        // раньше кольцо в наклоне стояло под жетоном анфас, и они не совпадали.
        tl.fromTo(
          floor,
          { autoAlpha: 0, y: FLOOR_CENTER * height, scale: 0.94 },
          { autoAlpha: 1, scale: 1, duration: length(0.3), ease: 'power2.out' },
          at(0.5),
        );
        // Красное пятно между вкладками и жетоном проявляется к удержанию (кадры 477-480).
        const haze = floor.querySelector<HTMLElement>('[data-choose="haze"]');
        if (haze) tl.fromTo(haze, { autoAlpha: 0 }, { autoAlpha: 1, duration: length(0.22) }, at(0.6));
        // После закрепления кольцо уезжает вверх вместе со страницей и гаснет.
        const leave = Math.min(screen, 1 - at(1));
        if (leave > 0) {
          tl.to(floor, { y: (FLOOR_CENTER - leave / screen) * height, duration: leave }, at(1));
          tl.to(floor, { autoAlpha: 0, duration: leave * 0.6 }, at(1) + leave * 0.3);
        }
      }
    },
    [geometry.total, geometry.anchor],
  );

  useSceneProgress((progress, sceneEnv) => {
    const node = root.current;
    if (!node) return;
    const live = isChoosePinned(sceneEnv);
    const share = choosePinProgress(progress);
    node.toggleAttribute('data-live', live);
    node.toggleAttribute('data-tabs', !live || share >= TABS_AT);
    node.toggleAttribute('data-details', !live || share >= DETAILS_AT);
  });

  const selectColumn = (id: ChooseColumnId) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    setActive(id);
    const column = document.getElementById(columnAnchor(id));
    const block = compare.current;
    if (!column || !block) return;
    // Компьютер: колонки стоят в ряд, показываем весь блок сравнения. Телефон: колонки стопкой, едем к нужной.
    if (env.mobile) {
      const header = Math.min(84, Math.max(60, window.innerHeight * 0.09));
      scrollToTarget(column.getBoundingClientRect().top + window.scrollY - header - 8);
    } else {
      scrollToTarget(block.getBoundingClientRect().top + window.scrollY);
    }
    column.focus({ preventScroll: true });
  };

  return (
    <div ref={root} className={styles.root} data-tabs="" data-details="">
      <div className={styles.pinTrack}>
        <div className={styles.stage}>
          <div className={styles.headPos}>
            <h2 data-choose="head" className={styles.head} aria-label={copy.title}>
              <span className={styles.eyebrow} aria-hidden="true">
                {copy.eyebrow}
              </span>
              <span aria-hidden="true">
                <EchoWordmark text={copy.word} ratioHint={4.02} className={styles.sign} />
              </span>
            </h2>
          </div>

          <nav className={styles.tabsPos} aria-label={copy.title}>
            <ul data-choose="tabs" className={styles.tabs}>
              {copy.columns.map((column, index) => (
                <li key={column.id} className="contents">
                  <a
                    href={`#${columnAnchor(column.id)}`}
                    className={cn(styles.tab, 't-caps')}
                    style={{ ['--i' as string]: index }}
                    aria-current={column.id === active ? 'true' : undefined}
                    onClick={selectColumn(column.id)}
                  >
                    {column.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div ref={slot} className={styles.slot} aria-hidden="true" />

          <div className={styles.aside}>
            <span className={styles.asideName}>{copy.aside.name}</span>
            <p className={styles.asideText}>{copy.aside.text}</p>
          </div>

          <ul className={styles.points}>
            {copy.points.map((point, index) => {
              const PointIcon = POINT_ICONS[index % POINT_ICONS.length];
              return (
                <li key={point} className={styles.point} style={{ ['--i' as string]: index }}>
                  <PointIcon size={20} aria-hidden="true" className={styles.pointIcon} />
                  {point}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div ref={compare} className={styles.compare}>
        <div className={styles.cols}>
          <span className={styles.band} style={{ gridRow: 3 }} aria-hidden="true" />
          <span className={styles.band} style={{ gridRow: 5 }} aria-hidden="true" />
          {copy.columns.map((column, index) => (
            <CompareColumn key={column.id} column={column} index={index} active={column.id === active} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CompareColumn({ column, index, active }: { column: ChooseColumn; index: number; active: boolean }) {
  return (
    <article
      id={columnAnchor(column.id)}
      tabIndex={-1}
      className={styles.col}
      style={{ ['--col' as string]: index + 1 }}
      data-active={active ? '' : undefined}
      aria-labelledby={`${columnAnchor(column.id)}-name`}
    >
      <div className={styles.colHead}>
        <KurayIcon size={22} ring={false} className={styles.colMark} />
        <h3 id={`${columnAnchor(column.id)}-name`} className={styles.colName}>
          {column.name}
        </h3>
      </div>
      <p className={cn(styles.colTag, 't-body')}>{column.tagline}</p>

      {column.features.map((feature) => (
        <p key={feature.label} className={styles.feat}>
          <span className={cn(styles.featLabel, 't-caps')}>{feature.label}</span>
          <span className={cn(styles.featValue, 't-ui')}>{feature.value}</span>
        </p>
      ))}

      <div className={styles.colActions}>
        <ActionLink link={column.cta} variant="primary" />
        {column.secondary ? <ActionLink link={column.secondary} variant="link" /> : null}
        {column.note ? <p className={styles.colNote}>{column.note}</p> : null}
      </div>
    </article>
  );
}

/** Подложка под жетоном: свечение сверху (как у popular), кольцо кускара «на полу» и мягкое медное пятно. */
function ChooseFloor() {
  return (
    <>
      <div data-choose="glow" className={styles.glow} />
      <div data-choose="floor" className={styles.floor}>
        <span data-choose="haze" className={styles.haze} />
        <span className={styles.floorGlow} />
        <KuskarRing size="100%" className={styles.floorRing} />
      </div>
    </>
  );
}

export default function ChooseScene() {
  const { lang } = useT();
  return (
    <Scene def={def} label={getHome(lang).choose.title} backdrop={<ChooseFloor />}>
      <ChooseStage />
    </Scene>
  );
}
