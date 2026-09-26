/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from 'react';
import './charts.css';

// Small dependency-free SVG charts for the admin Analytics page.
// Specs: 2px lines with a ~10% area wash, columns <= 24px with 4px rounded
// data-ends and a 2px gap between stacked segments, hairline solid grid,
// a crosshair + tooltip on lines and a per-column tooltip on bars, keyboard
// arrows move the readout, and every chart can switch to a table.

export const fmtInt = (v) => (v == null ? '—' : Math.round(v).toLocaleString());

export function fmtCompact(v) {
  if (v == null) return '—';
  const n = Number(v);
  const trim = (x) => x.replace(/\.0$/, '');
  if (Math.abs(n) >= 1e6) return `${trim((n / 1e6).toFixed(n >= 1e7 ? 0 : 1))}M`;
  if (Math.abs(n) >= 1e4) return `${trim((n / 1e3).toFixed(n >= 1e5 ? 0 : 1))}K`;
  return Math.round(n).toLocaleString();
}

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// Rounds the top of the axis up to a clean 1/2/5 step so ticks read 0 / 250 / 500.
function niceScale(max, ticks = 4) {
  if (!(max > 0)) return { top: ticks, step: 1 };
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  // Everything charted here is a whole number, so ticks never go below 1
  // (a max of 2 reads 0 / 1 / 2 / 3 / 4, not 0 / 0.5 / 1 ...).
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) || 10 * pow);
  return { top: step * ticks, step };
}

function Legend({ series, kind }) {
  if (series.length < 2) return null;
  return (
    <div className="viz-legend">
      {series.map((s) => (
        <span key={s.key}><i className={`viz-key viz-key-${kind}`} style={{ background: s.color }} />{s.label}</span>
      ))}
    </div>
  );
}

