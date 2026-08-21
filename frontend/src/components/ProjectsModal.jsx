import { useEffect, useState } from 'react';
import { API_ENDPOINTS } from '../config.js';
import '../pages/pages.css';

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ProjectsModal({ onClose, onResume }) {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    try {
      const res = await fetch(API_ENDPOINTS.projects, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load projects.');
      setProjects(data.projects);
    } catch (err) {
      setError(err.message || 'Failed to load projects.');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleResume = async (id) => {
    setBusyId(id);
    try {
      await onResume(id);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to open project.');
      setBusyId(null);
    }
  };

  const handleDelete = async (id) => {
    setBusyId(id);
    try {
      const res = await fetch(API_ENDPOINTS.project(id), { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to delete project.');
      setProjects((prev) => prev.filter((p) => p._id !== id));
    } catch (err) {
      setError(err.message || 'Failed to delete project.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
          width: 480, maxHeight: '70vh', overflowY: 'auto', padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18 }}>My Projects</h2>
          <button type="button" onClick={onClose} style={{ background: 'none', color: 'var(--text-secondary)', fontSize: 18, cursor: 'pointer' }}>&times;</button>
        </div>

        {error && <div style={{ color: '#ff8a8a', fontSize: 13, marginBottom: 12 }}>{error}</div>}

        {!projects && !error && <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading...</div>}
        {projects && projects.length === 0 && (
          <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>No saved projects yet. Use "Save to account" in the editor to save your first one.</div>
        )}

        {projects && projects.map((project) => (
          <div key={project._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{project.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{project.type} - updated {formatDate(project.updatedAt)}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-primary" style={{ padding: '6px 14px', fontSize: 13 }} disabled={busyId === project._id} onClick={() => handleResume(project._id)}>
                Resume
              </button>
              <button type="button" className="btn btn-ghost" style={{ padding: '6px 14px', fontSize: 13 }} disabled={busyId === project._id} onClick={() => handleDelete(project._id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
