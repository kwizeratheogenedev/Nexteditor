import { useAuth } from '../context/AuthContext.jsx';
import { ASPECT_RATIOS, RESOLUTIONS, FPS_OPTIONS, PLATFORM_PRESETS, buildCanvasSize } from '../timeline/canvasPresets';

// Anchored popover for the Editor tab's canvas settings (aspect ratio,
// resolution, fps, and one-click platform presets) - wired up to the
// previously-dead "Canvas settings" button in EditorPanel.jsx. Every control
// here just calls onChange with a fully-resolved canvasSize object (see
// canvasPresets.js's buildCanvasSize) - the platform-preset buttons and the
// manual aspect/resolution/fps controls are indistinguishable to the rest of
// the app, they just set the same state.
function CanvasSettingsMenu({ canvasSize, onChange, onClose }) {
  const { user } = useAuth();
  const isPro = user?.subscription?.plan === 'pro';

  const applyPreset = (aspectRatioId, resolutionId, fps) => {
    onChange(buildCanvasSize({ aspectRatioId, resolutionId, fps }));
  };

  return (
    <div
      className="canvas-settings-menu"
      style={{
        position: 'absolute', top: 40, right: 8, zIndex: 20, width: 260,
        background: 'var(--panel-surface-1)', border: '1px solid var(--panel-border)', borderRadius: 10,
        boxShadow: '0 8px 28px rgba(0,0,0,.5)', padding: 14, color: 'var(--panel-text-1)',
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>Canvas settings</strong>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--panel-text-2)', cursor: 'pointer', fontSize: 14 }}>×</button>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ color: 'var(--panel-text-2)', marginBottom: 6 }}>Platform</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {PLATFORM_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset.aspectRatioId, preset.resolutionId, preset.fps)}
              style={{
                textAlign: 'left', padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
                background: canvasSize.aspectRatioId === preset.aspectRatioId && canvasSize.resolutionId === preset.resolutionId ? 'rgba(124,58,237,.25)' : 'transparent',
                border: '1px solid transparent', color: 'var(--panel-text-1)',
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ color: 'var(--panel-text-2)', marginBottom: 6 }}>Aspect ratio</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {ASPECT_RATIOS.map((aspect) => (
            <button
              key={aspect.id}
              type="button"
              onClick={() => applyPreset(aspect.id, canvasSize.resolutionId || '1080p', canvasSize.fps || 30)}
              style={{
                padding: '6px 8px', borderRadius: 6, cursor: 'pointer', textAlign: 'center',
                background: canvasSize.aspectRatioId === aspect.id ? 'var(--accent-violet)' : 'var(--panel-surface-3)',
                border: '1px solid var(--panel-border)',
                color: canvasSize.aspectRatioId === aspect.id ? '#fff' : 'var(--panel-text-1)',
              }}
            >
              {aspect.label} ({aspect.id})
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ color: 'var(--panel-text-2)', marginBottom: 6 }}>Resolution</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {RESOLUTIONS.map((resolution) => {
            const locked = resolution.pro && !isPro;
            return (
              <button
                key={resolution.id}
                type="button"
                disabled={locked}
                title={locked ? 'Pro feature - upgrade to export in 4K' : undefined}
                onClick={() => applyPreset(canvasSize.aspectRatioId || '16:9', resolution.id, canvasSize.fps || 30)}
                style={{
                  display: 'flex', justifyContent: 'space-between', padding: '6px 8px', borderRadius: 6,
                  cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.5 : 1,
                  background: canvasSize.resolutionId === resolution.id ? 'rgba(124,58,237,.25)' : 'transparent',
                  border: '1px solid transparent', color: 'var(--panel-text-1)',
                }}
              >
                <span>{resolution.label}</span>
                {locked && <span style={{ color: 'var(--panel-text-2)' }}>Pro</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ color: 'var(--panel-text-2)', marginBottom: 6 }}>Frame rate</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {FPS_OPTIONS.map((fps) => (
            <button
              key={fps}
              type="button"
              onClick={() => applyPreset(canvasSize.aspectRatioId || '16:9', canvasSize.resolutionId || '1080p', fps)}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 6, cursor: 'pointer', textAlign: 'center',
                background: canvasSize.fps === fps ? 'var(--accent-violet)' : 'var(--panel-surface-3)',
                border: '1px solid var(--panel-border)',
                color: canvasSize.fps === fps ? '#fff' : 'var(--panel-text-1)',
              }}
            >
              {fps}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default CanvasSettingsMenu;
