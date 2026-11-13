'use client';

/**
 * Форма для организаторов (п. 3, п. 6.3): заявка на событие, уточнение к карточке или вопрос.
 * Защита от спама: скрытое поле-ловушка website и ограничение частоты на сервере.
 * Ошибки показываются у своих полей и объявляются программам чтения с экрана.
 */

import { CheckCircle } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';

import { Button, Field, Input, Textarea } from '@/components/ui';
import { ApiClientError, sendFeedback } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { pick } from '@/lib/i18n/lang';
import type { Lang, LocalizedText } from '@/lib/i18n/lang';

type Kind = 'organizer_application' | 'correction' | 'question';

const l = (ru: string, ba: string): LocalizedText => ({ ru, ba });

const COPY = {
  kind: l('Что вы отправляете', 'Нимә ебәрәһегеҙ'),
  kinds: {
    organizer_application: l('Заявка на событие', 'Сараға ғариза'),
    correction: l('Уточнение к карточке', 'Карточкаға аныҡлау'),
    question: l('Вопрос', 'Һорау'),
  } satisfies Record<Kind, LocalizedText>,
  name: l('Как к вам обращаться', 'Һеҙгә нисек мөрәжәғәт итергә'),
  contact: l('Телефон или e-mail', 'Телефон йәки e-mail'),
  contactHint: l('Только чтобы ответить на это обращение', 'Был мөрәжәғәткә яуап биреү өсөн генә'),
  organization: l('Организация (если есть)', 'Ойошма (булһа)'),
  text: {
    organizer_application: l(
      'Расскажите о событии: название, дата и время, площадка, цена, ссылка на источник',
      'Сара тураһында яҙығыҙ: исеме, көнө һәм ваҡыты, майҙансығы, хаҡы, сығанаҡҡа һылтанма',
    ),
    correction: l('Что в карточке неверно и как правильно', 'Карточкала нимә дөрөҫ түгел һәм нисек дөрөҫ'),
    question: l('Ваш вопрос', 'Һорауығыҙ'),
  } satisfies Record<Kind, LocalizedText>,
  privacy: l(
    'Имя и контакт видит только модератор афиши. Мы удалим их через 90 дней.',
    'Исемде һәм контактты афиша модераторы ғына күрә. Уларҙы 90 көндән һуң юйабыҙ.',
  ),
  trap: l('Не заполняйте это поле', 'Был юлды тултырмағыҙ'),
  send: l('Отправить', 'Ебәреү'),
  sending: l('Отправляем…', 'Ебәрәбеҙ…'),
  done: l('Спасибо! Обращение передано ответственному.', 'Рәхмәт! Мөрәжәғәт яуаплы кешегә тапшырылды.'),
  doneNumber: l('Номер обращения', 'Мөрәжәғәт номеры'),
  again: l('Отправить ещё одно', 'Тағы берәүҙе ебәреү'),
  network: l('Нет связи с афишей. Проверьте интернет и отправьте ещё раз.', 'Афиша менән бәйләнеш юҡ. Интернетты тикшереп, яңынан ебәрегеҙ.'),
  failed: l('Не получилось отправить. Попробуйте ещё раз чуть позже.', 'Ебәреп булманы. Бер аҙҙан яңынан тырышып ҡарағыҙ.'),
};

export type OrganizerFormProps = {
  /** С какого вида обращения начинать: на странице события это уточнение. */
  defaultKind?: Kind;
  /** Событие, к которому относится обращение. */
  eventId?: string;
  className?: string;
};

