import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ACTION_LABEL } from './labels.js';
import { Avatar, Badge, Empty, Meter, Modal, Spinner, formatBytes, formatDate, formatMoney, timeAgo } from '../../components/console/ui.jsx';


// One modal at a time: which action's form is open.
function ActionModal({ kind, user, onClose, onDone, toast }) {
  const [form, setForm] = useState({ days: 30, lifetime: false, amount: '', currency: 'RWF', note: '', reason: '', password: '', name: user.name || '', email: user.email, confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const run = async (request, message) => {
    setBusy(true);
    setError('');
    try {
      await request();
      toast(message);
      onDone(kind === 'delete');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const id = user._id;
  const configs = {
    pro: {
      title: 'Grant Pro',
      submit: 'Grant Pro',
      body: (
        <>
          <p className="cs-muted">Adds Pro on top of any time {user.email} already has.</p>
          <label className="cs-check"><input type="checkbox" checked={form.lifetime} onChange={set('lifetime')} /> Lifetime Pro (never expires)</label>
          {!form.lifetime && <label className="cs-field"><span>Days of Pro</span><input type="number" min={1} max={3650} value={form.days} onChange={set('days')} /></label>}
          <fieldset className="cs-fieldset">
            <legend>Record a payment (optional)</legend>
            <p className="cs-muted">If they paid you in cash or by transfer, record it so it shows in revenue.</p>
            <div className="cs-field-row">
              <label className="cs-field"><span>Amount</span><input type="number" min={0} step="any" value={form.amount} onChange={set('amount')} placeholder="0" /></label>
              <label className="cs-field"><span>Currency</span><input value={form.currency} onChange={set('currency')} maxLength={8} /></label>
            </div>
            <label className="cs-field"><span>Note</span><input value={form.note} onChange={set('note')} maxLength={200} placeholder="e.g. Paid cash at the office" /></label>
          </fieldset>
        </>
      ),
      action: () => run(() => api(`/api/admin/users/${id}/pro`, { method: 'POST', body: { days: Number(form.days), lifetime: form.lifetime, amount: Number(form.amount) || 0, currency: form.currency, note: form.note } }), 'Pro granted.'),
    },
    suspend: {
      title: 'Suspend account',
      submit: 'Suspend',
      danger: true,
      body: (
        <>
          <p>{user.email} will be signed out and unable to sign in or use the app until you reactivate the account.</p>
          <label className="cs-field"><span>Reason (only visible to admins)</span><textarea rows={3} value={form.reason} onChange={set('reason')} maxLength={300} /></label>
        </>
      ),
      action: () => run(() => api(`/api/admin/users/${id}/suspend`, { method: 'POST', body: { reason: form.reason } }), 'Account suspended.'),
    },
    password: {
      title: 'Reset password',
      submit: 'Set new password',
      body: (
        <>
          <p className="cs-muted">Sets a new password for {user.email}. Share it with them privately and ask them to change it from their Account page.</p>
          <label className="cs-field"><span>New password</span><input type="password" minLength={8} value={form.password} onChange={set('password')} autoComplete="new-password" /></label>
        </>
      ),
      disabled: form.password.length < 8,
      action: () => run(() => api(`/api/admin/users/${id}/password`, { method: 'POST', body: { newPassword: form.password } }), 'Password reset.'),
    },
    edit: {
      title: 'Edit details',
      submit: 'Save',
      body: (
        <>
          <label className="cs-field"><span>Name</span><input value={form.name} onChange={set('name')} maxLength={80} /></label>
          <label className="cs-field"><span>Email</span><input type="email" value={form.email} onChange={set('email')} disabled={user.isOwner} />{user.isOwner && <small>Owner emails are set in OWNER_EMAILS in backend/.env.</small>}</label>
        </>
      ),
      action: () => run(() => api(`/api/admin/users/${id}`, { method: 'PATCH', body: { name: form.name, email: form.email } }), 'Details saved.'),
    },
    delete: {
      title: 'Delete user',
      submit: 'Delete forever',
      danger: true,
      body: (
        <>
          <p>This permanently deletes <strong>{user.email}</strong>, their projects and render history. Payment records are kept (anonymised) for your accounting.</p>
          <label className="cs-field"><span>Type the email to confirm</span><input value={form.confirm} onChange={set('confirm')} autoComplete="off" /></label>
        </>
      ),
      disabled: form.confirm.trim().toLowerCase() !== user.email,
      action: () => run(() => api(`/api/admin/users/${id}`, { method: 'DELETE' }), 'User deleted.'),
    },
  };
  const config = configs[kind];

  return (
    <Modal
      title={config.title}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="cs-btn cs-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className={`cs-btn ${config.danger ? 'cs-btn-danger' : 'cs-btn-primary'}`} disabled={busy || config.disabled} onClick={config.action}>{busy ? 'Working…' : config.submit}</button>
        </>
      )}
    >
      {config.body}
      {error && <p className="cs-error-text">{error}</p>}
    </Modal>
  );
}

export default function UserDrawer({ userId, onClose, onChanged, toast }) {
  const { user: me } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('projects');
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/admin/users/${userId}`));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [userId]);

  useEffect(() => { setData(null); load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !modal) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, modal]);

  const quick = async (request, message) => {
    setBusy(true);
    try {
      await request();
      toast(message);
      await load();
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const u = data?.user;
  const isMe = u && me && String(u._id) === String(me._id);
  const locked = u && (u.isOwner || isMe);

  return (
    <div className="cs-drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="cs-drawer" aria-label="User details">
        <header className="cs-drawer-head">
          <button type="button" className="cs-icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        {error && <div className="cs-alert">{error}</div>}
        {!data && !error && <Spinner />}
        {u && (
          <div className="cs-drawer-body">
            <div className="cs-profile-head">
              <Avatar user={u} size={56} />
              <div>
                <strong>{u.name || 'No name'}</strong>
                <span>{u.email}</span>
                <div className="cs-row-badges">
                  {u.isPro ? <Badge tone="pro">Pro</Badge> : <Badge>Free</Badge>}
                  {u.isAdmin && <Badge tone="admin">{u.isOwner ? 'Owner' : 'Admin'}</Badge>}
                  {u.status === 'suspended' ? <Badge tone="danger">Suspended</Badge> : <Badge tone="ok">Active</Badge>}
                  {isMe && <Badge>You</Badge>}
                </div>
              </div>
            </div>
            {u.status === 'suspended' && <div className="cs-alert">Suspended{u.suspendedReason ? `: ${u.suspendedReason}` : '.'}</div>}

            <dl className="cs-facts cs-facts-grid">
              <div><dt>Joined</dt><dd>{formatDate(u.createdAt)}</dd></div>
              <div><dt>Last sign-in</dt><dd>{timeAgo(u.lastLoginAt)}</dd></div>
              <div><dt>Sign-in</dt><dd>{(u.authProviders || []).join(', ') || '—'}</dd></div>
              <div><dt>Pro until</dt><dd>{u.isOwner ? 'Always (owner)' : u.isPro ? (u.periodEnd ? formatDate(u.periodEnd) : 'Lifetime') : '—'}</dd></div>
            </dl>

            <div className="cs-meters cs-meters-compact">
              <Meter label="Exports this month" used={data.summary.usage.exports.used} limit={data.summary.usage.exports.limit} unlimitedLabel="Unlimited (Pro)" />
              <Meter label="Projects" used={data.summary.usage.projects.used} limit={data.summary.usage.projects.limit} unlimitedLabel="Unlimited (Pro)" />
              <Meter label="Storage" used={data.summary.usage.storage.usedBytes} limit={data.summary.usage.storage.limitBytes} format={formatBytes} unlimitedLabel="Unlimited (Pro)" />
            </div>

            <h3 className="cs-section-title">Actions</h3>
            <div className="cs-actions-grid">
              <button type="button" className="cs-btn cs-btn-primary" onClick={() => setModal('pro')} disabled={busy}>Grant Pro</button>
              <button type="button" className="cs-btn cs-btn-ghost" disabled={busy || !u.isPro || u.isOwner} onClick={() => quick(() => api(`/api/admin/users/${u._id}/pro`, { method: 'DELETE' }), 'Pro removed.')}>Remove Pro</button>
              <button type="button" className="cs-btn cs-btn-ghost" disabled={busy} onClick={() => quick(() => api(`/api/admin/users/${u._id}/reset-quota`, { method: 'POST' }), 'Export quota reset.')}>Reset export quota</button>
              {u.role === 'admin'
                ? <button type="button" className="cs-btn cs-btn-ghost" disabled={busy || locked} onClick={() => quick(() => api(`/api/admin/users/${u._id}/role`, { method: 'PATCH', body: { role: 'user' } }), 'Admin access removed.')}>Remove admin</button>
                : <button type="button" className="cs-btn cs-btn-ghost" disabled={busy || u.isOwner} onClick={() => quick(() => api(`/api/admin/users/${u._id}/role`, { method: 'PATCH', body: { role: 'admin' } }), 'User is now an admin.')}>Make admin</button>}
              <button type="button" className="cs-btn cs-btn-ghost" onClick={() => setModal('edit')} disabled={busy}>Edit details</button>
              <button type="button" className="cs-btn cs-btn-ghost" onClick={() => setModal('password')} disabled={busy}>Reset password</button>
              {u.status === 'suspended'
                ? <button type="button" className="cs-btn cs-btn-ghost" disabled={busy} onClick={() => quick(() => api(`/api/admin/users/${u._id}/unsuspend`, { method: 'POST' }), 'Account reactivated.')}>Reactivate</button>
                : <button type="button" className="cs-btn cs-btn-danger-ghost" disabled={busy || locked} onClick={() => setModal('suspend')}>Suspend</button>}
              <button type="button" className="cs-btn cs-btn-danger-ghost" disabled={busy || locked} onClick={() => setModal('delete')}>Delete user</button>
            </div>
            {locked && <p className="cs-muted">{isMe ? "You can't suspend, demote or delete your own account." : 'Owner accounts (OWNER_EMAILS) are protected from suspension, demotion and deletion.'}</p>}

            <div className="cs-tabs" role="tablist">
              {[['projects', `Projects (${data.projects.length})`], ['jobs', `Renders (${data.jobs.length})`], ['payments', `Payments (${data.payments.length})`], ['activity', 'Admin log']].map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} className={`cs-tab ${tab === id ? 'is-active' : ''}`} onClick={() => setTab(id)}>{label}</button>
              ))}
            </div>
            {tab === 'projects' && (data.projects.length === 0 ? <Empty>No saved projects.</Empty> : (
              <ul className="cs-rows">
                {data.projects.map((p) => <li key={p._id}><strong>{p.name}</strong><span>{p.type}</span><small>updated {timeAgo(p.updatedAt)}</small></li>)}
              </ul>
            ))}
            {tab === 'jobs' && (data.jobs.length === 0 ? <Empty>No renders yet.</Empty> : (
              <ul className="cs-rows">
                {data.jobs.map((j) => (
                  <li key={j._id}>
                    <strong>{j.kind}</strong>
                    <Badge tone={j.status === 'done' ? 'ok' : j.status === 'error' ? 'danger' : 'warn'}>{j.status}</Badge>
                    <small title={j.error || ''}>{j.status === 'error' ? (j.error || '').slice(0, 80) : timeAgo(j.createdAt)}</small>
                  </li>
                ))}
              </ul>
            ))}
            {tab === 'payments' && (data.payments.length === 0 ? <Empty>No payments.</Empty> : (
              <ul className="cs-rows">
                {data.payments.map((p) => <li key={p._id}><strong>{formatMoney(p.amount, p.currency)}</strong><span>{p.provider}</span><small>{formatDate(p.createdAt, true)}</small></li>)}
              </ul>
            ))}
            {tab === 'activity' && (data.actions.length === 0 ? <Empty>No admin changes to this account.</Empty> : (
              <ul className="cs-rows">
                {data.actions.map((a) => <li key={a._id}><strong>{ACTION_LABEL[a.action] || a.action}</strong><span>{a.adminEmail}</span><small>{formatDate(a.createdAt, true)}</small></li>)}
              </ul>
            ))}
          </div>
        )}
        {modal && u && (
          <ActionModal
            kind={modal}
            user={u}
            toast={toast}
            onClose={() => setModal(null)}
            onDone={(wasDeleted) => {
              setModal(null);
              onChanged();
              if (wasDeleted) onClose();
              else load();
            }}
          />
        )}
      </aside>
    </div>
  );
}

