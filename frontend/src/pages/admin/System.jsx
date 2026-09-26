import { Badge, Card, Spinner, formatDuration } from '../../components/console/ui.jsx';
import { useApi } from './useApi.js';

function Row({ label, children }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

const INTEGRATIONS = [
  ['momo', 'MTN Mobile Money'],
  ['cards', 'Card payments (Flutterwave)'],
  ['googleLogin', 'Google sign-in'],
  ['youtubeUpload', 'YouTube upload'],
];

export default function System() {
  const { data, error, reload, loading } = useApi('/api/admin/system');
  if (error) return <div className="cs-alert">{error}</div>;
  if (!data) return <Spinner />;
  const memPct = Math.round(((data.memory.systemTotalMb - data.memory.systemFreeMb) / data.memory.systemTotalMb) * 100);

  return (
    <div className="cs-grid-2">
      <Card title="Server" actions={<button type="button" className="cs-btn cs-btn-ghost cs-btn-sm" onClick={reload} disabled={loading}>Refresh</button>}>
        <dl className="cs-facts cs-facts-grid">
          <Row label="Status"><Badge tone={data.database === 'connected' ? 'ok' : 'danger'}>{data.database === 'connected' ? 'Healthy' : 'Database offline'}</Badge></Row>
          <Row label="Uptime">{formatDuration(data.uptimeSeconds)}</Row>
          <Row label="Environment">{data.environment}</Row>
          <Row label="Node.js">{data.node}</Row>
          <Row label="CPU cores">{data.cpus}</Row>
          <Row label="Platform">{data.platform}</Row>
        </dl>
      </Card>
      <Card title="Rendering">
        <dl className="cs-facts cs-facts-grid">
          <Row label="Running now">{data.render.active} of {data.render.max}</Row>
          <Row label="Waiting">{data.render.queued}</Row>
          <Row label="Video encoder">{data.exportEncoder || 'chosen on first export'}</Row>
          <Row label="Free disk">{data.disk ? `${data.disk.freeGb} GB` : '—'}</Row>
          <Row label="App media on disk">{data.disk ? `${data.disk.usedByAppGb} GB` : '—'}</Row>
          <Row label="Memory">{memPct}% used · app {data.memory.rssMb} MB</Row>
        </dl>
      </Card>
      <Card title="Integrations" subtitle="Whether credentials are set in backend/.env - the values themselves are never shown.">
        <ul className="cs-checks">
          {INTEGRATIONS.map(([id, label]) => (
            <li key={id}><span>{label}</span>{data.integrations[id] ? <Badge tone="ok">Configured</Badge> : <Badge tone="warn">Not set</Badge>}</li>
          ))}
        </ul>
      </Card>
      <Card title="Owner accounts" subtitle="OWNER_EMAILS in backend/.env - always Pro and always admin.">
        {data.owners.length === 0 ? <p className="cs-muted">None configured.</p> : (
          <ul className="cs-checks">{data.owners.map((o) => <li key={o}><span>{o}</span><Badge tone="admin">Owner</Badge></li>)}</ul>
        )}
      </Card>
    </div>
  );
}
