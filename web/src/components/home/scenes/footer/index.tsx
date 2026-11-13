'use client';

/**
 * footer (S14 и подвал главной). Обычный поток, жетона нет.
 *
 * Верх по кадрам 487-491: надзаголовок, знак «АФИША-102» с эхо-шлейфом (въезжает обычной прокруткой),
 * три кнопки-ссылки, абзац колонкой по центру (проявляется при входе в окно).
 * Ниже подвал по живому оригиналу (live.md, раздел 6) и нашим нуждам: разделитель кускар, девиз,
 * блок Telegram-бота, колонки ссылок на все страницы, РУС/БАШ, авторство фотографий, пометка о демо-данных.
 * Общий SiteFooter на главной не показывается: этот подвал самодостаточен.
 */

import { ArrowUp, ArrowUpRight, BracketsCurly, TelegramLogo, Ticket } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { KurayIcon, KuskarBorder } from '@/components/ornament';
import { LangSwitch } from '@/components/shell/LangSwitch';
import { scrollToTarget } from '@/components/shell/scroll';
import { getHome } from '@/content/home';
import type { HomeLink } from '@/content/home';
import { ROUTES, TELEGRAM_BOT_IS_SET } from '@/content/links';
import { cn } from '@/lib/cn';
import { IS_DEMO_DATA } from '@/lib/env';
import { useT } from '@/lib/i18n';

import { Scene } from '../../scene-kit';
import { EchoWordmark } from '../choose/EchoWordmark';
import { def } from './def';
import styles from './footer.module.css';

const PILL_ICONS: Icon[] = [Ticket, TelegramLogo, BracketsCurly];

/** Ссылка подвала: внутренняя через next/link, внешняя в новой вкладке. */
type FooterLinkProps = { link: HomeLink; className: string; children?: ReactNode };

function FooterLink({ link, className, children }: FooterLinkProps) {
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className={className}>
        {children ?? link.label}
        <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
      </a>
    );
  }
  return (
    <Link href={link.href} className={className}>
      {children ?? link.label}
    </Link>
  );
}

function FooterStage() {
  const { t, lang } = useT();
  const home = getHome(lang);
  const copy = home.footer;
  const root = useRef<HTMLDivElement>(null);

  // Блоки с data-reveal проявляются, когда входят в окно (по времени, один раз).
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    node.setAttribute('data-live', '');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute('data-in', '');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    node.querySelectorAll('[data-reveal]').forEach((target) => observer.observe(target));
    return () => {
      observer.disconnect();
      node.removeAttribute('data-live');
    };
  }, [lang]);

  const [aboutBefore, ...aboutRest] = copy.about.split(copy.highlight);
  const motto = (t('footer.tagline').match(/[^.]+\.?/g) ?? []).map((part) => part.trim()).filter(Boolean);
  // Группа с внешней ссылкой (Telegram) идёт отдельным блоком в пунктирной рамке, остальные колонками.
  const channels = copy.groups.find((group) => group.links.some((link) => link.external));
  const groups = copy.groups.filter((group) => group !== channels);
  const botLink = channels?.links.find((link) => link.external);
  const botNote = TELEGRAM_BOT_IS_SET ? undefined : home.choose.columns.find((column) => column.id === 'bot')?.note;

  return (
    <div ref={root} className={styles.root}>
      <div className={styles.top}>
        <p className={cn(styles.eyebrow, 't-caps')}>{copy.eyebrow}</p>
        <h2 className={styles.signWrap}>
          <EchoWordmark text={copy.wordmark} ratioHint={6.09} className={styles.sign} />
        </h2>

        <ul className={styles.buttons} data-reveal="">
          {copy.buttons.map((button, index) => {
            const PillIcon = PILL_ICONS[index % PILL_ICONS.length];
            return (
              <li key={button.href}>
                <FooterLink link={button} className={cn(styles.pill, 't-caps')}>
                  <PillIcon size={16} weight="fill" aria-hidden="true" />
                  {button.label}
                </FooterLink>
              </li>
            );
          })}
        </ul>

        <p className={cn(styles.about, 't-lead')} data-reveal="" style={{ ['--i' as string]: 1 }}>
          {aboutRest.length > 0 ? (
            <>
              {aboutBefore}
              <span className={styles.highlight}>{copy.highlight}</span>
              {aboutRest.join(copy.highlight)}
            </>
          ) : (
            copy.about
          )}
        </p>
      </div>

      <KuskarBorder variant="row" height={22} className={styles.divider} />

      <div className={styles.statement}>
        <KurayIcon size={84} className={styles.mark} />
        <p className={cn(styles.motto, 't-title')} data-reveal="">
          {motto.map((line) => (
            <span key={line} className={styles.mottoLine}>
              {line}
            </span>
          ))}
        </p>
      </div>

      <div className={styles.grid}>
        {channels && botLink ? (
          <div className={styles.bot} data-reveal="">
            <h3 className={cn(styles.botTitle, 't-caps')}>{channels.title}</h3>
            <p className={styles.botLink}>{botLink.label}</p>
            {botNote ? <p className={styles.botNote}>{botNote}</p> : null}
            <a href={botLink.href} target="_blank" rel="noopener noreferrer" className={cn(styles.botButton, 't-caps')}>
              <TelegramLogo size={16} weight="fill" aria-hidden="true" />
              {t('common.telegramOpen')}
              <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
            </a>
          </div>
        ) : null}

        {groups.map((group, index) => (
          <nav
            key={group.title}
            className={styles.group}
            aria-label={group.title}
            data-reveal=""
            style={{ ['--i' as string]: index + 1 }}
          >
            <h3 className={cn(styles.groupTitle, 't-caps')}>{group.title}</h3>
            <ul className={styles.links}>
              {group.links.map((link) => (
                <li key={link.href}>
                  <FooterLink link={link} className={styles.link} />
                </li>
              ))}
            </ul>
          </nav>
        ))}

        <div className={styles.lang} data-reveal="" style={{ ['--i' as string]: groups.length + 1 }}>
          <h3 className={cn(styles.groupTitle, 't-caps')}>{copy.lang.label}</h3>
          <LangSwitch size="large" />
        </div>
      </div>

      <div className={styles.bottom}>
        <div className={cn(styles.legal, 't-caps')}>
          <Link href={`${ROUTES.about}#credits`} className={styles.legalLink}>
            {copy.credits}
          </Link>
          <button type="button" className={cn(styles.legalLink, 't-caps')} onClick={() => scrollToTarget(0)}>
            {t('footer.top')}
            <ArrowUp size={14} weight="bold" aria-hidden="true" />
          </button>
        </div>

        <p className={cn(styles.note, 't-caps')}>
          {IS_DEMO_DATA ? (
            <>
              <Link href={ROUTES.aboutDemo}>{copy.demoNote}</Link>{' '}
            </>
          ) : null}
          {copy.madeFor}
        </p>
      </div>
    </div>
  );
}

export default function FooterScene() {
  const { t } = useT();
  return (
    <Scene def={def} label={t('common.brandFull')}>
      <FooterStage />
    </Scene>
  );
}