export function OrganizerForm({ defaultKind = 'organizer_application', eventId, className }: OrganizerFormProps) {
  const { lang } = useT();
  const p = (text: LocalizedText) => pick(text, lang as Lang);
  const kindName = useId();
  const [kind, setKind] = useState<Kind>(defaultKind);
  const [values, setValues] = useState({ name: '', contact: '', organization: '', text: '', website: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const set = (key: keyof typeof values, value: string) => {
    setValues({ ...values, [key]: value });
    if (errors[key]) setErrors({ ...errors, [key]: '' });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setGeneral(null);
    setErrors({});
    try {
      const accepted = await sendFeedback({ kind, event_id: eventId ?? null, ...values, organization: values.organization || null });
      if (!accepted?.id) {
        setGeneral(p(COPY.failed));
        return;
      }
      setSent(accepted.id);
      setValues({ name: '', contact: '', organization: '', text: '', website: '' });
    } catch (error) {
      if (!(error instanceof ApiClientError) || error.code === 'network_error') {
        setGeneral(p(COPY.network));
        return;
      }
      const fields = Object.fromEntries((error.details ?? []).map((detail) => [detail.field, detail.message]));
      setErrors(fields);
      if (!Object.keys(fields).length || error.status === 429) {
        setGeneral(error.code === 'http_error' ? p(COPY.failed) : error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div role="status" className={cn('flex flex-col items-start gap-3 rounded-sm border border-status-ok/50 bg-status-ok/10 px-5 py-4', className)}>
        <p className="flex items-center gap-2 t-ui text-fg">
          <CheckCircle size={22} weight="fill" aria-hidden="true" className="text-status-ok" />
          {p(COPY.done)}
        </p>
        <p className="text-[0.9375rem] text-fg-soft">
          {p(COPY.doneNumber)}: <span className="font-mono text-fg">{sent}</span>
        </p>
        <Button variant="link" size="sm" onClick={() => setSent(null)}>
          {p(COPY.again)}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className={cn('@container relative flex max-w-2xl flex-col gap-5', className)} data-organizer-form="">
      <fieldset className="flex flex-col gap-3">
        <legend className="t-ui mb-1 text-fg">{p(COPY.kind)}</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(COPY.kinds) as Kind[]).map((value) => (
            <label
              key={value}
              className={cn(
                'flex min-h-11 cursor-pointer items-center rounded-sm border px-4 text-[0.9375rem] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-fg',
                kind === value ? 'border-fg bg-fg text-bg' : 'border-line-strong hover:bg-hover',
              )}
            >
              <input type="radio" name={kindName} value={value} checked={kind === value} onChange={() => setKind(value)} className="sr-only" />
              {p(COPY.kinds[value])}
            </label>
          ))}
        </div>
        {errors.kind ? <p className="text-[0.875rem] text-status-cancelled">{errors.kind}</p> : null}
      </fieldset>

      <div className="grid gap-5 @lg:grid-cols-2">
        <Field label={p(COPY.name)} error={errors.name}>
          <Input value={values.name} onChange={(change) => set('name', change.target.value)} autoComplete="name" maxLength={80} required aria-required="true" />
        </Field>
        <Field label={p(COPY.contact)} hint={p(COPY.contactHint)} error={errors.contact}>
          <Input value={values.contact} onChange={(change) => set('contact', change.target.value)} autoComplete="email" inputMode="email" maxLength={120} required aria-required="true" />
        </Field>
      </div>
      <Field label={p(COPY.organization)} error={errors.organization}>
        <Input value={values.organization} onChange={(change) => set('organization', change.target.value)} autoComplete="organization" maxLength={120} />
      </Field>
      <Field label={p(COPY.text[kind])} error={errors.text ?? errors.event_id}>
        <Textarea value={values.text} onChange={(change) => set('text', change.target.value)} rows={5} maxLength={2000} required aria-required="true" />
      </Field>

      {/* Ловушка для ботов: человек это поле не видит и не заполняет. */}
      <div aria-hidden="true" className="pointer-events-none absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>
          {p(COPY.trap)}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={values.website} onChange={(change) => set('website', change.target.value)} />
        </label>
      </div>

      <p className="text-[0.875rem] leading-[1.5] text-fg-soft">{p(COPY.privacy)}</p>
      {general ? (
        <p role="alert" className="rounded-sm border border-status-cancelled/60 bg-status-cancelled/10 px-4 py-3 text-[0.9375rem] text-fg">
          {general}
        </p>
      ) : null}
      <Button type="submit" disabled={busy} className="self-start">
        {busy ? p(COPY.sending) : p(COPY.send)}
      </Button>
    </form>
  );
}
