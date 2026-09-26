import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import ConsoleLayout from '../components/console/ConsoleLayout.jsx';
import { Badge, useToasts } from '../components/console/ui.jsx';
import Overview from './admin/Overview.jsx';
import Users from './admin/Users.jsx';
import UserDrawer from './admin/UserDrawer.jsx';
import Payments from './admin/Payments.jsx';
import Jobs from './admin/Jobs.jsx';
import Projects from './admin/Projects.jsx';
import Activity from './admin/Activity.jsx';
import System from './admin/System.jsx';
import '../components/console/console.css';

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'users', label: 'Users', icon: 'users' },
  { id: 'payments', label: 'Payments', icon: 'payments' },
  { id: 'jobs', label: 'Renders', icon: 'jobs' },
  { id: 'projects', label: 'Projects', icon: 'projects' },
  { id: 'activity', label: 'Activity log', icon: 'activity' },
  { id: 'system', label: 'System', icon: 'system' },
];

export default function AdminPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast, toasts } = useToasts();
  const [refreshKey, setRefreshKey] = useState(0);

  const tab = SECTIONS.some((s) => s.id === searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
  const openUserId = searchParams.get('user');

  // Tab and open user live in the URL, so a refresh or a shared link lands
  // on the same view.
  const update = useCallback((changes) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const openUser = useCallback((id) => update({ user: String(id) }), [update]);
  const go = useCallback((id) => update({ tab: id, user: null }), [update]);

  if (!user?.isAdmin) {
    return (
      <div className="cs-denied">
        <h1>Admins only</h1>
        <p>Your account doesn&rsquo;t have access to the admin panel.</p>
        <Link to="/app" className="cs-btn cs-btn-primary">Back to the editor</Link>
      </div>
    );
  }

  const shared = { onOpenUser: openUser, toast };

  return (
    <ConsoleLayout title="Admin" badge={<Badge tone="admin">Admin</Badge>} sections={SECTIONS} active={tab} onSelect={go}>
      {tab === 'overview' && <Overview {...shared} onGo={go} />}
      {tab === 'users' && <Users {...shared} refreshKey={refreshKey} />}
      {tab === 'payments' && <Payments {...shared} />}
      {tab === 'jobs' && <Jobs {...shared} />}
      {tab === 'projects' && <Projects {...shared} />}
      {tab === 'activity' && <Activity {...shared} />}
      {tab === 'system' && <System />}
      {openUserId && (
        <UserDrawer
          userId={openUserId}
          toast={toast}
          onClose={() => update({ user: null })}
          onChanged={() => setRefreshKey((k) => k + 1)}
        />
      )}
      {toasts}
    </ConsoleLayout>
  );
}
