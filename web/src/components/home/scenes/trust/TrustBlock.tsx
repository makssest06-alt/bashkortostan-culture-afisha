'use client';

import { ClockCounterClockwise, NotEquals } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { KuskarBorder } from '@/components/ornament';
import { Button, PriceTag, StatusBadge } from '@/components/ui';
import type { TrustCard, TrustCardId, TrustCopy } from '@/content/home';
import { formatAgo } from '@/lib/api/format';
import type { DisplayStatus } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { ScrollTrigger } from '@/lib/gsap';
import { useT } from '@/lib/i18n';

import styles from './trust.module.css';
import { useTrustFacts } from './useTrustFacts';
import type { TrustFacts } from './useTrustFacts';

/** Порядок плашек статуса и их сдвиг в стопке, % ширины стопки (в референсе плашки лежат вразнобой). */
const STATUS_STACK: readonly (readonly [DisplayStatus, number])[] = [
  ['scheduled', -5],
  ['rescheduled', 9],
  ['postponed', -8],
  ['cancelled', 5],
  ['sold_out', -3],
  ['unverified', 7],
];

/** Место карточки в сетке на компьютере: колонки 22,6 / 34,2 / 36,7 % как в референсе. */
const PLACE: Record<TrustCardId, string> = {
  source: 'md:col-start-1 md:row-span-2',
  status: 'md:col-start-2 md:row-span-2',
  unknown: 'md:col-start-3 md:row-start-1',
  checked: 'md:col-start-3 md:row-start-2',
};

const TITLE_LARGE = 'text-[clamp(22px,6.9vw,30px)] md:text-[clamp(20px,2.2vw,40px)]';
const TITLE = 'text-[clamp(17px,4.6vw,20px)] md:text-[clamp(16px,1.6vw,28px)]';

function step(index: number): CSSProperties {
  return { '--step': index } as CSSProperties;
}

/** Карточка: содержимое проявляется, когда она входит в экран. Без скриптов карточка просто видна. */
function Card({ id, className, children }: { id: TrustCardId; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.setAttribute('data-armed', '');
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          node.setAttribute('data-in', '');
          observer.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      node.removeAttribute('data-armed');
      node.removeAttribute('data-in');
    };
  }, []);

  return (
    <li
      ref={ref}
      data-card={id}
      className={cn(
        styles.card,
        'relative flex flex-col overflow-hidden rounded-md p-5 md:p-[clamp(16px,1.3vw,26px)]',
        PLACE[id],
        className,
      )}
    >
      {children}
    </li>
  );
}

function CardText({ card, large = false, spread = false }: { card: TrustCard; large?: boolean; spread?: boolean }) {
  return (
    <>
      <h4
        data-reveal
        style={step(0)}
        className={cn('max-w-[16ch] leading-[1.02] font-semibold tracking-[-0.025em] uppercase', large ? TITLE_LARGE : TITLE)}
      >
        {card.title}
      </h4>
      <p
        data-reveal
        style={step(1)}
        className={cn(
          'mt-4 max-w-[34ch] text-[0.9375rem] leading-[1.42] md:text-[clamp(14px,1.08vw,18px)]',
          // В высокой карточке абзац стоит у нижнего края, как в референсе.
          spread && 'md:mt-auto md:pt-6',
        )}
      >
        {card.text}
      </p>
    </>
  );
}

function CardLink({ card, index }: { card: TrustCard; index: number }) {
  if (!card.link) return null;
  return (
    <p data-reveal style={step(index)} className="mt-2">
      <Button variant="link" size="sm" href={card.link.href} external={card.link.external}>
        {card.link.label}
      </Button>
    </p>
  );
}

/**
 * Гигантское число событий в акцентной карточке. Место под него занято всегда: когда API отвечает,
 * высота карточки (и всей страницы ниже) не меняется.
 */
function BigNumber({ facts }: { facts: TrustFacts | null }) {
  const { t } = useT();
  const digits = facts ? String(facts.total) : '';
  const phrase = facts ? t('events.count', { count: facts.total }) : '';
  const word = phrase.replace(digits, '').trim();
  // Двузначное число режется краем карточки, как «25» в референсе; длинное ужимается, чтобы читалось.
  const scale = digits.length <= 2 ? 1 : 2.1 / digits.length;

  return (
    <p data-reveal style={step(3)} className="pointer-events-none mt-auto pt-6 select-none">
      {facts ? <span className="visually-hidden">{phrase}</span> : null}
      <span aria-hidden="true" className="t-caps block min-h-[1.25em] opacity-80">
        {word}
      </span>
      <span
        aria-hidden="true"
        data-num
        className={cn(
          styles.accentNumber,
          '-mb-[0.3em] -ml-[0.05em] block h-[0.8em] leading-[0.8] font-medium tracking-[-0.06em] whitespace-nowrap',
          'text-[calc(92vw*var(--num-scale))] md:text-[calc(28.4vw*var(--num-scale))]',
        )}
        style={{ '--num-scale': scale } as CSSProperties}
      >
        {digits}
      </span>
    </p>
  );
}

