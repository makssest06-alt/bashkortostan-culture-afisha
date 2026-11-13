/**
 * Авторы фотографий из public/images/manifest.json и пометка о собственной графике.
 * Три состояния: список, пусто (сторонних фото нет), ошибка (манифест не прочитан). Серверный компонент.
 */

import { ArrowUpRight } from '@phosphor-icons/react/ssr';
import Image from 'next/image';

import docs from '@/components/docs/docs.module.css';
import { ROUTES } from '@/content/links';
import { cn } from '@/lib/cn';
import { pick } from '@/lib/i18n/lang';
import type { Lang } from '@/lib/i18n/lang';

import styles from './about.module.css';
import { ABOUT } from './copy';
import type { CreditImage, CreditsResult } from './manifest';

function CreditItem({ image, lang }: { image: CreditImage; lang: Lang }) {
  const copy = ABOUT.credits;
  // Подписи в манифесте только на русском: на башкирском картинка остаётся без подписи-описания,
  // имя автора и ссылка всё равно есть.
  const caption = lang === 'ru' ? image.altRu : '';
  return (
    <li className={styles.credit}>
      <Image
        src={image.src}
        alt={caption}
        width={112}
        height={112}
        sizes="56px"
        loading="lazy"
        className={styles.thumb}
      />
      <div className={styles.creditText}>
        <span className={styles.creditAuthors}>
          {image.authors.map((author) =>
            author.url ? (
              <a key={author.name + author.url} href={author.url} target="_blank" rel="noopener" className={styles.creditAuthor}>
                {author.name}
                <ArrowUpRight size={12} weight="bold" aria-hidden="true" />
                <span className="visually-hidden">
                  {' '}
                  {pick(copy.onPexels, lang)} ({pick(copy.newTab, lang)})
                </span>
              </a>
            ) : (
              <span key={author.name} className={styles.creditAuthor}>
                {author.name}
              </span>
            ),
          )}
        </span>
        {image.collage ? <span className={styles.creditNote}>{pick(copy.collage, lang)}</span> : null}
        {caption ? <span className={styles.creditNote}>{caption}</span> : null}
      </div>
    </li>
  );
}

export function Credits({ credits, lang }: { credits: CreditsResult; lang: Lang }) {
  const copy = ABOUT.credits;
  const p = (text: Parameters<typeof pick>[0]) => pick(text, lang);

  return (
    <>
      <p className={cn('t-body', docs.prose)}>{p(copy.lead)}</p>

      {!credits.ok ? (
        <div className={styles.message} role="status" data-credits="error">
          <p>{p(copy.error)}</p>
          {/* Обычная ссылка с другим адресом: браузер заново запросит страницу, и сервер перечитает манифест. */}
          <a href={`${ROUTES.about}?retry=1#credits`} className={docs.try}>
            {p(copy.retry)}
          </a>
        </div>
      ) : credits.groups.length === 0 ? (
        <p className={styles.message} data-credits="empty">
          {p(copy.empty)}
        </p>
      ) : (
        <div data-credits="list">
          {credits.groups.map((group) => {
            const count = group.images.length;
            return (
              <section key={group.id} aria-labelledby={`credits-${group.id}`} className={styles.creditGroup}>
                <div className={styles.creditHead}>
                  <h3 id={`credits-${group.id}`} className={docs.subheading}>
                    {p(copy.groups[group.id])}
                  </h3>
                  <span className={styles.creditCount}>{p(copy.count).replace('{count}', String(count))}</span>
                </div>
                <ul className={styles.creditList}>
                  {group.images.map((image) => (
                    <CreditItem key={image.src} image={image} lang={lang} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <div className={docs.subsection}>
        <h3 className={docs.subheading}>{p(copy.ownTitle)}</h3>
        <ul className={cn('t-body', docs.bullets)}>
          {copy.own.map((item) => (
            <li key={item.ru}>{p(item)}</li>
          ))}
        </ul>
      </div>
    </>
  );
}
