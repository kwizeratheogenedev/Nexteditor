import { useEffect, useRef, useState } from 'react';
import './LongMixPanel.css';
import './AudioMergePanel.css';
import API_BASE_URL, { API_ENDPOINTS } from '../config';

const TARGET_SECONDS = 8 * 60;

function formatTime(seconds) {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// Resolves 0 on a file the browser can't read; the server still gets the
// final say, since it can decode more formats than an <audio> element can.
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

// What would stop these two from making 8 minutes (same rules as the server's
// services/audioMerge.js), so the user finds out before uploading anything.
function findProblem(first, second) {
  if (!first?.duration || !second?.duration) return '';
  if (first.duration >= TARGET_SECONDS) return `The first audio is ${formatTime(first.duration)}, so there is no room left for the second one. It must be shorter than 8:00.`;
  const remaining = TARGET_SECONDS - first.duration;
  if (second.duration < remaining) return `Together these audios are only ${formatTime(first.duration + second.duration)}. The second audio must be at least ${formatTime(remaining)} to reach 8:00.`;
  return '';
}

function outputName(first) {
  const base = first.file.name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim() || 'audio';
  return `${base}-merge-8min`;
}

function AudioSlot({ number, title, hint, value, onPick, disabled }) {
  return (
    <label className={`audiomerge-slot ${disabled ? 'is-disabled' : ''}`}>
      <input
        type="file"
        accept="audio/*"
        disabled={disabled}
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

export default function AudioMergePanel({ result, onResult, onUseInMontage }) {
  const [first, setFirst] = useState(null);
  const [second, setSecond] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const requestRef = useRef(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  const sendToMontage = async () => {
    setImporting(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/clips/${result.mp3}`);
      if (!response.ok) throw new Error('missing');
      const file = new File([await response.blob()], `${result.name}.mp3`, { type: 'audio/mpeg' });
      onUseInMontage({ file, duration: TARGET_SECONDS });
    } catch {
      setError('This audio is no longer on the server. Please merge the audios again.');
      setImporting(false);
    }
  };

  const pick = async (file, setSlot) => {
    setError('');
    onResult(null);
    setSlot({ file, duration: 0 });
    const duration = await probeAudioDuration(file);
    setSlot((current) => (current?.file === file ? { file, duration } : current));
  };

  const mergeAnother = () => {
    setFirst(null);
    setSecond(null);
    setError('');
    onResult(null);
  };

  const problem = findProblem(first, second);
  const secondUsed = first?.duration && second?.duration && !problem ? TARGET_SECONDS - first.duration : 0;

  const merge = () => {
    const formData = new FormData();
    formData.append('first', first.file);
    formData.append('second', second.file);

    setBusy(true);
    setError('');
    onResult(null);
    setStatus('Uploading 0%');

    const request = new XMLHttpRequest();
    requestRef.current = request;
    request.open('POST', API_ENDPOINTS.mergeAudio);
    request.withCredentials = true;
    request.responseType = 'json';
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setStatus(`Uploading ${Math.round((event.loaded / event.total) * 100)}%`);
    };
    request.upload.onload = () => setStatus('Merging your audio...');
    request.onload = () => {
      setBusy(false);
      if (request.status >= 200 && request.status < 300 && request.response?.mp3) {
        onResult({ ...request.response, name: outputName(first) });
        return;
      }
      setError(request.response?.error || 'These audios could not be merged. Please try again.');
    };
    request.onerror = () => {
      setBusy(false);
      setError('The connection was lost. Please try again.');
    };
    request.send(formData);
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
        <AudioSlot number={1} title="First audio" hint="Kept whole, shorter than 8:00" value={first} onPick={(file) => pick(file, setFirst)} disabled={busy} />
        <AudioSlot number={2} title="Second audio" hint="Cut from its start to fill the rest" value={second} onPick={(file) => pick(file, setSecond)} disabled={busy} />

        {secondUsed > 0 && (
          <ul className="longmix-summary audiomerge-summary">
            <li><span>First audio</span><b>{formatTime(first.duration)}</b></li>
            <li><span>Used from second</span><b>{formatTime(secondUsed)}</b></li>
            <li><span>Final length</span><b>8:00</b></li>
          </ul>
        )}

        {(problem || error) && <p className="audiomerge-error" role="alert">{problem || error}</p>}

        <button type="button" className="longmix-build-button" disabled={!first || !second || Boolean(problem) || busy} onClick={merge}>
          {busy ? status : 'Merge audio'}
        </button>

        {result && (
          <div className="audiomerge-result">
            <strong>Your 8-minute audio is ready</strong>
            <audio controls src={`${API_BASE_URL}/clips/${result.mp3}`} />
            <button type="button" className="longmix-build-button" disabled={importing} onClick={sendToMontage}>
              {importing ? 'Opening Montage...' : 'Use it in Montage'}
            </button>
            <div className="audiomerge-downloads">
              <a className="longmix-secondary-button" href={API_ENDPOINTS.mergeAudioDownload(result.mp3, result.name)}>Download MP3</a>
              <a className="longmix-secondary-button" href={API_ENDPOINTS.mergeAudioDownload(result.wav, result.name)}>Download WAV</a>
            </div>
            <button type="button" className="longmix-secondary-button" onClick={mergeAnother}>Merge another</button>
          </div>
        )}
      </div>
    </div>
  );
}