function StatusStack() {
  return (
    <div
      aria-hidden="true"
      data-reveal
      style={step(2)}
      className="mt-6 flex flex-col items-center gap-2 md:absolute md:top-[14%] md:right-[7%] md:mt-0 md:w-[42%] md:gap-[1.1vh]"
    >
      {STATUS_STACK.map(([status, shift]) => (
        <span
          key={status}
          className={cn(styles.plaque, 'inline-flex rounded-sm px-2.5 py-2')}
          style={{ transform: `translateX(${shift}%)` }}
        >
          <StatusBadge status={status} />
        </span>
      ))}
    </div>
  );
}

function PricePair() {
  return (
    <p
      aria-hidden="true"
      data-reveal
      style={step(2)}
      className="t-lead mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-5"
    >
      <PriceTag price={{ kind: 'unknown' }} />
      <NotEquals size={22} weight="bold" className="shrink-0" />
      <PriceTag price={{ kind: 'free' }} />
    </p>
  );
}

/** Настоящая отметка о проверке у самого популярного события каталога. Место под неё занято всегда. */
function CheckedSample({ facts }: { facts: TrustFacts | null }) {
  const { t, lang } = useT();
  const sample = facts?.sample ?? null;
  const title = sample ? (lang === 'ba' && sample.titleBa ? sample.titleBa : sample.title) : '';

  return (
    <p data-reveal style={step(2)} className="mt-auto flex min-h-[3.5rem] items-start gap-2.5 pt-4">
      {facts && sample ? (
        <>
          <ClockCounterClockwise size={20} weight="bold" aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="min-w-0">
            <span className="t-ui block">
              {t('event.checked', { ago: formatAgo(sample.checkedAt, new Date(facts.loadedAt), lang) })}
            </span>
            <span className="mt-1 block truncate text-[0.8125rem] leading-[1.3] text-fg-soft">{title}</span>
          </span>
        </>
      ) : null}
    </p>
  );
}

/**
 * Светлый блок доверия в обычном потоке после закреплённого экрана: заголовок и четыре карточки.
 * Сетка на компьютере повторяет три колонки референса (22,6 / 34,2 / 36,7 % ширины, высота 62 % экрана),
 * третья колонка делится на две карточки. На телефоне карточки идут столбцом.
 */
export function TrustBlock({ copy }: { copy: TrustCopy }) {
  const facts = useTrustFacts();
  const block = useRef<HTMLDivElement>(null);

  // Высота блока поменялась не из-за ресайза окна (поздний шрифт, длинный перевод): закрепления сцен ниже
  // стоят уже не там, пересчитываем их.
  useEffect(() => {
    const node = block.current;
    if (!node) return;
    let width = node.offsetWidth;
    let height = node.offsetHeight;
    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      const nextWidth = node.offsetWidth;
      const nextHeight = node.offsetHeight;
      if (nextWidth === width && Math.abs(nextHeight - height) > 1) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => ScrollTrigger.refresh(), 120);
      }
      width = nextWidth;
      height = nextHeight;
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  const byId = new Map(copy.cards.map((card) => [card.id, card]));
  const source = byId.get('source');
  const status = byId.get('status');
  const unknown = byId.get('unknown');
  const checked = byId.get('checked');

  return (
    <div ref={block} data-theme="light" className="bg-bg px-(--gutter) pb-[10vh] md:pb-[12vh]">
      <KuskarBorder variant="row" height={16} className="opacity-30" />
      <h3 className="t-subtitle max-w-[20ch] pt-[5vh] md:max-w-none md:pt-[3vh]">{copy.blockTitle}</h3>

      <ul className="mt-[4vh] grid gap-3 md:mt-[3vh] md:h-[62vh] md:min-h-[540px] md:grid-cols-[22.6fr_34.2fr_36.7fr] md:grid-rows-2 md:gap-[1vw]">
        {source ? (
          <Card id="source" className={cn(styles.accent, 'min-h-[118vw] md:min-h-0')}>
            <CardText card={source} large />
            <CardLink card={source} index={2} />
            <BigNumber facts={facts} />
          </Card>
        ) : null}

        {status ? (
          <Card id="status" className="bg-surface">
            <div className="flex min-h-0 flex-col md:h-full md:max-w-[50%]">
              <CardText card={status} spread />
            </div>
            <StatusStack />
          </Card>
        ) : null}

        {unknown ? (
          <Card id="unknown" className="bg-surface">
            <CardText card={unknown} />
            <PricePair />
          </Card>
        ) : null}

        {checked ? (
          <Card id="checked" className="bg-surface">
            <CardText card={checked} />
            <CardLink card={checked} index={2} />
            <CheckedSample facts={facts} />
          </Card>
        ) : null}
      </ul>
    </div>
  );
}
