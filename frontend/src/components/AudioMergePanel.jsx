import { useRef, useState, useSyncExternalStore } from 'react';
import './LongMixPanel.css';
import './AudioMergePanel.css';
import { formatTime, planAudioMerge, planCombine, planExtend } from '../audioMerge/plan';
import { addMerge, getMerges, removeMerge, subscribeToMerges } from '../audioMerge/mergeQueue';

// Resolves 0 on a file the <audio> element can't read; the merge itself still
// gets the final say, since it can decode formats this element can't.
function probeAudioDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = document.createElement('audio');
    const finish = (duration) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(duration) ? duration : 0);
    };
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => finish(probe.duration);
    probe.onerror = () => finish(0);
    probe.src = url;
  });
}

function AudioSlot({ number, title, hint, value, onPick }) {
  return (
    <label className="audiomerge-slot">
      <input
        type="file"
        accept="audio/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onPick(file);
        }}
      />
      <span className="longmix-index">{number}</span>
      <span className="audiomerge-slot-text">
        <strong>{title}</strong>
        <small>{value ? value.file.name : hint}</small>
      </span>
      {value?.duration > 0 && <span className="longmix-duration">{formatTime(value.duration)}</span>}
      <b>{value ? 'Replace' : 'Choose audio'}</b>
    </label>
  );
}

// Everything the screen says that depends on the chosen way of making the audio.
// `second` is the second slot's title and hint; Extend has none.
const MODES = {
  eight: {
    label: 'Two audios (8:00)',
    heading: 'Make an 8-minute audio',
    about: 'The first audio plays in full. The second is cut to fill the time left, up to exactly 8:00.',
    first: ['First audio', 'Kept whole, shorter than 8:00'],
    second: ['Second audio', 'Cut from its start to fill the rest'],
    action: 'Merge audio',
    doing: 'Merging',
    done: 'Merged',
  },
  extend: {
    label: 'Extend one audio',
    heading: 'Make an 8-minute audio',
    about: 'Your audio plays in full, with a cut from its middle added to reach exactly 8:00.',
    first: ['Your audio', 'Its middle part fills the time to 8:00'],
    second: null,
    action: 'Extend audio',
    doing: 'Extending',
    done: 'Extended',
  },
  combine: {
    label: 'Combine two audios',
    heading: 'Combine two audios',
    about: 'Both audios play in full, one after the other. The new audio is as long as both together.',
    first: ['First audio', 'Plays first, in full'],
    second: ['Second audio', 'Plays right after, in full'],
    action: 'Combine audios',
    doing: 'Combining',
    done: 'Combined',
  },
};

function mergeButtonLabel(job, mode) {
  if (!job) return MODES[mode].action;
  if (job.status === 'waiting') return 'Waiting for another merge...';
  if (job.status === 'merging') return `${MODES[job.mode].doing}... ${job.progress}%`;
  if (job.status === 'encoding') return `Making the MP3... ${job.mp3Progress}%`;
  return MODES[job.mode].done;
}

function MergeRow({ job, onUseInMontage, onMergeAnother }) {
  const [chosenFormat, setFormat] = useState('wav');
  const format = job.mp3Failed ? 'wav' : chosenFormat;
  const blob = format === 'wav' ? job.wav : job.mp3;
  const downloadUrl = format === 'wav' ? job.wavUrl : job.mp3Url;
  const downloadLabel = `Download ${format.toUpperCase()}`;
  const useFile = () => onUseInMontage({ file: new File([blob], `${job.name}.${format}`, { type: blob.type }), duration: job.seconds });
  const mergeAnotherButton = onMergeAnother && <button type="button" className="longmix-build-button" onClick={onMergeAnother}>Merge another</button>;

  if (job.wavUrl) {
    const encoding = job.status === 'encoding';
    return (
      <li className="audiomerge-job">
        <div className="audiomerge-job-head">
          <strong className="audiomerge-done">{job.name}</strong>
          <button type="button" onClick={() => removeMerge(job.id)}>Remove</button>
        </div>
        <audio controls src={job.wavUrl} />
        {encoding && (
          <>
            <small>Audio ready. Making the MP3... {job.mp3Progress}%</small>
            <div className="audiomerge-bar"><span style={{ width: `${job.mp3Progress}%` }} /></div>
          </>
        )}
        {job.mp3Failed && <p className="audiomerge-error" role="alert">The MP3 could not be made, but the WAV is ready to use.</p>}
        <div className="audiomerge-format">
          <span>Format</span>
          <div className="longmix-choice-row" role="group" aria-label="Format">
            <button type="button" className={format === 'wav' ? 'is-active' : ''} aria-pressed={format === 'wav'} onClick={() => setFormat('wav')}>WAV</button>
            <button type="button" className={format === 'mp3' ? 'is-active' : ''} aria-pressed={format === 'mp3'} disabled={job.mp3Failed} onClick={() => setFormat('mp3')}>MP3</button>
          </div>
        </div>
        <button type="button" className="longmix-build-button" disabled={!blob} onClick={useFile}>
          {blob ? 'Use it in Montage' : `Making the MP3... ${job.mp3Progress}%`}
        </button>
        {downloadUrl
          ? <a className="longmix-secondary-button audiomerge-download" href={downloadUrl} download={`${job.name}.${format}`}>{downloadLabel}</a>
          : <button type="button" className="longmix-secondary-button audiomerge-download" disabled>{downloadLabel}</button>}
        {mergeAnotherButton}
      </li>
    );
  }

  return (
    <li className="audiomerge-job">
      <div className="audiomerge-job-head">
        <strong>{job.name}</strong>
        <button type="button" onClick={() => removeMerge(job.id)}>{job.status === 'error' ? 'Remove' : 'Cancel'}</button>
      </div>
      {job.status === 'error' ? (
        <p className="audiomerge-error" role="alert">{job.error}</p>
      ) : (
        <>
          <small>{job.status === 'waiting' ? 'Waiting for another merge to finish...' : `${MODES[job.mode].doing} on this device... ${job.progress}%`}</small>
          <div className="audiomerge-bar"><span style={{ width: `${job.progress}%` }} /></div>
        </>
      )}
      {mergeAnotherButton}
    </li>
  );
}

