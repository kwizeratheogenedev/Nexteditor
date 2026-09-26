import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { Card, Empty, Modal, Pager, Spinner, formatDate, timeAgo } from '../../components/console/ui.jsx';
import { useApi } from './useApi.js';

export default function Projects({ onOpenUser, toast }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useApi('/api/admin/projects', { q: query, page: pageNo, limit: 25 });

  useEffect(() => {
    const t = setTimeout(() => { setQuery(q.trim()); setPageNo(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const remove = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/projects/${confirm._id}`, { method: 'DELETE' });
      toast('Project deleted.');
      setConfirm(null);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Projects" subtitle="Saved editor and montage projects across all users.">
      <div className="cs-toolbar">
        <input className="cs-search" type="search" placeholder="Search project name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
      </div>
      {error && <div className="cs-alert">{error}</div>}
      {!data && loading && <Spinner />}
      {data && data.projects.length === 0 && <Empty>No projects match.</Empty>}
      {data && data.projects.length > 0 && (
        <div className={`cs-table-wrap ${loading ? 'is-loading' : ''}`}>
          <table className="cs-table">
            <thead><tr><th>Name</th><th>Type</th><th>Owner</th><th>Created</th><th>Updated</th><th /></tr></thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={p._id}>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.type}</td>
                  <td>{p.owner ? <button type="button" className="cs-link" onClick={() => onOpenUser(p.owner._id)}>{p.owner.email}</button> : <span className="cs-muted">—</span>}</td>
                  <td>{formatDate(p.createdAt)}</td>
                  <td>{timeAgo(p.updatedAt)}</td>
                  <td><button type="button" className="cs-link cs-link-danger" onClick={() => setConfirm(p)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPageNo} />}
      {confirm && (
        <Modal
          title="Delete project?"
          onClose={() => setConfirm(null)}
          footer={(
            <>
              <button type="button" className="cs-btn cs-btn-ghost" onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className="cs-btn cs-btn-danger" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete'}</button>
            </>
          )}
        >
          <p>&ldquo;{confirm.name}&rdquo; will disappear from {confirm.owner?.email || 'its owner'}&rsquo;s projects.</p>
        </Modal>
      )}
    </Card>
  );
}
