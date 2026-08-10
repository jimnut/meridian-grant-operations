/**
 * Hand-built SVG charts.
 *
 * Every chart is marked `aria-hidden` and paired with a visible text summary
 * plus a screen-reader table, so the data is never locked inside a picture and
 * never conveyed by colour alone.
 */

import type { ReactNode } from 'react';

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
  /** Secondary display value, e.g. a formatted amount. */
  display?: string;
}

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  const rad = ((angle - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const large = end - start > 180 ? 1 : 0;
  const [sx, sy] = polar(cx, cy, outer, end);
  const [ex, ey] = polar(cx, cy, outer, start);
  const [isx, isy] = polar(cx, cy, inner, start);
  const [iex, iey] = polar(cx, cy, inner, end);
  return [
    `M ${sx} ${sy}`,
    `A ${outer} ${outer} 0 ${large} 0 ${ex} ${ey}`,
    `L ${isx} ${isy}`,
    `A ${inner} ${inner} 0 ${large} 1 ${iex} ${iey}`,
    'Z',
  ].join(' ');
}

export function DonutChart({
  slices,
  centerValue,
  centerLabel,
  summary,
  tableCaption,
  valueHeading = 'Value',
}: {
  slices: Slice[];
  centerValue: string;
  centerLabel: string;
  summary: ReactNode;
  tableCaption: string;
  valueHeading?: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const size = 168;
  const cx = size / 2;
  const cy = size / 2;
  const outer = 74;
  const inner = 50;

  let cursor = 0;
  const segments = slices
    .filter((s) => s.value > 0)
    .map((slice) => {
      const sweep = total > 0 ? (slice.value / total) * 360 : 0;
      const start = cursor;
      cursor += sweep;
      // A single full-circle slice cannot be drawn as an arc; use a ring instead.
      const isFull = sweep >= 359.999;
      return { slice, start, end: cursor, isFull };
    });

  return (
    <div>
      <div className="row row-3" style={{ alignItems: 'center', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
          {total === 0 && <circle cx={cx} cy={cy} r={(outer + inner) / 2} fill="none" stroke="#e5e0d6" strokeWidth={outer - inner} />}
          {segments.map(({ slice, start, end, isFull }) =>
            isFull ? (
              <circle
                key={slice.key}
                cx={cx}
                cy={cy}
                r={(outer + inner) / 2}
                fill="none"
                stroke={slice.color}
                strokeWidth={outer - inner}
              />
            ) : (
              <path key={slice.key} d={arcPath(cx, cy, outer, inner, start, end)} fill={slice.color} />
            ),
          )}
          <text x={cx} y={cy - 2} textAnchor="middle" fontSize="20" fontWeight="600" fill="#14231d">
            {centerValue}
          </text>
          <text x={cx} y={cy + 16} textAnchor="middle" fontSize="10" fill="#63706a">
            {centerLabel}
          </text>
        </svg>

        <ul className="chart-legend" style={{ flexDirection: 'column', flex: 1, minWidth: 180, gap: 'var(--space-2)' }}>
          {slices.map((slice) => (
            <li key={slice.key} className="chart-legend__item">
              <span className="chart-legend__swatch" style={{ background: slice.color }} aria-hidden="true" />
              <span style={{ flex: 1 }}>{slice.label}</span>
              <span className="numeric" style={{ color: 'var(--ink-800)', fontWeight: 600 }}>
                {slice.display ?? slice.value}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="chart-summary">{summary}</p>

      <div className="visually-hidden">
        <table>
        <caption>{tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">{valueHeading}</th>
          </tr>
        </thead>
        <tbody>
          {slices.map((slice) => (
            <tr key={slice.key}>
              <th scope="row">{slice.label}</th>
              <td>{slice.display ?? slice.value}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  display: string;
  color?: string;
  meta?: string;
}

export function BarList({
  data,
  summary,
  tableCaption,
  valueHeading = 'Value',
}: {
  data: BarDatum[];
  summary?: ReactNode;
  tableCaption: string;
  valueHeading?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div>
      <div aria-hidden="true">
        {data.map((datum) => (
          <div className="bar-row" key={datum.key}>
            <span className="bar-row__label" title={datum.label}>
              {datum.label}
            </span>
            <span className="bar-row__track">
              <span
                className="bar-row__fill"
                style={{ width: `${Math.max(2, (datum.value / max) * 100)}%`, background: datum.color }}
              />
            </span>
            <span className="bar-row__value">{datum.display}</span>
          </div>
        ))}
      </div>

      {summary && <p className="chart-summary">{summary}</p>}

      <div className="visually-hidden">
        <table>
        <caption>{tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">{valueHeading}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.key}>
              <th scope="row">{datum.label}</th>
              <td>{datum.display}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}

/** Horizontal stacked bar for a pipeline/stage breakdown. */
export function StackedBar({
  slices,
  summary,
  tableCaption,
}: {
  slices: Slice[];
  summary: ReactNode;
  tableCaption: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  return (
    <div>
      <div
        aria-hidden="true"
        style={{
          display: 'flex',
          height: 14,
          borderRadius: 'var(--radius-full)',
          overflow: 'hidden',
          background: 'var(--canvas-deep)',
        }}
      >
        {slices
          .filter((s) => s.value > 0)
          .map((slice) => (
            <div
              key={slice.key}
              style={{ width: `${total > 0 ? (slice.value / total) * 100 : 0}%`, background: slice.color }}
            />
          ))}
      </div>

      <ul className="chart-legend">
        {slices.map((slice) => (
          <li key={slice.key} className="chart-legend__item">
            <span className="chart-legend__swatch" style={{ background: slice.color }} aria-hidden="true" />
            {slice.label}
            <span className="numeric" style={{ color: 'var(--ink-800)', fontWeight: 600 }}>
              {slice.display ?? slice.value}
            </span>
          </li>
        ))}
      </ul>

      <p className="chart-summary">{summary}</p>

      <div className="visually-hidden">
        <table>
        <caption>{tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">Stage</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {slices.map((slice) => (
            <tr key={slice.key}>
              <th scope="row">{slice.label}</th>
              <td>{slice.display ?? slice.value}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}

export const CHART_COLORS = {
  onTrack: '#2b6a4a',
  watch: '#b8891f',
  atRisk: '#9c3227',
  accent: '#1c6b58',
  accentSoft: '#63a690',
  info: '#2f5c75',
  neutral: '#a3aca7',
  sand: '#c9b98e',
} as const;