export default function AudioMergePanel({ onUseInMontage }) {
  const merges = useSyncExternalStore(subscribeToMerges, getMerges);
  const [mode, setMode] = useState('eight');
  const screen = MODES[mode];
  const [first, setFirst] = useState(null);
  const [second, setSecond] = useState(null);
  const [submittedId, setSubmittedId] = useState(null);
  // The merge started from the audios now in the slots. A failed one doesn't
  // count, so the same audios can be tried again.
  const submitted = merges.find((job) => job.id === submittedId && job.status !== 'error');

  const pick = async (file, setSlot) => {
    setSubmittedId(null);
    setSlot({ file, duration: 0 });
    const duration = await probeAudioDuration(file);
    setSlot((current) => (current?.file === file ? { file, duration } : current));
  };

  // Both two-audio modes keep the second audio when switching between them.
  const chooseMode = (next) => {
    setMode(next);
    if (!MODES[next].second) setSecond(null);
    setSubmittedId(null);
  };

  const bothReady = first?.duration && second?.duration;
  const plan = {
    eight: bothReady ? planAudioMerge(first.duration, second.duration) : null,
    extend: first?.duration ? planExtend(first.duration) : null,
    combine: bothReady ? planCombine(first.duration, second.duration) : null,
  }[mode];

  // Empties the slots for the next merge, in this same tab: earlier merges stay
  // in the list below (one still being made keeps going), so every "Use it in
  // Montage" goes to this tab's Montage. A second tab would have its own.
  const cardRef = useRef(null);
  const mergeAnother = () => {
    setFirst(null);
    setSecond(null);
    setSubmittedId(null);
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="longmix-workspace">
      <header className="longmix-heading">
        <div>
          <span className="longmix-kicker">AUDIO MERGE</span>
          <h1>{screen.heading}</h1>
          <p>{screen.about}</p>
        </div>
      </header>

      <div ref={cardRef} className="audiomerge-card longmix-card">
        <div className="audiomerge-format">
          <span>Use</span>
          <div className="longmix-choice-row" role="group" aria-label="Use">
            {Object.entries(MODES).map(([id, { label }]) => (
              <button key={id} type="button" className={mode === id ? 'is-active' : ''} aria-pressed={mode === id} onClick={() => chooseMode(id)}>{label}</button>
            ))}
          </div>
        </div>

        <AudioSlot number={1} title={screen.first[0]} hint={screen.first[1]} value={first} onPick={(file) => pick(file, setFirst)} />
        {screen.second && <AudioSlot number={2} title={screen.second[0]} hint={screen.second[1]} value={second} onPick={(file) => pick(file, setSecond)} />}

        {plan?.totalSeconds > 0 && (
          <ul className="longmix-summary audiomerge-summary">
            <li><span>First audio</span><b>{formatTime(first.duration)}</b></li>
            <li><span>Second audio</span><b>{formatTime(second.duration)}</b></li>
            <li><span>Final length</span><b>{formatTime(plan.totalSeconds)}</b></li>
          </ul>
        )}

        {plan?.addedSeconds > 0 && (
          <ul className="longmix-summary audiomerge-summary">
            <li><span>Your audio</span><b>{formatTime(first.duration)}</b></li>
            <li><span>Added from middle</span><b>{formatTime(plan.addedSeconds)}</b></li>
            <li><span>Final length</span><b>8:00</b></li>
          </ul>
        )}

        {plan?.secondSeconds > 0 && (
          <ul className="longmix-summary audiomerge-summary">
            <li><span>First audio</span><b>{formatTime(first.duration)}</b></li>
            <li><span>Used from second</span><b>{formatTime(plan.secondSeconds)}</b></li>
            <li><span>Final length</span><b>8:00</b></li>
          </ul>
        )}

        {plan?.error && <p className="audiomerge-error" role="alert">{plan.error}</p>}

        <button
          type="button"
          className="longmix-build-button"
          disabled={!first || (screen.second && !second) || Boolean(plan?.error) || Boolean(submitted)}
          onClick={() => setSubmittedId(addMerge(first.file, screen.second ? second.file : null, mode))}
        >
          {mergeButtonLabel(submitted, mode)}
        </button>

        {merges.length > 0 && (
          <ul className="audiomerge-jobs">
            {merges.map((job, index) => (
              <MergeRow key={job.id} job={job} onUseInMontage={onUseInMontage} onMergeAnother={index === 0 ? mergeAnother : null} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
