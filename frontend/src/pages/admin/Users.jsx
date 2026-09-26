import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { Avatar, Badge, Card, Empty, Modal, Pager, Spinner, formatDate, timeAgo } from '../../components/console/ui.jsx';
import { useApi } from './useApi.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pro', label: 'Pro' },
  { id: 'free', label: 'Free' },
  { id: 'admin', label: 'Admins' },
  { id: 'suspended', label: 'Suspended' },
];

function CreateUserModal({ onClose, onCreated, toast }) {
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'user' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user } = await api('/api/admin/users', { method: 'POST', body: form });
      toast(`Account created for ${user.email}.`);
      onCreated(user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Add a user" onClose={onClose}>
      <form className="cs-form" onSubmit={submit}>
        <label className="cs-field"><span>Email</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="off" /></label>
        <label className="cs-field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} /></label>
        <label className="cs-field"><span>Temporary password</span><input type="password" value={form.password} minLength={8} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" /><small>At least 8 characters. Ask them to change it from their Account page.</small></label>
        <label className="cs-field">
          <span>Role</span>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="user">User</option>
            <option value="admin">Admin - full access to this panel</option>
          </select>
        </label>
        {error && <p className="cs-error-text">{error}</p>}
        <div className="cs-form-actions">
          <button type="button" className="cs-btn cs-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="cs-btn cs-btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Users({ onOpenUser, toast, refreshKey }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [pageNo, setPageNo] = useState(1);
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useApi('/api/admin/users', { q: query, filter, page: pageNo, limit: 25 });

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => { setQuery(q.trim()); setPageNo(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { if (refreshKey) reload(); }, [refreshKey, reload]);

  return (
    <Card
      title="Users"
      subtitle="Search, filter and open any account to manage it."
      actions={<button type="button" className="cs-btn cs-btn-primary cs-btn-sm" onClick={() => setCreating(true)}>+ Add user</button>}
    >
      <div className="cs-toolbar">
        <input className="cs-search" type="search" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
        <div className="cs-chips" role="group" aria-label="Filter users">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={`cs-chip ${filter === f.id ? 'is-active' : ''}`} aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setPageNo(1); }}>{f.label}</button>
          ))}
        </div>
      </div>
      {error && <div className="cs-alert">{error}</div>}
      {!data && loading && <Spinner />}
      {data && data.users.length === 0 && <Empty>No users match.</Empty>}
      {data && data.users.length > 0 && (
        <div className={`cs-table-wrap ${loading ? 'is-loading' : ''}`}>
          <table className="cs-table cs-table-click">
            <thead><tr><th>User</th><th>Plan</th><th>Role</th><th>Status</th><th>Exports</th><th>Joined</th><th>Last sign-in</th></tr></thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u._id} onClick={() => onOpenUser(u._id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpenUser(u._id); }}>
                  <td>
                    <div className="cs-user-cell">
                      <Avatar user={u} size={30} />
                      <span><strong>{u.name || '—'}</strong><small>{u.email}</small></span>
                    </div>
                  </td>
                  <td>{u.isPro ? <Badge tone="pro">Pro{u.periodEnd ? ` · ${formatDate(u.periodEnd)}` : u.isOwner ? ' · owner' : ' · lifetime'}</Badge> : <Badge>Free</Badge>}</td>
                  <td>{u.isAdmin ? <Badge tone="admin">{u.isOwner ? 'Owner' : 'Admin'}</Badge> : <span className="cs-muted">User</span>}</td>
                  <td>{u.status === 'suspended' ? <Badge tone="danger">Suspended</Badge> : <Badge tone="ok">Active</Badge>}</td>
                  <td>{u.usage?.exportsThisPeriod || 0}</td>
                  <td>{formatDate(u.createdAt)}</td>
                  <td>{timeAgo(u.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPageNo} />}
      {creating && <CreateUserModal toast={toast} onClose={() => setCreating(false)} onCreated={(u) => { setCreating(false); reload(); onOpenUser(u._id); }} />}
    </Card>
  );
}
