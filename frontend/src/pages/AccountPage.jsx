import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { API_ENDPOINTS } from '../config.js';
import { useAuth } from '../context/AuthContext.jsx';
import ConsoleLayout from '../components/console/ConsoleLayout.jsx';
import {
  Avatar, Badge, Card, Empty, Meter, Modal, Spinner,
  formatBytes, formatDate, formatMoney, timeAgo, useToasts,
} from '../components/console/ui.jsx';
import '../components/console/console.css';

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: 'profile' },
  { id: 'plan', label: 'Plan & billing', icon: 'plan' },
  { id: 'usage', label: 'Usage', icon: 'usage' },
  { id: 'security', label: 'Security', icon: 'security' },
  { id: 'connected', label: 'Connected apps', icon: 'connected' },
  { id: 'danger', label: 'Delete account', icon: 'danger', tone: 'danger' },
];

const PROVIDER_LABEL = { momo: 'MTN MoMo', card: 'Card', manual: 'Manual' };

function ProfileSection({ data, onSaved, toast }) {
  const [name, setName] = useState(data.user.name || '');
  const [saving, setSaving] = useState(false);
  const dirty = name.trim() !== (data.user.name || '');

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/api/account/profile', { method: 'PATCH', body: { name } });
      toast('Profile saved.');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Profile" subtitle="How you appear in NexEditor.">
      <div className="cs-profile-head">
        <Avatar user={data.user} size={64} />
        <div>
          <strong>{data.user.name || 'No name yet'}</strong>
          <span>{data.user.email}</span>
          <div className="cs-row-badges">
            {(data.user.authProviders || []).map((p) => <Badge key={p}>{p === 'google' ? 'Google sign-in' : 'Email & password'}</Badge>)}
            {data.user.isAdmin && <Badge tone="admin">Admin</Badge>}
          </div>
        </div>
      </div>
      <form className="cs-form" onSubmit={save}>
        <label className="cs-field">
          <span>Display name</span>
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </label>
        <label className="cs-field">
          <span>Email</span>
          <input value={data.user.email} disabled />
          <small>Contact support to change the email on your account.</small>
        </label>
        <div className="cs-form-actions">
          <button type="submit" className="cs-btn cs-btn-primary" disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
      <dl className="cs-facts">
        <div><dt>Member since</dt><dd>{formatDate(data.user.createdAt)}</dd></div>
        <div><dt>Last sign-in</dt><dd>{timeAgo(data.user.lastLoginAt)}</dd></div>
      </dl>
    </Card>
  );
}

