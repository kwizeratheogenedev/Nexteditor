import { useState } from 'react';

function PropertyRow({ label, value, children }) {
  return (
    <div className="property-row">
      <div className="property-row-head">
        <span className="property-label">{label}</span>
        <span className="property-value">{value}</span>
      </div>
      {children}
    </div>
  );
}

function RightPanel() {
  const [activePanel, setActivePanel] = useState('basic');
  const [basic, setBasic] = useState({ scale: 100, opacity: 100, rotation: 0, x: 0, y: 0, flipH: false, flipV: false });
  const [color, setColor] = useState({ brightness: 0, contrast: 0, saturation: 0, temperature: 0 });
  const [speed, setSpeed] = useState(1);
  const [audio, setAudio] = useState({ volume: 100, fadeIn: 0, fadeOut: 0, muted: false });

  return (
    <aside className="right-panel">
      <div className="inspector-tabs">
        {[
          ['basic', 'Basic'],
          ['color', 'Color'],
          ['speed', 'Speed'],
          ['audio', 'Audio'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`inspector-tab ${activePanel === id ? 'is-active' : ''}`}
            onClick={() => setActivePanel(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="inspector-body">
        {activePanel === 'basic' && (
          <>
            <PropertyRow label="Scale" value={`${basic.scale}%`}>
              <input type="range" min="10" max="200" value={basic.scale} onChange={(event) => setBasic({ ...basic, scale: Number(event.target.value) })} />
            </PropertyRow>
            <PropertyRow label="Opacity" value={`${basic.opacity}%`}>
              <input type="range" min="0" max="100" value={basic.opacity} onChange={(event) => setBasic({ ...basic, opacity: Number(event.target.value) })} />
            </PropertyRow>
            <PropertyRow label="Rotation" value={`${basic.rotation}°`}>
              <input type="range" min="-180" max="180" value={basic.rotation} onChange={(event) => setBasic({ ...basic, rotation: Number(event.target.value) })} />
            </PropertyRow>
            <PropertyRow label="Position X" value={`${basic.x}`}>
              <input type="range" min="-100" max="100" value={basic.x} onChange={(event) => setBasic({ ...basic, x: Number(event.target.value) })} />
            </PropertyRow>
            <PropertyRow label="Position Y" value={`${basic.y}`}>
              <input type="range" min="-100" max="100" value={basic.y} onChange={(event) => setBasic({ ...basic, y: Number(event.target.value) })} />
            </PropertyRow>
            <PropertyRow label="Flip" value="">
              <div className="toggle-pair">
                <button type="button" className={`mini-toggle ${basic.flipH ? 'is-active' : ''}`} onClick={() => setBasic({ ...basic, flipH: !basic.flipH })}>↔ H</button>
                <button type="button" className={`mini-toggle ${basic.flipV ? 'is-active' : ''}`} onClick={() => setBasic({ ...basic, flipV: !basic.flipV })}>↕ V</button>
              </div>
            </PropertyRow>
          </>
        )}

        {activePanel === 'color' && (
          <>
            <PropertyRow label="Brightness" value={`${color.brightness}`}>
              <input type="range" min="-100" max="100" value={color.brightness} onChange={(event) => setColor({ ...color, brightness: Number(event.target.value) })} />
            </PropertyRow>
            <PropertyRow label="Contrast" value={`${color.contrast}`}>
              <input type="range" min="-100" max="100" value={color.contrast} onChange={(event) => setColor({ ...color, contrast: Number(event.target.value) })} />
            </PropertyRow>
            <PropertyRow label="Saturation" value={`${color.saturation}`}>
              <input type="range" min="-100" max="100" value={color.saturation} onChange={(event) => setColor({ ...color, saturation: Number(event.target.value) })} />
            </PropertyRow>
            <PropertyRow label="Temperature" value={`${color.temperature}`}>
              <input type="range" min="-100" max="100" value={color.temperature} onChange={(event) => setColor({ ...color, temperature: Number(event.target.value) })} />
            </PropertyRow>
            <PropertyRow label="Presets" value="">
              <div className="swatch-row">
                {['var(--bg-hover)', 'var(--bg-active)', 'var(--accent-dim)', 'var(--clip-video-border)', 'var(--clip-text-border)'].map((background) => (
                  <span key={background} className="color-swatch" style={{ background }} />
                ))}
              </div>
            </PropertyRow>
          </>
        )}

        {activePanel === 'speed' && (
          <>
            <PropertyRow label="Speed" value={`${speed.toFixed(1)}×`}>
              <input type="range" min="0.1" max="4" step="0.1" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
            </PropertyRow>
            <div className="toggle-pair">
              {['1', '2', '4'].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`mini-toggle ${Number(value) === Math.round(speed) ? 'is-active' : ''}`}
                  onClick={() => setSpeed(Number(value))}
                >
                  {value === '1' ? 'Normal' : `${value}×`}
                </button>
              ))}
            </div>
          </>
        )}

        {activePanel === 'audio' && (
          <>
            <PropertyRow label="Volume" value={`${audio.volume}%`}>
              <input type="range" min="0" max="200" value={audio.volume} onChange={(event) => setAudio({ ...audio, volume: Number(event.target.value) })} />
            </PropertyRow>
            <PropertyRow label="Fade In" value={`${audio.fadeIn.toFixed(1)}s`}>
              <input type="range" min="0" max="3" step="0.1" value={audio.fadeIn} onChange={(event) => setAudio({ ...audio, fadeIn: Number(event.target.value) })} />
            </PropertyRow>
            <PropertyRow label="Fade Out" value={`${audio.fadeOut.toFixed(1)}s`}>
              <input type="range" min="0" max="3" step="0.1" value={audio.fadeOut} onChange={(event) => setAudio({ ...audio, fadeOut: Number(event.target.value) })} />
            </PropertyRow>
            <PropertyRow label="Mute" value="">
              <button type="button" className={`mini-toggle ${audio.muted ? 'is-active' : ''}`} onClick={() => setAudio({ ...audio, muted: !audio.muted })}>
                {audio.muted ? 'Muted' : 'Mute'}
              </button>
            </PropertyRow>
          </>
        )}
      </div>
    </aside>
  );
}

export default RightPanel;
