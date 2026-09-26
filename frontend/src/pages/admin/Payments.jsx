import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { Badge, Card, Empty, Pager, Spinner, formatDate, formatMoney } from '../../components/console/ui.jsx';
import { useApi } from './useApi.js';
import { PROVIDER_LABEL } from './labels.js';

export default function Payments({ onOpenUser, toast }) {
  const [provider, setProvider] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const { data, error, loading, reload } = useApi('/api/admin/payments', { provider, q: query, page: pageNo, limit: 25 });

  useEffect(() => {
    const t = setTimeout(() => { setQuery(q.trim()); setPageNo(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const setStatus = async (payment, status) => {
    try {
      await api(`/api/admin/payments/${payment._id}`, { method: 'PATCH', body: { status } });
      toast(status === 'refunded' ? 'Marked as refunded.' : 'Marked as successful.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <Card title="Payments" subtitle="Every MoMo, card and manually recorded payment.">
      {data?.totals?.length > 0 && (
        <div className="cs-stats cs-stats-inline">
          {data.totals.map((t) => (
            <div className="cs-stat is-ok" key={t.currency}>
              <span>Total received ({t.currency})</span>
              <strong>{formatMoney(t.total, t.currency)}</strong>
              <small>{t.count} payment{t.count === 1 ? '' : 's'}</small>
            </div>
          ))}
        </div>
      )}
      <div className="cs-toolbar">
        <input className="cs-search" type="search" placeholder="Search email or reference" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search payments" />
        <div className="cs-chips" role="group" aria-label="Filter by method">
          {[['', 'All'], ['momo', 'MoMo'], ['card', 'Card'], ['manual', 'Manual']].map(([id, label]) => (
            <button key={id || 'all'} type="button" className={`cs-chip ${provider === id ? 'is-active' : ''}`} aria-pressed={provider === id} onClick={() => { setProvider(id); setPageNo(1); }}>{label}</button>
          ))}
        </div>
      </div>
      {error && <div className="cs-alert">{error}</div>}
      {!data && loading && <Spinner />}
      {data && data.payments.length === 0 && <Empty>No payments recorded yet. New MoMo and card payments appear here automatically.</Empty>}
      {data && data.payments.length > 0 && (
        <div className={`cs-table-wrap ${loading ? 'is-loading' : ''}`}>
          <table className="cs-table">
            <thead><tr><th>Date</th><th>User</th><th>Method</th><th>Amount</th><th>Pro until</th><th>Status</th><th>Reference</th><th /></tr></thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p._id}>
                  <td>{formatDate(p.createdAt, true)}</td>
                  <td>{p.user ? <button type="button" className="cs-link" onClick={() => onOpenUser(p.user)}>{p.userEmail}</button> : <span className="cs-muted">{p.userEmail || '—'}</span>}</td>
                  <td>{PROVIDER_LABEL[p.provider] || p.provider}</td>
                  <td><strong>{formatMoney(p.amount, p.currency)}</strong></td>
                  <td>{formatDate(p.periodEnd)}</td>
                  <td><Badge tone={p.status === 'successful' ? 'ok' : 'warn'}>{p.status}</Badge></td>
                  <td><code className="cs-code" title={p.note || p.reference}>{p.reference.length > 18 ? `${p.reference.slice(0, 18)}…` : p.reference}</code></td>
                  <td>
                    {p.status === 'successful'
                      ? <button type="button" className="cs-link" onClick={() => setStatus(p, 'refunded')}>Mark refunded</button>
                      : <button type="button" className="cs-link" onClick={() => setStatus(p, 'successful')}>Undo refund</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPageNo} />}
    </Card>
  );
}
