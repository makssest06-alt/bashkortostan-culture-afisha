/**
 * Значения статусов с теми же плашками, что в каталоге (компонент StatusBadge).
 * На /developers таблица показывает и правило: какой сеанс какую плашку получает.
 */

import { StatusBadge } from '@/components/ui';
import type { DisplayStatus } from '@/lib/api/types';
import { pick } from '@/lib/i18n/lang';
import type { Lang } from '@/lib/i18n/lang';

import { DOCS, STATUS_MEANING } from './copy';
import styles from './docs.module.css';

/** Порядок проверки: сверху вниз, как в docs/api.md и в displayStatusOf(). */
const RULES: readonly { status: DisplayStatus; condition: readonly string[] | null }[] = [
  { status: 'cancelled', condition: ['status = cancelled'] },
  { status: 'postponed', condition: ['status = postponed'] },
  { status: 'unverified', condition: ['status = unknown', 'status_is_verified = false'] },
  { status: 'sold_out', condition: ['availability = sold_out'] },
  { status: 'rescheduled', condition: ['status = rescheduled'] },
  { status: 'scheduled', condition: null },
];

/** Порядок для читателя: от обычного случая к редким. */
const READER_ORDER: readonly DisplayStatus[] = ['scheduled', 'rescheduled', 'postponed', 'cancelled', 'sold_out', 'unverified'];

export function StatusTable({ lang, withRule = false }: { lang: Lang; withRule?: boolean }) {
  const columns = DOCS.statuses.columns;
  const rows = withRule
    ? RULES
    : READER_ORDER.map((status) => ({ status, condition: null as readonly string[] | null }));

  return (
    <table className={styles.table} role="table" data-status-table>
      <thead role="rowgroup">
        <tr role="row">
          {withRule ? (
            <th scope="col" role="columnheader" className="t-caps">
              {pick(columns.condition, lang)}
            </th>
          ) : null}
          <th scope="col" role="columnheader" className="t-caps">
            {pick(columns.badge, lang)}
          </th>
          <th scope="col" role="columnheader" className="t-caps">
            {pick(columns.meaning, lang)}
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((row) => (
          <tr key={row.status} role="row">
            {withRule ? (
              <td role="cell" className={styles.cellName}>
                {row.condition
                  ? row.condition.map((part, index) => (
                      <span key={part}>
                        {index > 0 ? <br /> : null}
                        <code>{part}</code>
                      </span>
                    ))
                  : pick(DOCS.statuses.otherwise, lang)}
              </td>
            ) : null}
            <td role="cell">
              <StatusBadge status={row.status} />
            </td>
            <td role="cell">{pick(STATUS_MEANING[row.status], lang)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
