import { useState } from 'react';
import { Badge, Card, Empty, Pager, Spinner, formatBytes, formatDate } from '../../components/console/ui.jsx';
import { useApi } from './useApi.js';
import { JOB_KIND_LABEL, formatProcessingTime } from './labels.js';

const STATUS_TONE = { done: 'ok', error: 'danger', running: 'warn' };

// Everything the server processed (backend/models/Operation.js), from
// signed-in users and guests alike.
export default function Jobs({ onOpenUser }) {
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [who, setWho] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const { data, error, loading, reload } = useApi('/api/admin/jobs', { status, kind, who, page: pageNo, limit: 30 });

  return (
    <Card
      title="Server activity"
      subtitle="Every montage, merge, shorts, captions, export, link download and upload the server processed - from users and guests. Kept for 30 days."
      actions={<button type="button" className="cs-btn cs-btn-ghost cs-btn-sm" onClick={reload}>Refresh</button>}
    >
      <div className="cs-toolbar">
        <div className="cs-chips" role="group" aria-label="Filter by status">
          {[['', 'All'], ['running', 'Running'], ['done', 'Done'], ['error', 'Failed']].map(([id, label]) => (
            <button key={id || 'all'} type="button" className={`cs-chip ${status === id ? 'is-active' : ''}`} aria-pressed={status === id} onClick={() => { setStatus(id); setPageNo(1); }}>{label}</button>
          ))}
        </div>
        <div className="cs-chips" role="group" aria-label="Filter by who">
          {[['', 'Everyone'], ['user', 'Users'], ['guest', 'Guests']].map(([id, label]) => (
            <button key={id || 'everyone'} type="button" className={`cs-chip ${who === id ? 'is-active' : ''}`} aria-pressed={who === id} onClick={() => { setWho(id); setPageNo(1); }}>{label}</button>
          ))}
        </div>
        <select className="cs-select" value={kind} onChange={(e) => { setKind(e.target.value); setPageNo(1); }} aria-label="Filter by type">
          <option value="">All types</option>
          {Object.entries(JOB_KIND_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      {error && <div className="cs-alert">{error}</div>}
      {!data && loading && <Spinner />}
      {data && data.jobs.length === 0 && <Empty>Nothing matches.</Empty>}
      {data && data.jobs.length > 0 && (
        <div className={`cs-table-wrap ${loading ? 'is-loading' : ''}`}>
          <table className="cs-table">
            <thead><tr><th>Started</th><th>Type</th><th>Who</th><th>Status</th><th>Time taken</th><th>Uploaded</th><th>Details</th></tr></thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr key={j._id}>
                  <td>{formatDate(j.createdAt, true)}</td>
                  <td>{JOB_KIND_LABEL[j.kind] || j.kind}</td>
                  <td>
                    {j.owner
                      ? <button type="button" className="cs-link" onClick={() => onOpenUser(j.owner._id)}>{j.owner.email}</button>
                      : j.guest ? <Badge>Guest</Badge> : <span className="cs-muted">deleted user</span>}
                  </td>
                  <td><Badge tone={STATUS_TONE[j.status]}>{j.status === 'error' ? 'failed' : j.status}</Badge></td>
                  <td>{j.status === 'running' ? '…' : formatProcessingTime(j.durationMs)}</td>
                  <td>{j.inputBytes ? formatBytes(j.inputBytes) : '—'}</td>
                  <td className="cs-cell-wrap" title={j.errorDetails || j.error || ''}>
                    {j.status === 'error' ? <span className="cs-error-text">{(j.error || '').slice(0, 140)}</span> : '—'}
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
