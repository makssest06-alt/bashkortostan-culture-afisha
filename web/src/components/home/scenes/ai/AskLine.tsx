'use client';

/**
 * Строка свободного запроса к ИИ: поле, пример-подсказка, кнопка, быстрые подборки и честная пометка.
 * Это наше добавление к референсу: стоит в полосе под жетоном, в колонне заголовка.
 *
 * Отправка ведёт на /ask?q=<текст>. Пустой запрос подставляет пример из подсказки.
 * Без скриптов работает как обычная форма GET.
 */

import { ArrowRight } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import type { FormEvent, Ref } from 'react';

import { Button, Chip } from '@/components/ui';
import { askHref } from '@/content/home';
import type { AiCopy } from '@/content/home';
import { gsap } from '@/lib/gsap';

export type AskLineHandle = {
  /** Напечатать пример в пустом поле (один раз за вход в сцену). instant: показать сразу целиком. */
  type: (instant?: boolean) => void;
  /** Стереть напечатанное: сцена ушла назад, при возврате пример печатается снова. */
  rewind: () => void;
  /** Снять фокус: сцена ушла с экрана. */
  blur: () => void;
};

export type AskLineProps = {
  copy: AiCopy;
  ref?: Ref<AskLineHandle>;
  /** Поле получило или потеряло фокус. */
  onFocusChange?: (focused: boolean) => void;
  className?: string;
};

/** Секунд на знак при печати примера. */
const TYPE_STEP = 0.042;

export function AskLine({ copy, ref, onFocusChange, className }: AskLineProps) {
  const router = useRouter();
  const fieldId = useId();
  const quickId = useId();
  const noteId = useId();
  const input = useRef<HTMLInputElement>(null);
  const typed = useRef<HTMLSpanElement>(null);
  const typing = useRef<gsap.core.Tween | null>(null);
  const done = useRef(false);
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);

  const { example } = copy.input;

  useImperativeHandle(
    ref,
    () => ({
      type(instant = false) {
        const node = typed.current;
        if (!node || done.current) return;
        done.current = true;
        typing.current?.kill();
        if (instant) {
          node.textContent = example;
          return;
        }
        const state = { count: 0 };
        node.textContent = '';
        typing.current = gsap.to(state, {
          count: example.length,
          duration: example.length * TYPE_STEP,
          ease: `steps(${example.length})`,
          onUpdate: () => {
            node.textContent = example.slice(0, Math.round(state.count));
          },
        });
      },
      rewind() {
        if (!done.current) return;
        done.current = false;
        typing.current?.kill();
        typing.current = null;
        if (typed.current) typed.current.textContent = '';
      },
      blur() {
        input.current?.blur();
      },
    }),
    [example],
  );

  // Сменился пример (другой язык): печатать можно заново.
  useEffect(() => {
    done.current = false;
  }, [example]);

  useEffect(() => () => void typing.current?.kill(), []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    router.push(askHref(value.trim() || example));
  };

  const showExample = value === '' && !focused;

  return (
    <div className={className}>
      <form action={copy.input.action} method="get" role="search" onSubmit={submit}>
        <label htmlFor={fieldId} className="visually-hidden">
          {copy.input.label}
        </label>
        <div className="relative flex min-h-16 items-center gap-2 rounded-sm border border-line-strong bg-bg/65 py-1.5 pr-1.5 pl-3.5 backdrop-blur-md transition-[border-color,background-color] duration-(--duration-fast) ease-out focus-within:border-fg focus-within:bg-bg/80 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-3 has-[input:focus-visible]:outline-fg md:min-h-[max(4rem,7.9vh)] md:pl-[1.3vw]">
          <div className="relative min-w-0 flex-1 self-stretch">
            <input
              ref={input}
              id={fieldId}
              name={copy.input.param}
              type="text"
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              maxLength={240}
              value={value}
              placeholder={copy.input.placeholder}
              aria-describedby={noteId}
              onChange={(event) => setValue(event.target.value)}
              onFocus={() => {
                setFocused(true);
                onFocusChange?.(true);
              }}
              onBlur={() => {
                setFocused(false);
                onFocusChange?.(false);
              }}
              className="size-full min-h-11 rounded-xs bg-transparent text-[1.0625rem] leading-[1.25] font-medium tracking-[-0.01em] text-fg outline-none placeholder:text-transparent focus:placeholder:text-fg-muted md:text-[max(1.0625rem,1.55vw)]"
            />
            {/* Пример печатается поверх пустого поля. В фокусе уступает место обычной подсказке. */}
            <span
              className="pointer-events-none absolute inset-0 flex items-center text-[1.0625rem] leading-[1.2] font-medium tracking-[-0.01em] text-fg-soft data-[off]:invisible md:text-[max(1.0625rem,1.55vw)] md:whitespace-nowrap"
              data-off={showExample ? undefined : ''}
              aria-hidden="true"
            >
              <span>
                {/* key: печать правит текст узла напрямую, при смене языка React ставит свежий узел */}
                <span key={example} ref={typed}>
                  {example}
                </span>
                <span className="ml-0.5 inline-block h-[1.05em] w-px translate-y-[0.16em] animate-pulse bg-fg" />
              </span>
            </span>
          </div>
          <Button type="submit" size="lg" className="max-md:size-13 max-md:px-0 shrink-0">
            <span className="max-md:visually-hidden">{copy.input.submit}</span>
            <ArrowRight size={20} weight="bold" aria-hidden="true" />
          </Button>
          {/* Нижняя черта поля: прорисовывается слева направо, когда строка появляется */}
          <span
            className="ai-ask-line pointer-events-none absolute inset-x-0 -bottom-px h-px origin-left bg-fg-soft"
            aria-hidden="true"
          />
        </div>
      </form>

      <div className="ai-ask-row mt-3 flex flex-wrap items-center gap-2 md:mt-[max(0.75rem,1.6vh)]">
        <p id={quickId} className="t-caps mr-1 text-fg">
          {copy.quickLabel}
        </p>
        <ul aria-labelledby={quickId} className="contents">
          {copy.quick.map((pick) => (
            <li key={pick.id}>
              <Chip href={pick.href} className="bg-bg/60 backdrop-blur-sm">
                {pick.label}
              </Chip>
            </li>
          ))}
        </ul>
      </div>

      <p
        id={noteId}
        className="ai-ask-row mt-2 w-fit rounded-xs bg-bg/55 px-1.5 py-1 text-[0.78125rem] leading-[1.4] text-fg backdrop-blur-sm max-md:-mx-1.5 md:mt-[max(0.375rem,1vh)] md:-ml-1.5 md:text-[max(0.78125rem,0.86vw)]"
      >
        {copy.note}
      </p>
    </div>
  );
}