function Tooltip({ x, width, title, rows }) {
  const left = Math.min(Math.max(x, 70), width - 70);
  return (
    <div className="viz-tip" style={{ left }} role="status">
      <div className="viz-tip-title">{title}</div>
      {rows.map((r) => (
        <div className="viz-tip-row" key={r.label}>
          <i className="viz-key viz-key-line" style={{ background: r.color }} />
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

const PAD = { l: 44, r: 12, t: 12, b: 26 };

function Axes({ w, h, top, step, format, labels }) {
  const ih = h - PAD.t - PAD.b;
  const lines = [];
  for (let v = 0; v <= top + 1e-9; v += step) {
    const y = PAD.t + ih - (v / top) * ih;
    lines.push(
      <g key={v}>
        <line x1={PAD.l} x2={w - PAD.r} y1={y} y2={y} className={v === 0 ? 'viz-baseline' : 'viz-grid'} />
        <text x={PAD.l - 8} y={y} className="viz-tick" textAnchor="end" dominantBaseline="middle">{format(v)}</text>
      </g>,
    );
  }
  return (
    <>
      {lines}
      {labels.map((l) => <text key={l.i} x={l.x} y={h - 6} className="viz-tick" textAnchor="middle">{l.text}</text>)}
    </>
  );
}

// Picks x labels that don't collide: every Nth, where N leaves room for the
// widest label, plus the last one only if it clears the one before it.
function xLabels(data, xAt, formatX) {
  if (!data.length) return [];
  const all = data.map((d, i) => ({ i, x: xAt(i), text: formatX(d) }));
  const room = Math.max(...all.map((l) => l.text.length)) * 6.4 + 14;
  const spacing = data.length > 1 ? xAt(1) - xAt(0) : room;
  const every = Math.max(1, Math.ceil(room / spacing));
  const picked = all.filter((l) => l.i % every === 0);
  const last = all[all.length - 1];
  if (picked.at(-1).i !== last.i && last.x - picked.at(-1).x >= room) picked.push(last);
  return picked;
}

function useHover(n) {
  const [index, setIndex] = useState(null);
  const onKeyDown = (e) => {
    if (!n) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); setIndex((i) => (i == null ? 0 : Math.min(n - 1, i + 1))); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setIndex((i) => (i == null ? n - 1 : Math.max(0, i - 1))); }
    if (e.key === 'Escape') setIndex(null);
  };
  return { index, setIndex, onKeyDown };
}

export function LineChart({ data, series, formatX, formatY = fmtCompact, height = 220, label }) {
  const [ref, width] = useWidth();
  const { index, setIndex, onKeyDown } = useHover(data.length);
  const w = Math.max(width, 240);
  const ih = height - PAD.t - PAD.b;
  const iw = w - PAD.l - PAD.r;
  const { top, step } = niceScale(Math.max(0, ...data.flatMap((d) => series.map((s) => d[s.key] || 0))));
  const xAt = (i) => PAD.l + (data.length <= 1 ? iw / 2 : (i * iw) / (data.length - 1));
  const yAt = (v) => PAD.t + ih - ((v || 0) / top) * ih;
  const pathFor = (key) => data.map((d, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(d[key]).toFixed(1)}`).join('');

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * w;
    const i = data.length <= 1 ? 0 : Math.round(((px - PAD.l) / iw) * (data.length - 1));
    setIndex(Math.min(data.length - 1, Math.max(0, i)));
  };

  return (
    <div className="viz" ref={ref}>
      <Legend series={series} kind="line" />
      <div className="viz-plot">
        <svg
          width={w}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerMove={onMove}
          onPointerLeave={() => setIndex(null)}
          onBlur={() => setIndex(null)}
        >
          <Axes w={w} h={height} top={top} step={step} format={formatY} labels={xLabels(data, xAt, formatX)} />
          {series.length === 1 && data.length > 1 && (
            <path d={`${pathFor(series[0].key)}L${xAt(data.length - 1)},${yAt(0)}L${xAt(0)},${yAt(0)}Z`} fill={series[0].color} opacity="0.1" />
          )}
          {series.map((s) => <path key={s.key} d={pathFor(s.key)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
          {index != null && (
            <g>
              <line x1={xAt(index)} x2={xAt(index)} y1={PAD.t} y2={PAD.t + ih} className="viz-crosshair" />
              {series.map((s) => <circle key={s.key} cx={xAt(index)} cy={yAt(data[index][s.key])} r="4" fill={s.color} className="viz-dot" />)}
            </g>
          )}
        </svg>
        {index != null && (
          <Tooltip
            x={xAt(index)}
            width={w}
            title={formatX(data[index], true)}
            rows={series.map((s) => ({ label: s.label, color: s.color, value: formatY(data[index][s.key] || 0, true) }))}
          />
        )}
      </div>
    </div>
  );
}

function roundedTop(x, y, width, h, r) {
  const rr = Math.min(r, h, width / 2);
  return `M${x},${y + h}L${x},${y + rr}Q${x},${y} ${x + rr},${y}L${x + width - rr},${y}Q${x + width},${y} ${x + width},${y + rr}L${x + width},${y + h}Z`;
}

// Columns, stacked bottom-up in `series` order.
export function ColumnChart({ data, series, formatX, formatY = fmtCompact, height = 220, label }) {
  const [ref, width] = useWidth();
  const { index, setIndex, onKeyDown } = useHover(data.length);
  const w = Math.max(width, 240);
  const ih = height - PAD.t - PAD.b;
  const iw = w - PAD.l - PAD.r;
  const totals = data.map((d) => series.reduce((sum, s) => sum + (d[s.key] || 0), 0));
  const { top, step } = niceScale(Math.max(0, ...totals));
  const band = iw / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(24, band * 0.62));
  const xAt = (i) => PAD.l + band * i + band / 2;
  const GAP = 2;

  return (
    <div className="viz" ref={ref}>
      <Legend series={series} kind="bar" />
      <div className="viz-plot">
        <svg width={w} height={height} role="img" aria-label={label} tabIndex={0} onKeyDown={onKeyDown} onPointerLeave={() => setIndex(null)} onBlur={() => setIndex(null)}>
          <Axes w={w} h={height} top={top} step={step} format={formatY} labels={xLabels(data, xAt, formatX)} />
          {data.map((d, i) => {
            let base = PAD.t + ih;
            const visible = series.filter((s) => (d[s.key] || 0) > 0);
            return (
              <g key={i} className={index != null && index !== i ? 'viz-dim' : ''}>
                {visible.map((s, k) => {
                  const full = ((d[s.key] || 0) / top) * ih;
                  const hgt = Math.max(1, full - (k > 0 ? GAP : 0));
                  const y = base - (k > 0 ? GAP : 0) - hgt;
                  const isTop = k === visible.length - 1;
                  base = y;
                  const x = xAt(i) - barW / 2;
                  return isTop
                    ? <path key={s.key} d={roundedTop(x, y, barW, hgt, 4)} fill={s.color} />
                    : <rect key={s.key} x={x} y={y} width={barW} height={hgt} fill={s.color} />;
                })}
                <rect x={PAD.l + band * i} y={PAD.t} width={band} height={ih} fill="transparent" onPointerEnter={() => setIndex(i)} />
              </g>
            );
          })}
        </svg>
        {index != null && (
          <Tooltip
            x={xAt(index)}
            width={w}
            title={formatX(data[index], true)}
            rows={[...series].reverse().map((s) => ({ label: s.label, color: s.color, value: formatY(data[index][s.key] || 0, true) }))}
          />
        )}
      </div>
    </div>
  );
}

// Horizontal bars for "which X" breakdowns - one hue, value at the tip.
export function BarList({ items, format = fmtInt, empty = 'No data yet.' }) {
  const max = Math.max(0, ...items.map((i) => i.value));
  if (!items.length || max === 0) return <div className="viz-empty">{empty}</div>;
  return (
    <ul className="viz-barlist">
      {items.map((item) => (
        <li key={item.label}>
          <div className="viz-barlist-head">
            <span>{item.label}</span>
            <strong>{format(item.value)}</strong>
          </div>
          <div className="viz-barlist-track">
            <span style={{ width: `${Math.max(1.5, (item.value / max) * 100)}%` }} />
          </div>
          {item.sub && <small>{item.sub}</small>}
        </li>
      ))}
    </ul>
  );
}

// Card wrapper with a Chart / Table switch - every value stays reachable
// without hovering.
export function ChartCard({ title, subtitle, table, children, className = '' }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`cs-card viz-card ${className}`}>
      <header className="cs-card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {table && (
          <div className="viz-switch" role="group" aria-label={`${title} view`}>
            <button type="button" aria-pressed={!asTable} onClick={() => setAsTable(false)}>Chart</button>
            <button type="button" aria-pressed={asTable} onClick={() => setAsTable(true)}>Table</button>
          </div>
        )}
      </header>
      {asTable && table ? (
        <div className="cs-table-wrap viz-table">
          <table className="cs-table">
            <thead><tr>{table.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>{table.columns.map((c) => <td key={c.key}>{c.format ? c.format(row[c.key], row) : row[c.key]}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : children}
    </section>
  );
}
