import { Badge, Card, Empty, Spinner, formatBytes, formatDate, formatDuration, formatMoney, timeAgo, Avatar } from '../../components/console/ui.jsx';
import { useApi } from './useApi.js';

function Stat({ label, value, sub, tone }) {
  return (
    <div className={`cs-stat ${tone ? `is-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function money(list) {
  if (!list?.length) return '0';
  return list.map((r) => formatMoney(r.total, r.currency)).join(' + ');
}

export default function Overview({ onOpenUser, onGo }) {
  const { data, error } = useApi('/api/admin/overview');
  if (error) return <div className="cs-alert">{error}</div>;
  if (!data) return <Spinner />;
  const done = data.jobs.last24h.done || 0;
  const failed = data.jobs.last24h.error || 0;

  return (
    <div className="cs-stack">
      <div className="cs-stats">
        <Stat label="Total users" value={data.users.total.toLocaleString()} sub={`+${data.users.new7d} this week`} />
        <Stat label="Pro users" value={data.users.pro.toLocaleString()} sub={`${data.users.total ? Math.round((data.users.pro / data.users.total) * 100) : 0}% of users`} tone="pro" />
        <Stat label="Revenue · 30 days" value={money(data.revenue.last30d)} sub={`All time: ${money(data.revenue.allTime)}`} tone="ok" />
        <Stat label="Renders · 24h" value={(done + failed + (data.jobs.last24h.running || 0)).toLocaleString()} sub={`${done} done · ${failed} failed · ${data.jobs.running} running`} tone={failed ? 'warn' : undefined} />
        <Stat label="Projects" value={data.projects.total.toLocaleString()} sub={`${data.users.suspended} suspended users`} />
        <Stat label="Render queue" value={`${data.system.render.active} / ${data.system.render.max}`} sub={`${data.system.render.queued} waiting · up ${formatDuration(data.system.uptimeSeconds)}`} />
      </div>

      <div className="cs-grid-2">
        <Card title="Newest users" actions={<button type="button" className="cs-link" onClick={() => onGo('users')}>All users</button>}>
          {data.recentUsers.length === 0 ? <Empty>No users yet.</Empty> : (
            <ul className="cs-mini-list">
              {data.recentUsers.map((u) => (
                <li key={u._id}>
                  <button type="button" onClick={() => onOpenUser(u._id)}>
                    <Avatar user={u} size={30} />
                    <span className="cs-mini-main"><strong>{u.name || u.email}</strong><small>{u.email}</small></span>
                    <span className="cs-mini-side">{u.isPro ? <Badge tone="pro">Pro</Badge> : <Badge>Free</Badge>}<small>{timeAgo(u.createdAt)}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Latest payments" actions={<button type="button" className="cs-link" onClick={() => onGo('payments')}>All payments</button>}>
          {data.recentPayments.length === 0 ? <Empty>No payments recorded yet.</Empty> : (
            <ul className="cs-mini-list">
              {data.recentPayments.map((p) => (
                <li key={p._id}>
                  <button type="button" onClick={() => p.user && onOpenUser(p.user)} disabled={!p.user}>
                    <span className={`cs-dot is-${p.provider}`} aria-hidden="true" />
                    <span className="cs-mini-main"><strong>{formatMoney(p.amount, p.currency)}</strong><small>{p.userEmail || '—'}</small></span>
                    <span className="cs-mini-side"><Badge>{p.provider}</Badge><small>{timeAgo(p.createdAt)}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent failed renders" actions={<button type="button" className="cs-link" onClick={() => onGo('jobs')}>All renders</button>}>
          {data.recentFailures.length === 0 ? <Empty>No failed renders.</Empty> : (
            <ul className="cs-mini-list">
              {data.recentFailures.map((j) => (
                <li key={j._id}>
                  <div className="cs-mini-static">
                    <span className="cs-dot is-error" aria-hidden="true" />
                    <span className="cs-mini-main"><strong>{j.kind}</strong><small title={j.error}>{j.error || 'Unknown error'}</small></span>
                    <span className="cs-mini-side"><small>{j.owner?.email || '—'}</small><small>{timeAgo(j.createdAt)}</small></span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Server" actions={<button type="button" className="cs-link" onClick={() => onGo('system')}>System details</button>}>
          <dl className="cs-facts cs-facts-grid">
            <div><dt>Renders running</dt><dd>{data.system.render.active} of {data.system.render.max}</dd></div>
            <div><dt>Waiting in queue</dt><dd>{data.system.render.queued}</dd></div>
            <div><dt>Free disk</dt><dd>{data.system.disk ? `${data.system.disk.freeGb} GB` : '—'}</dd></div>
            <div><dt>Media stored</dt><dd>{data.system.disk ? formatBytes(data.system.disk.usedByAppGb * 1073741824) : '—'}</dd></div>
            <div><dt>Uptime</dt><dd>{formatDuration(data.system.uptimeSeconds)}</dd></div>
            <div><dt>Admins</dt><dd>{data.users.admins}</dd></div>
          </dl>
          <p className="cs-muted">Updated {formatDate(new Date(), true)}</p>
        </Card>
      </div>
    </div>
  );
}
