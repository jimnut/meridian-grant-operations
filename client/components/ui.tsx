import {
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { CircleAlert, Inbox, LoaderCircle, TriangleAlert } from 'lucide-react';

import type { Tone } from '../lib/format';

/* -------------------------------------------------------------- badges */

export function Badge({
  tone = 'neutral',
  children,
  icon,
  size,
}: {
  tone?: Tone;
  children: ReactNode;
  icon?: ReactNode;
  size?: 'lg';
}) {
  const toneClass = tone === 'neutral' ? '' : ` badge--${tone}`;
  return (
    <span className={`badge${toneClass}${size === 'lg' ? ' badge--lg' : ''}`}>
      {icon}
      {children}
    </span>
  );
}

/**
 * Status is never conveyed by colour alone: every pill carries its label, and
 * risk-bearing pills also carry a shape (dot) plus text.
 */
export function StatusPill({ tone = 'neutral', label, size }: { tone?: Tone; label: string; size?: 'lg' }) {
  return (
    <Badge tone={tone} size={size} icon={<span className="badge__dot" aria-hidden="true" />}>
      {label}
    </Badge>
  );
}

/* ---------------------------------------------------------------- card */

export function Card({
  title,
  subtitle,
  actions,
  children,
  footer,
  flush,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section className={`card${flush ? ' card--flush' : ''}`} aria-labelledby={id}>
      {(title || actions) && (
        <header className="card__header">
          <div className="card__header-text">
            {title && (
              <h2 className="card__title" id={id}>
                {title}
              </h2>
            )}
            {subtitle && <p className="card__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      {flush ? children : <div className={bodyClassName ?? 'card__body'}>{children}</div>}
      {footer && <footer className="card__footer">{footer}</footer>}
    </section>
  );
}

/* ----------------------------------------------------------- stat tile */

export function StatTile({
  label,
  value,
  helper,
  tone = 'neutral',
  icon,
  small,
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  tone?: 'neutral' | 'positive' | 'attention' | 'risk';
  icon?: ReactNode;
  small?: boolean;
}) {
  return (
    <div className={`stat${tone === 'neutral' ? '' : ` stat--${tone}`}`}>
      <div className="stat__label">
        {icon}
        {label}
      </div>
      <div className={`stat__value${small ? ' stat__value--sm' : ''} numeric`}>{value}</div>
      {helper && <div className="stat__helper">{helper}</div>}
    </div>
  );
}

/* -------------------------------------------------------------- states */

export function LoadingState({ label = 'Loading…', compact }: { label?: string; compact?: boolean }) {
  return (
    <div className={`state${compact ? ' state--compact' : ''}`} role="status" aria-live="polite">
      <LoaderCircle className="spin" size={22} aria-hidden="true" />
      <p className="state__text">{label}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  compact,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`state${compact ? ' state--compact' : ''}`}>
      <div className="state__icon" aria-hidden="true">
        {icon ?? <Inbox size={20} />}
      </div>
      <p className="state__title">{title}</p>
      {description && <p className="state__text">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'We could not load this',
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state state--error" role="alert">
      <div className="state__icon" aria-hidden="true">
        <TriangleAlert size={20} />
      </div>
      <p className="state__title">{title}</p>
      <p className="state__text">{description ?? 'Please try again. If it keeps happening, reload the page.'}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Banner({
  tone = 'info',
  icon,
  children,
  actions,
}: {
  tone?: 'info' | 'amber' | 'risk' | 'neutral';
  icon?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={`banner${tone === 'neutral' ? '' : ` banner--${tone}`}`}>
      <span className="banner__icon" aria-hidden="true">
        {icon ?? <CircleAlert size={17} />}
      </span>
      <div style={{ flex: 1 }}>{children}</div>
      {actions}
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number | string; width?: number | string }) {
  return <div className="skeleton" style={{ height, width }} aria-hidden="true" />;
}

/* -------------------------------------------------------------- fields */

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
  span?: boolean;
}

export function Field({ label, htmlFor, hint, error, optional, children, span }: FieldProps) {
  // The hint and error are rendered right here, so the association is injected
  // here too: every call site gets aria-describedby/aria-errormessage for free,
  // and a screen reader hears the reason, not just "invalid".
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;
  let control = children;
  if (describedBy && isValidElement(children)) {
    const child = children as ReactElement<Record<string, unknown>>;
    const existing = child.props['aria-describedby'] as string | undefined;
    control = cloneElement(child, {
      'aria-describedby': existing ? `${existing} ${describedBy}` : describedBy,
      ...(error ? { 'aria-errormessage': `${htmlFor}-error`, 'aria-invalid': true } : {}),
    });
  }

  return (
    <div className={`field${span ? ' field--span' : ''}`}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {optional && <span className="field__optional">Optional</span>}
      </label>
      {control}
      {hint && !error && (
        <p className="field__hint" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={`${htmlFor}-error`}>
          <CircleAlert size={14} aria-hidden="true" style={{ marginTop: 2, flex: 'none' }} />
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * After a failed submit, move keyboard focus to the first control the form
 * marked invalid. Runs after render, so the aria-invalid attributes the errors
 * produced are already in the DOM. Forms are modal one-at-a-time surfaces here,
 * so a document-scoped query is unambiguous.
 */
export function useFocusFirstInvalid(errors: Record<string, string>): void {
  const errorCount = Object.keys(errors).length;
  useEffect(() => {
    if (errorCount === 0) return;
    document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errorCount, errors]);
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ invalid, className, ...props }, ref) {
    return <input ref={ref} className={`input ${className ?? ''}`} aria-invalid={invalid || undefined} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ invalid, className, ...props }, ref) {
  return <textarea ref={ref} className={`textarea ${className ?? ''}`} aria-invalid={invalid || undefined} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ invalid, className, children, ...props }, ref) {
    return (
      <select ref={ref} className={`select ${className ?? ''}`} aria-invalid={invalid || undefined} {...props}>
        {children}
      </select>
    );
  },
);

/** Money input with a currency affordance; the value stays a plain string. */
export function MoneyInput({
  id,
  value,
  onChange,
  symbol = '$',
  invalid,
  ...rest
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  symbol?: string;
  invalid?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'>) {
  return (
    <div className="input-prefix">
      <span className="input-prefix__symbol" aria-hidden="true">
        {symbol}
      </span>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        invalid={invalid}
        onChange={(event) => onChange(event.target.value)}
        {...rest}
      />
    </div>
  );
}

/* --------------------------------------------------------------- misc */

export function Progress({
  value,
  tone = 'accent',
  markerAt,
  label,
  tall,
}: {
  value: number;
  tone?: 'accent' | 'amber' | 'risk';
  markerAt?: number | null;
  label: string;
  tall?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={`progress${tall ? ' progress--tall' : ''}`}
      role="img"
      aria-label={`${label}: ${clamped}%${markerAt != null ? `, expected ${Math.round(markerAt)}%` : ''}`}
    >
      <div className={`progress__bar${tone === 'accent' ? '' : ` progress__bar--${tone}`}`} style={{ width: `${clamped}%` }} />
      {markerAt != null && (
        <span className="progress__marker" style={{ left: `calc(${Math.max(0, Math.min(100, markerAt))}% - 1px)` }} />
      )}
    </div>
  );
}

export function DefinitionList({ items }: { items: Array<{ term: string; value: ReactNode }> }) {
  return (
    <dl className="definition-list">
      {items.map((item) => (
        <div key={item.term} style={{ display: 'contents' }}>
          <dt>{item.term}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Avatar({ name, large, nav }: { name: string | null | undefined; large?: boolean; nav?: boolean }) {
  const text = initialsOf(name);
  return (
    <span
      className={`avatar${large ? ' avatar--lg' : ''}${nav ? ' avatar--nav' : ''}`}
      aria-hidden="true"
      title={name ?? undefined}
    >
      {text}
    </span>
  );
}

function initialsOf(name: string | null | undefined): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/** Accessible tab list driven by a controlled value. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  idPrefix,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (id: T) => void;
  idPrefix?: string;
}) {
  const generated = useId();
  const prefix = idPrefix ?? generated;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.id === value);
    if (index < 0) return;
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const target = tabs[next];
    if (target) {
      onChange(target.id);
      document.getElementById(`${prefix}-tab-${target.id}`)?.focus();
    }
  };

  return (
    <div className="tabs" role="tablist" onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`${prefix}-tab-${tab.id}`}
          className="tab"
          aria-selected={tab.id === value}
          aria-controls={`${prefix}-panel-${tab.id}`}
          tabIndex={tab.id === value ? 0 : -1}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="tab__count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  id,
  idPrefix,
  active,
  children,
}: {
  id: string;
  idPrefix: string;
  active: boolean;
  children: ReactNode;
}) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${id}`} aria-labelledby={`${idPrefix}-tab-${id}`} tabIndex={0}>
      {children}
    </div>
  );
}
