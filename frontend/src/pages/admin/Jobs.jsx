import { useState } from 'react';
import { Badge, Card, Empty, Pager, Spinner, formatDate } from '../../components/console/ui.jsx';
import { useApi } from './useApi.js';
import { JOB_KIND_LABEL } from './labels.js';

const STATUS_TONE = { done: 'ok', error: 'danger', running: 'warn' };

export default function Jobs({ onOpenUser }) {
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const { data, error, loading, reload } = useApi('/api/admin/jobs', { status, kind, page: pageNo, limit: 30 });

  return (
    <Card
      title="Renders"
      subtitle="Montages, exports, captions, shorts and uploads from every user."
      actions={<button type="button" className="cs-btn cs-btn-ghost cs-btn-sm" onClick={reload}>Refresh</button>}
    >
      <div className="cs-toolbar">
        <div className="cs-chips" role="group" aria-label="Filter by status">
          {[['', 'All'], ['running', 'Running'], ['done', 'Done'], ['error', 'Failed']].map(([id, label]) => (
            <button key={id || 'all'} type="button" className={`cs-chip ${status === id ? 'is-active' : ''}`} aria-pressed={status === id} onClick={() => { setStatus(id); setPageNo(1); }}>{label}</button>
          ))}
        </div>
        <select className="cs-select" value={kind} onChange={(e) => { setKind(e.target.value); setPageNo(1); }} aria-label="Filter by type">
          <option value="">All types</option>
          {Object.entries(JOB_KIND_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      {error && <div className="cs-alert">{error}</div>}
      {!data && loading && <Spinner />}
      {data && data.jobs.length === 0 && <Empty>No renders match.</Empty>}
      {data && data.jobs.length > 0 && (
        <div className={`cs-table-wrap ${loading ? 'is-loading' : ''}`}>
          <table className="cs-table">
            <thead><tr><th>Started</th><th>Type</th><th>User</th><th>Status</th><th>Progress</th><th>Details</th></tr></thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr key={j._id}>
                  <td>{formatDate(j.createdAt, true)}</td>
                  <td>{JOB_KIND_LABEL[j.kind] || j.kind}</td>
                  <td>{j.owner ? <button type="button" className="cs-link" onClick={() => onOpenUser(j.owner._id)}>{j.owner.email}</button> : <span className="cs-muted">deleted</span>}</td>
                  <td><Badge tone={STATUS_TONE[j.status]}>{j.status === 'error' ? 'failed' : j.status}</Badge></td>
                  <td>{Math.round(j.progress || 0)}%</td>
                  <td className="cs-cell-wrap" title={j.error || j.message}>{j.status === 'error' ? <span className="cs-error-text">{(j.error || '').slice(0, 140)}</span> : (j.message || '—')}</td>
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
