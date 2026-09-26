import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { Card, Spinner, formatMoney, timeAgo } from '../../components/console/ui.jsx';
import { BarList, ChartCard, ColumnChart, LineChart, fmtCompact, fmtInt } from '../../components/console/charts.jsx';
import { JOB_KIND_LABEL } from './labels.js';
import './analytics.css';

const AREA_LABEL = {
  landing: 'Landing page', pricing: 'Pricing page', auth: 'Sign in / sign up', editor: 'Editor', montage: 'Montage',
  captions: 'Captions', shorts: 'Shorts', longmix: 'Long Mix', account: 'Account page', admin: 'Admin panel', other: 'Other',
};
const SOURCE_LABEL = {
  direct: 'Direct (typed or bookmarked)', google: 'Google', youtube: 'YouTube', facebook: 'Facebook', instagram: 'Instagram',
  whatsapp: 'WhatsApp', tiktok: 'TikTok', x: 'X (Twitter)', linkedin: 'LinkedIn', bing: 'Bing', campaign: 'Campaign links', other: 'Other websites',
};
const DEVICE_LABEL = { desktop: 'Desktop', mobile: 'Phone', tablet: 'Tablet' };

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: '7 days' },
  { id: '28d', label: '28 days' },
  { id: '90d', label: '90 days' },
];

const SERIES_COLORS = { a: 'var(--viz-1)', b: 'var(--viz-2)', good: 'var(--viz-good)', bad: 'var(--viz-critical)' };

function useVisibleInterval(callback, ms) {
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') callback(); }, ms);
    return () => clearInterval(id);
  }, [callback, ms]);
}

// ---------- Formatting ----------

