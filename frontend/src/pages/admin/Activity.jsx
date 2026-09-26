import { useState } from 'react';
import { Card, Empty, Pager, Spinner, formatDate } from '../../components/console/ui.jsx';
import { useApi } from './useApi.js';
import { ACTION_LABEL } from './labels.js';

function describe(details) {
  if (!details) return '';
  if (details.days) return details.days === 'lifetime' ? 'lifetime' : `${details.days} days${details.amount ? ` · ${details.amount} ${details.currency || ''}` : ''}`;
  if (details.reason) return details.reason;
  if (details.email) return `email ${details.email.from} → ${details.email.to}`;
  if (details.name) return details.name;
  if (details.reference) return details.reference;
  if (details.projectsDeleted !== undefined) return `${details.projectsDeleted} projects, ${details.jobsDeleted} renders removed`;
  if (details.role) return `role: ${details.role}`;
  return '';
}

export default function Activity({ onOpenUser }) {
  const [pageNo, setPageNo] = useState(1);
  const { data, error, loading } = useApi('/api/admin/actions', { page: pageNo, limit: 30 });
  return (
    <Card title="Activity log" subtitle="Every change made from this admin panel, newest first.">
      {error && <div className="cs-alert">{error}</div>}
      {!data && loading && <Spinner />}
      {data && data.actions.length === 0 && <Empty>No admin actions yet.</Empty>}
      {data && data.actions.length > 0 && (
        <div className={`cs-table-wrap ${loading ? 'is-loading' : ''}`}>
          <table className="cs-table">
            <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Account</th><th>Details</th></tr></thead>
            <tbody>
              {data.actions.map((a) => (
                <tr key={a._id}>
                  <td>{formatDate(a.createdAt, true)}</td>
                  <td>{a.adminEmail}</td>
                  <td><strong>{ACTION_LABEL[a.action] || a.action}</strong></td>
                  <td>{a.targetUser && a.action !== 'user.delete' ? <button type="button" className="cs-link" onClick={() => onOpenUser(a.targetUser)}>{a.targetEmail}</button> : (a.targetEmail || '—')}</td>
                  <td className="cs-cell-wrap">{describe(a.details)}</td>
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
