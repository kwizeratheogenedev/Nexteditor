import { useState, useSyncExternalStore } from 'react';
import './LongMixPanel.css';
import './AudioMergePanel.css';
import { formatTime, planAudioMerge, TARGET_SECONDS } from '../audioMerge/plan';
import { addMerge, clearMerges, getMerges, hasRunningMerge, removeMerge, subscribeToMerges } from '../audioMerge/mergeQueue';

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

function mergeButtonLabel(job) {
  if (!job) return 'Merge audio';
  if (job.status === 'waiting') return 'Waiting for another merge...';
  if (job.status === 'merging') return `Merging... ${job.progress}%`;
  if (job.status === 'encoding') return `Making the MP3... ${job.mp3Progress}%`;
  return 'Merged';
}

function MergeRow({ job, onUseInMontage, onMergeAnother }) {
  const [format, setFormat] = useState('wav');
  const blob = format === 'wav' ? job.wav : job.mp3;
  const useFile = () => onUseInMontage({ file: new File([blob], `${job.name}.${format}`, { type: blob.type }), duration: TARGET_SECONDS });
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
          <span>Format for Montage</span>
          <div className="longmix-choice-row" role="group" aria-label="Format for Montage">
            <button type="button" className={format === 'wav' ? 'is-active' : ''} aria-pressed={format === 'wav'} onClick={() => setFormat('wav')}>WAV</button>
            <button type="button" className={format === 'mp3' ? 'is-active' : ''} aria-pressed={format === 'mp3'} disabled={job.mp3Failed} onClick={() => setFormat('mp3')}>MP3</button>
          </div>
        </div>
        <button type="button" className="longmix-build-button" disabled={!blob} onClick={useFile}>
          {blob ? 'Use it in Montage' : `Making the MP3... ${job.mp3Progress}%`}
        </button>
        <div className="audiomerge-downloads">
          {job.mp3Url
            ? <a className="longmix-secondary-button" href={job.mp3Url} download={`${job.name}.mp3`}>Download MP3</a>
            : <button type="button" className="longmix-secondary-button" disabled>Download MP3</button>}
          <a className="longmix-secondary-button" href={job.wavUrl} download={`${job.name}.wav`}>Download WAV</a>
        </div>
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
          <small>{job.status === 'waiting' ? 'Waiting for another merge to finish...' : `Merging on this device... ${job.progress}%`}</small>
          <div className="audiomerge-bar"><span style={{ width: `${job.progress}%` }} /></div>
        </>
      )}
      {mergeAnotherButton}
    </li>
  );
}

export default function AudioMergePanel({ onUseInMontage }) {
  const merges = useSyncExternalStore(subscribeToMerges, getMerges);
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

  const plan = first?.duration && second?.duration ? planAudioMerge(first.duration, second.duration) : null;

  // Starts over on a clean screen, finished merges included. If one is still
  // being made, a new browser tab starts over instead, so it isn't disturbed:
  // each tab has its own merge list (see App.jsx's `audioMerge` URL param).
  const mergeAnother = () => {
    if (hasRunningMerge()) {
      const url = new URL(window.location.href);
      url.searchParams.set('audioMerge', 'new');
      window.open(url.toString(), '_blank', 'noopener');
      return;
    }
    clearMerges();
    setFirst(null);
    setSecond(null);
    setSubmittedId(null);
  };

  return (
    <div className="longmix-workspace">
      <header className="longmix-heading">
        <div>
          <span className="longmix-kicker">AUDIO MERGE</span>
          <h1>Make an 8-minute audio</h1>
          <p>The first audio plays in full. The second is cut to fill the time left, up to exactly 8:00.</p>
        </div>
      </header>

      <div className="audiomerge-card longmix-card">
        <AudioSlot number={1} title="First audio" hint="Kept whole, shorter than 8:00" value={first} onPick={(file) => pick(file, setFirst)} />
        <AudioSlot number={2} title="Second audio" hint="Cut from its start to fill the rest" value={second} onPick={(file) => pick(file, setSecond)} />

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
          disabled={!first || !second || Boolean(plan?.error) || Boolean(submitted)}
          onClick={() => setSubmittedId(addMerge(first.file, second.file))}
        >
          {mergeButtonLabel(submitted)}
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