function makeXFormat(granularity) {
  if (granularity === 'hour') {
    return (d, long) => {
      const h = Number(d.key);
      const pad = (n) => String(n).padStart(2, '0');
      return long ? `${pad(h)}:00 – ${pad((h + 1) % 24)}:00` : `${pad(h)}:00`;
    };
  }
  return (d, long) => new Date(`${d.key}T12:00:00Z`).toLocaleDateString(undefined, long
    ? { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }
    : { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatSeconds(s) {
  if (s == null) return '—';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`);

// ▲ 12% / ▼ 5% vs the previous period. `upIsGood` decides the colour; the
// arrow and the words carry the meaning too, so it never relies on colour.
function Delta({ now, before, upIsGood = true }) {
  if (now == null || before == null) return <span className="an-delta is-flat">no comparison</span>;
  if (before === 0) return now > 0 ? <span className="an-delta is-flat">new vs previous period</span> : <span className="an-delta is-flat">same as previous period</span>;
  const change = (now - before) / Math.abs(before);
  if (Math.abs(change) < 0.005) return <span className="an-delta is-flat">= same as previous period</span>;
  const up = change > 0;
  const good = up === upIsGood;
  return (
    <span className={`an-delta ${good ? 'is-good' : 'is-bad'}`}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span> {Math.abs(change * 100).toFixed(Math.abs(change) < 0.1 ? 1 : 0)}% <span className="an-delta-vs">vs previous</span>
    </span>
  );
}

function Kpi({ label, value, now, before, upIsGood, hint }) {
  return (
    <div className="an-kpi">
      <span className="an-kpi-label">{label}</span>
      <strong className="an-kpi-value">{value}</strong>
      <Delta now={now} before={before} upIsGood={upIsGood} />
      {hint && <small>{hint}</small>}
    </div>
  );
}

// ---------- Live ----------

function LiveView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api('/api/admin/analytics/live')
      .then((d) => { if (alive) { setData(d); setError(''); } })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [tick]);
  useVisibleInterval(() => setTick((t) => t + 1), 10000);

  if (error && !data) return <div className="cs-alert">{error}</div>;
  if (!data) return <Spinner />;

  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: data.timezone });
  const minutes = data.minutes.map((m) => ({ ...m, key: m.t }));
  const formatMinute = (d) => timeFmt.format(new Date(d.t));
  const lastHour = minutes.reduce((acc, m) => ({ requests: acc.requests + m.requests, errors: acc.errors + m.errors }), { requests: 0, errors: 0 });
  const areas = Object.entries(data.active.byArea).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

  return (
    <div className="cs-stack">
      <div className="an-live-top">
        <section className="cs-card an-hero">
          <div className="an-live-dot" aria-hidden="true" />
          <span className="an-kpi-label">Active right now</span>
          <strong className="an-hero-value">{fmtInt(data.active.total)}</strong>
          <p>{fmtInt(data.active.signedIn)} signed in · {fmtInt(data.active.visitors)} visitors · last 5 minutes</p>
          <dl className="an-mini-facts">
            <div><dt>Visitors today</dt><dd>{fmtInt(data.today.visitors)}</dd></div>
            <div><dt>Sign-ups today</dt><dd>{fmtInt(data.today.signups)}</dd></div>
            <div><dt>Renders today</dt><dd>{fmtInt(data.today.renders)}</dd></div>
            <div><dt>Rendering now</dt><dd>{data.render.active} of {data.render.max}{data.render.queued ? ` · ${data.render.queued} waiting` : ''}</dd></div>
          </dl>
        </section>
        <Card title="Where they are" subtitle="What people online right now have open.">
          <BarList
            items={areas.map(([area, n]) => ({ label: AREA_LABEL[area] || area, value: n }))}
            empty="Nobody is online right now."
          />
        </Card>
      </div>

      <div className="cs-grid-2">
        <ChartCard
          title="Active users · last 60 minutes"
          subtitle="People with NexEditor open, minute by minute."
          table={{ columns: [{ key: 't', label: 'Minute', format: (_v, r) => formatMinute(r) }, { key: 'active', label: 'Active users' }], rows: [...minutes].reverse() }}
        >
          <ColumnChart data={minutes} series={[{ key: 'active', label: 'Active users', color: SERIES_COLORS.a }]} formatX={formatMinute} formatY={fmtInt} label="Active users per minute over the last hour" />
        </ChartCard>
        <ChartCard
          title="Server response time · last 60 minutes"
          subtitle={`${fmtInt(lastHour.requests)} requests · ${fmtInt(lastHour.errors)} server errors in the last hour`}
          table={{ columns: [{ key: 't', label: 'Minute', format: (_v, r) => formatMinute(r) }, { key: 'requests', label: 'Requests' }, { key: 'avgMs', label: 'Avg ms' }, { key: 'errors', label: 'Errors' }], rows: [...minutes].reverse() }}
        >
          <LineChart data={minutes} series={[{ key: 'avgMs', label: 'Average response (ms)', color: SERIES_COLORS.a }]} formatX={formatMinute} formatY={(v, long) => (long ? `${fmtInt(v)} ms` : fmtInt(v))} label="Average server response time per minute" />
        </ChartCard>
      </div>
      <p className="cs-muted an-footnote">Updates every 10 seconds · times in {data.timezone}.</p>
    </div>
  );
}

// ---------- Period report ----------

function PeriodView({ onOpenUser }) {
  const [range, setRange] = useState('7d');
  const [date, setDate] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loadedKey, setLoadedKey] = useState(null);
  const query = range === 'day' ? { range, date } : { range };
  const key = JSON.stringify(query);
  // While a new range loads, the previous report stays on screen, dimmed.
  const loading = loadedKey !== key;

  useEffect(() => {
    let alive = true;
    api('/api/admin/analytics/summary', { query: JSON.parse(key) })
      .then((d) => { if (alive) { setData(d); setError(''); setLoadedKey(key); } })
      .catch((e) => { if (alive) { setError(e.message); setLoadedKey(key); } });
    return () => { alive = false; };
  }, [key]);

  const today = new Date().toISOString().slice(0, 10);
  const filters = (
    <div className="an-filters" role="group" aria-label="Date range">
      {RANGES.map((r) => (
        <button key={r.id} type="button" className={`cs-chip ${range === r.id ? 'is-active' : ''}`} aria-pressed={range === r.id} onClick={() => setRange(r.id)}>{r.label}</button>
      ))}
      <label className={`an-day ${range === 'day' ? 'is-active' : ''}`}>
        <span>Specific day</span>
        <input type="date" max={today} value={date} onChange={(e) => { setDate(e.target.value); if (e.target.value) setRange('day'); }} />
      </label>
    </div>
  );

  if (error && !data) return <>{filters}<div className="cs-alert">{error}</div></>;
  if (!data) return <>{filters}<Spinner /></>;

  const { current: c, previous: p } = data.kpis;
  const formatX = makeXFormat(data.granularity);
  const currency = data.primaryCurrency;
  const revenueNow = c.revenue.find((r) => r.currency === currency)?.total || 0;
  const revenueBefore = p.revenue.find((r) => r.currency === currency)?.total || 0;
  const otherCurrencies = c.revenue.filter((r) => r.currency !== currency);
  const fmtDay = (k, opts) => new Date(`${k}T12:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
  const periodLabel = data.days.length === 1
    ? fmtDay(data.days[0], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : `${fmtDay(data.days[0], { month: 'short', day: 'numeric' })} – ${fmtDay(data.days.at(-1), { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const trackingNote = !data.trackingSince
    ? 'Visitor tracking has just started - visitor numbers build up from today. Sign-ups, renders and revenue include full history.'
    : data.trackingSince > data.days[0]
      ? `Visitor tracking started on ${data.trackingSince}, so visitor numbers before that day are zero. Sign-ups, renders and revenue include full history.`
      : null;
  const unit = data.granularity === 'hour' ? 'hour' : 'day';
  const seriesTable = (cols) => ({ columns: [{ key: 'key', label: data.granularity === 'hour' ? 'Hour' : 'Day', format: (_v, r) => formatX(r, true) }, ...cols], rows: data.series });

  return (
    <div className={`cs-stack ${loading ? 'an-refetching' : ''}`}>
      {filters}
      <p className="an-period">{periodLabel} <span>· compared with the {data.days.length === 1 ? 'day' : `${data.days.length} days`} before · times in {data.timezone}</span></p>
      {trackingNote && <div className="an-note">{trackingNote}</div>}

      <div className="an-kpis">
        <Kpi label="Visitors" value={fmtInt(c.visitors)} now={c.visitors} before={p.visitors} hint={`${fmtInt(c.newVisitors)} new`} />
        <Kpi label="Signed-in users" value={fmtInt(c.signedInUsers)} now={c.signedInUsers} before={p.signedInUsers} />
        <Kpi label="Sign-ups" value={fmtInt(c.signups)} now={c.signups} before={p.signups} hint={c.signupConversion != null ? `${pct(c.signupConversion)} of new visitors` : null} />
        <Kpi label="Avg. time in app" value={c.avgMinutesPerVisitor != null ? `${c.avgMinutesPerVisitor} min` : '—'} now={c.avgMinutesPerVisitor} before={p.avgMinutesPerVisitor} hint="per visitor per day" />
        <Kpi label="Renders" value={fmtInt(c.renders)} now={c.renders} before={p.renders} hint={c.renderSuccessRate != null ? `${pct(c.renderSuccessRate)} succeeded` : null} />
        <Kpi label="Avg. render time" value={formatSeconds(c.avgRenderSeconds)} now={c.avgRenderSeconds} before={p.avgRenderSeconds} upIsGood={false} />
        <Kpi label={`Revenue (${currency})`} value={formatMoney(revenueNow, currency)} now={revenueNow} before={revenueBefore} hint={otherCurrencies.length ? `+ ${otherCurrencies.map((r) => formatMoney(r.total, r.currency)).join(', ')}` : `${fmtInt(c.proPurchases)} Pro purchases`} />
        <Kpi label="Avg. response time" value={c.avgResponseMs != null ? `${fmtInt(c.avgResponseMs)} ms` : '—'} now={c.avgResponseMs} before={p.avgResponseMs} upIsGood={false} hint={c.errorRate != null ? `${pct(c.errorRate)} server errors · ${fmtCompact(c.requests)} requests` : null} />
      </div>

      <div className="cs-grid-2">
        <ChartCard title="Visitors" subtitle={`Unique people per ${unit}.`} table={seriesTable([{ key: 'visitors', label: 'Visitors' }, { key: 'signedIn', label: 'Signed in' }])}>
          <LineChart
            data={data.series}
            series={[{ key: 'visitors', label: 'All visitors', color: SERIES_COLORS.a }, { key: 'signedIn', label: 'Signed in', color: SERIES_COLORS.b }]}
            formatX={formatX}
            formatY={fmtInt}
            label={`Visitors per ${unit}`}
          />
        </ChartCard>
        <ChartCard title="Sign-ups" subtitle={`New accounts per ${unit}.`} table={seriesTable([{ key: 'signups', label: 'Sign-ups' }])}>
          <ColumnChart data={data.series} series={[{ key: 'signups', label: 'Sign-ups', color: SERIES_COLORS.a }]} formatX={formatX} formatY={fmtInt} label={`Sign-ups per ${unit}`} />
        </ChartCard>
        <ChartCard title="Renders" subtitle="Finished montages, exports, captions, shorts and uploads." table={seriesTable([{ key: 'rendersDone', label: 'Succeeded' }, { key: 'rendersFailed', label: 'Failed' }])}>
          <ColumnChart
            data={data.series}
            series={[{ key: 'rendersDone', label: 'Succeeded', color: SERIES_COLORS.good }, { key: 'rendersFailed', label: 'Failed', color: SERIES_COLORS.bad }]}
            formatX={formatX}
            formatY={fmtInt}
            label={`Renders per ${unit}`}
          />
        </ChartCard>
        <ChartCard title={`Revenue (${currency})`} subtitle={`Successful payments per ${unit}.`} table={seriesTable([{ key: 'revenue', label: `Revenue (${currency})`, format: (v) => formatMoney(v, currency) }])}>
          <ColumnChart data={data.series} series={[{ key: 'revenue', label: 'Revenue', color: SERIES_COLORS.a }]} formatX={formatX} formatY={(v, long) => (long ? formatMoney(v, currency) : fmtCompact(v))} label={`Revenue per ${unit}`} />
        </ChartCard>
        <ChartCard title="Server response time" subtitle={`Average API response per ${unit}.`} table={seriesTable([{ key: 'requests', label: 'Requests' }, { key: 'avgMs', label: 'Avg ms' }])}>
          <LineChart data={data.series} series={[{ key: 'avgMs', label: 'Average response (ms)', color: SERIES_COLORS.a }]} formatX={formatX} formatY={(v, long) => (long ? `${fmtInt(v)} ms` : fmtInt(v))} label={`Average response time per ${unit}`} />
        </ChartCard>
        <ChartCard title="Server requests" subtitle={`API calls handled per ${unit}.`} table={seriesTable([{ key: 'requests', label: 'Requests' }])}>
          <ColumnChart data={data.series} series={[{ key: 'requests', label: 'Requests', color: SERIES_COLORS.a }]} formatX={formatX} formatY={fmtCompact} label={`Server requests per ${unit}`} />
        </ChartCard>
      </div>

      <div className="an-breakdowns">
        <Card title="Most used tools" subtitle="Minutes spent in each part of the app.">
          <BarList
            items={data.breakdown.areas.map((a) => ({ label: AREA_LABEL[a.area] || a.area, value: a.minutes, sub: `${fmtInt(a.visitors)} visitor-days` }))}
            format={(v) => `${fmtInt(v)} min`}
          />
        </Card>
        <Card title="Traffic sources" subtitle="Where visitors came from.">
          <BarList items={data.breakdown.sources.map((s) => ({ label: SOURCE_LABEL[s.source] || s.source, value: s.visits }))} format={(v) => `${fmtInt(v)} visits`} />
          {data.breakdown.referrers.length > 0 && (
            <>
              <h3 className="cs-section-title">Top referring websites</h3>
              <ul className="cs-checks">
                {data.breakdown.referrers.map((r) => <li key={r.host}><span>{r.host}</span><strong>{fmtInt(r.visits)}</strong></li>)}
              </ul>
            </>
          )}
        </Card>
        <Card title="Devices" subtitle="What visitors use NexEditor on.">
          <BarList items={data.breakdown.devices.map((d) => ({ label: DEVICE_LABEL[d.device] || d.device, value: d.visits }))} format={(v) => `${fmtInt(v)} visits`} />
        </Card>
        <Card title="Renders by type">
          {data.breakdown.renderKinds.length === 0 ? <div className="viz-empty">No renders in this period.</div> : (
            <div className="cs-table-wrap">
              <table className="cs-table">
                <thead><tr><th>Type</th><th>Renders</th><th>Failed</th><th>Success</th></tr></thead>
                <tbody>
                  {data.breakdown.renderKinds.map((k) => (
                    <tr key={k.kind}>
                      <td>{JOB_KIND_LABEL[k.kind] || k.kind}</td>
                      <td>{fmtInt(k.total)}</td>
                      <td>{fmtInt(k.failed)}</td>
                      <td>{pct(k.total ? (k.total - k.failed) / k.total : null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card title="Most active users" subtitle="Signed-in users ranked by time spent in the app during this period.">
        {data.breakdown.topUsers.length === 0 ? <div className="viz-empty">No signed-in activity recorded in this period yet.</div> : (
          <div className="cs-table-wrap">
            <table className="cs-table cs-table-click">
              <thead><tr><th>User</th><th>Time in app</th><th>Active days</th><th>Renders</th><th>Last seen</th></tr></thead>
              <tbody>
                {data.breakdown.topUsers.map((u) => (
                  <tr key={u._id} onClick={() => onOpenUser(u._id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpenUser(u._id); }}>
                    <td><div className="cs-user-cell"><span><strong>{u.name || u.email}</strong>{u.name && <small>{u.email}</small>}</span></div></td>
                    <td>{fmtInt(u.minutes)} min</td>
                    <td>{fmtInt(u.days)}</td>
                    <td>{fmtInt(u.renders)}</td>
                    <td>{timeAgo(u.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function Analytics({ onOpenUser }) {
  const [view, setView] = useState('live');
  return (
    <div className="cs-stack">
      <div className="an-views" role="tablist" aria-label="Analytics view">
        <button type="button" role="tab" aria-selected={view === 'live'} className={`cs-tab ${view === 'live' ? 'is-active' : ''}`} onClick={() => setView('live')}>
          <span className="an-live-dot is-inline" aria-hidden="true" /> Live
        </button>
        <button type="button" role="tab" aria-selected={view === 'period'} className={`cs-tab ${view === 'period' ? 'is-active' : ''}`} onClick={() => setView('period')}>Reports</button>
      </div>
      {view === 'live' ? <LiveView /> : <PeriodView onOpenUser={onOpenUser} />}
    </div>
  );
}