function PlanSection({ data }) {
  const [payments, setPayments] = useState(null);
  useEffect(() => {
    api('/api/account/payments').then((r) => setPayments(r.payments)).catch(() => setPayments([]));
  }, []);
  const { plan } = data;

  let status;
  if (plan.isOwner) status = 'Owner account - Pro features are always on.';
  else if (plan.isPro && plan.lifetime) status = 'Lifetime Pro - no renewal needed.';
  else if (plan.isPro) status = `Pro until ${formatDate(plan.periodEnd)} · ${plan.daysLeft} day${plan.daysLeft === 1 ? '' : 's'} left`;
  else status = 'Free plan - upgrade for unlimited exports, projects and storage.';

  const expiringSoon = plan.isPro && !plan.lifetime && plan.daysLeft !== null && plan.daysLeft <= 5;

  return (
    <>
      <Card title="Plan & billing" subtitle="Your subscription and payments.">
        <div className={`cs-plan ${plan.isPro ? 'is-pro' : ''}`}>
          <div>
            <span className="cs-plan-label">Current plan</span>
            <strong className="cs-plan-name">{plan.isPro ? 'NexEditor Pro' : 'NexEditor Free'}</strong>
            <p>{status}</p>
            {expiringSoon && <p className="cs-warn-text">Your Pro time is almost over - renew to keep Pro features.</p>}
          </div>
          {!plan.isOwner && !plan.lifetime && (
            <Link to="/pricing" className="cs-btn cs-btn-primary">{plan.isPro ? 'Add 30 days' : 'Upgrade to Pro'}</Link>
          )}
        </div>
        <p className="cs-muted">Pro is paid per 30 days with MTN Mobile Money or card. Paying again before it ends adds 30 more days on top - nothing renews automatically.</p>
      </Card>
      <Card title="Payment history">
        {payments === null ? <Spinner /> : payments.length === 0 ? <Empty>No payments yet.</Empty> : (
          <div className="cs-table-wrap">
            <table className="cs-table">
              <thead><tr><th>Date</th><th>Method</th><th>Amount</th><th>Pro until</th><th>Status</th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p._id}>
                    <td>{formatDate(p.createdAt, true)}</td>
                    <td>{PROVIDER_LABEL[p.provider] || p.provider}</td>
                    <td>{formatMoney(p.amount, p.currency)}</td>
                    <td>{formatDate(p.periodEnd)}</td>
                    <td><Badge tone={p.status === 'successful' ? 'ok' : 'warn'}>{p.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function UsageSection({ data }) {
  const { usage, plan } = data;
  return (
    <Card title="Usage" subtitle={plan.isPro ? 'Pro has no limits - here is what you have used.' : 'What you have used against the free plan limits.'}>
      <div className="cs-meters">
        <Meter label="Exports this month" used={usage.exports.used} limit={usage.exports.limit} hint={`Resets ${formatDate(usage.exports.resetsAt)}`} />
        <Meter label="Saved projects" used={usage.projects.used} limit={usage.projects.limit} />
        <Meter label="Export storage" used={usage.storage.usedBytes} limit={usage.storage.limitBytes} format={formatBytes} />
      </div>
      <dl className="cs-facts">
        <div><dt>Longest export</dt><dd>{usage.exportMaxSeconds ? `${Math.round(usage.exportMaxSeconds / 60)} minutes` : 'Unlimited'}</dd></div>
        <div><dt>Watermark</dt><dd>{plan.isPro ? 'None' : 'On free exports'}</dd></div>
      </dl>
      {!plan.isPro && <Link to="/pricing" className="cs-btn cs-btn-primary">Remove limits with Pro</Link>}
    </Card>
  );
}

function SecuritySection({ data, toast, onSaved }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const mismatch = form.confirm && form.next !== form.confirm;

  const submit = async (e) => {
    e.preventDefault();
    if (form.next !== form.confirm) return;
    setSaving(true);
    try {
      await api('/api/account/password', { method: 'POST', body: { currentPassword: form.current, newPassword: form.next } });
      setForm({ current: '', next: '', confirm: '' });
      toast(data.hasPassword ? 'Password changed.' : 'Password set - you can now sign in with email and password.');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card title={data.hasPassword ? 'Change password' : 'Set a password'} subtitle={data.hasPassword ? 'Use at least 8 characters. A long phrase is stronger than a short, complex one.' : 'You sign in with Google. Set a password to also sign in with your email.'}>
        <form className="cs-form" onSubmit={submit}>
          {data.hasPassword && (
            <label className="cs-field">
              <span>Current password</span>
              <input type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} required />
            </label>
          )}
          <label className="cs-field">
            <span>New password</span>
            <input type="password" autoComplete="new-password" minLength={8} value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} required />
          </label>
          <label className="cs-field">
            <span>Confirm new password</span>
            <input type="password" autoComplete="new-password" minLength={8} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required aria-invalid={mismatch || undefined} />
            {mismatch && <small className="cs-error-text">The passwords don't match.</small>}
          </label>
          <div className="cs-form-actions">
            <button type="submit" className="cs-btn cs-btn-primary" disabled={saving || mismatch || form.next.length < 8}>{saving ? 'Saving…' : data.hasPassword ? 'Change password' : 'Set password'}</button>
          </div>
        </form>
      </Card>
      <Card title="Sessions" subtitle="Signed in on this device.">
        <button type="button" className="cs-btn cs-btn-ghost" onClick={async () => { await logout(); navigate('/login'); }}>Log out</button>
      </Card>
    </>
  );
}

function ConnectedSection({ data, toast, onSaved }) {
  const [busy, setBusy] = useState(false);
  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await fetch(API_ENDPOINTS.youtubeAuthDisconnect, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Could not disconnect YouTube.');
      toast('YouTube disconnected.');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Connected apps" subtitle="Services NexEditor can publish to on your behalf.">
      <div className="cs-connection">
        <div className="cs-connection-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22"><path fill="#ff0033" d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8z" /><path fill="#fff" d="M9.8 15.1V8.9l5.4 3.1z" /></svg>
        </div>
        <div className="cs-connection-text">
          <strong>YouTube</strong>
          <span>{data.youtube.connected ? `Connected${data.youtube.channelTitle ? ` as ${data.youtube.channelTitle}` : ''}` : 'Not connected - connect it from the export dialog in the editor.'}</span>
        </div>
        {data.youtube.connected && <button type="button" className="cs-btn cs-btn-ghost" disabled={busy} onClick={disconnect}>Disconnect</button>}
      </div>
    </Card>
  );
}

function DangerSection({ data }) {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const confirmDelete = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/api/account', { method: 'DELETE', body: data.hasPassword ? { password: value } : { confirm: value } });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Card title="Delete account" subtitle="Permanently remove your account and everything in it." className="cs-card-danger">
      <ul className="cs-list">
        <li>All your saved projects and render history are deleted.</li>
        <li>Any Pro time you have left is lost - it can't be refunded or moved.</li>
        <li>This can't be undone.</li>
      </ul>
      <button type="button" className="cs-btn cs-btn-danger" onClick={() => setOpen(true)}>Delete my account</button>
      {open && (
        <Modal
          title="Delete your account?"
          onClose={() => { setOpen(false); setValue(''); setError(''); }}
          footer={(
            <>
              <button type="button" className="cs-btn cs-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="cs-btn cs-btn-danger" disabled={busy || !value} onClick={confirmDelete}>{busy ? 'Deleting…' : 'Delete forever'}</button>
            </>
          )}
        >
          <p>This permanently deletes <strong>{data.user.email}</strong> and all of its projects.</p>
          <label className="cs-field">
            <span>{data.hasPassword ? 'Enter your password to confirm' : 'Type DELETE to confirm'}</span>
            <input type={data.hasPassword ? 'password' : 'text'} value={value} onChange={(e) => setValue(e.target.value)} autoComplete={data.hasPassword ? 'current-password' : 'off'} />
          </label>
          {error && <p className="cs-error-text">{error}</p>}
        </Modal>
      )}
    </Card>
  );
}

export default function AccountPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const active = SECTIONS.some((s) => s.id === searchParams.get('tab')) ? searchParams.get('tab') : 'profile';
  const { refresh: refreshAuth } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const { toast, toasts } = useToasts();

  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    api('/api/account')
      .then((result) => { if (alive) { setData(result); setError(''); } })
      .catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [version]);

  const onSaved = useCallback(() => { setVersion((v) => v + 1); refreshAuth(); }, [refreshAuth]);
  const select = (id) => setSearchParams({ tab: id }, { replace: true });

  return (
    <ConsoleLayout
      title="Account"
      badge={data ? <Badge tone={data.plan.isPro ? 'pro' : 'neutral'}>{data.plan.isPro ? 'Pro' : 'Free'}</Badge> : null}
      sections={SECTIONS}
      active={active}
      onSelect={select}
    >
      {error && <div className="cs-alert">{error}</div>}
      {!data && !error && <Spinner />}
      {data && (
        <div className="cs-stack">
          {active === 'profile' && <ProfileSection data={data} onSaved={onSaved} toast={toast} />}
          {active === 'plan' && <PlanSection data={data} />}
          {active === 'usage' && <UsageSection data={data} />}
          {active === 'security' && <SecuritySection data={data} toast={toast} onSaved={onSaved} />}
          {active === 'connected' && <ConnectedSection data={data} toast={toast} onSaved={onSaved} />}
          {active === 'danger' && <DangerSection data={data} />}
        </div>
      )}
      {toasts}
    </ConsoleLayout>
  );
}
