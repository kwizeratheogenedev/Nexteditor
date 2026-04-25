function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileSlot({ label, file, meta, buttonText, onClick, input }) {
  return (
    <div className="file-card">
      <span className="property-label">{label}</span>
      <button type="button" className="file-card-button" onClick={onClick}>{buttonText}</button>
      <div className="file-card-name">{file ? file.name : meta?.name || 'No file selected'}</div>
      {meta && !file ? <small className="file-card-meta">{`Previous: ${formatFileSize(meta.size)}`}</small> : null}
      {input}
    </div>
  );
}

function MediaPanel({
  video1,
  video1Ref,
  setVideo1,
  video2,
  video2Ref,
  setVideo2,
  video3,
  video3Ref,
  setVideo3,
  handleVideoSelect,
  audio,
  audioRef,
  handleAudioSelect,
  video1Meta,
  setVideo1Meta,
  video2Meta,
  setVideo2Meta,
  video3Meta,
  setVideo3Meta,
  audioMeta,
}) {
  return (
    <div className="mode-grid">
      <FileSlot
        label="Video Track 1"
        file={video1}
        meta={video1Meta}
        buttonText={video1 || video1Meta ? 'Replace Video' : 'Import Video'}
        onClick={() => video1Ref.current?.click()}
        input={<input type="file" accept="video/*" ref={video1Ref} onChange={(event) => handleVideoSelect(event, setVideo1, setVideo1Meta, 'Video 1')} className="sr-only-input" />}
      />
      <FileSlot
        label="Video Track 2"
        file={video2}
        meta={video2Meta}
        buttonText={video2 || video2Meta ? 'Replace Video' : 'Import Video'}
        onClick={() => video2Ref.current?.click()}
        input={<input type="file" accept="video/*" ref={video2Ref} onChange={(event) => handleVideoSelect(event, setVideo2, setVideo2Meta, 'Video 2')} className="sr-only-input" />}
      />
      <FileSlot
        label="Video Track 3"
        file={video3}
        meta={video3Meta}
        buttonText={video3 || video3Meta ? 'Replace Video' : 'Import Video'}
        onClick={() => video3Ref.current?.click()}
        input={<input type="file" accept="video/*" ref={video3Ref} onChange={(event) => handleVideoSelect(event, setVideo3, setVideo3Meta, 'Video 3')} className="sr-only-input" />}
      />
      <FileSlot
        label="Soundtrack"
        file={audio}
        meta={audioMeta}
        buttonText={audio || audioMeta ? 'Replace Audio' : 'Import Audio'}
        onClick={() => audioRef.current?.click()}
        input={<input type="file" accept="audio/*" ref={audioRef} onChange={handleAudioSelect} className="sr-only-input" />}
      />
    </div>
  );
}

export default MediaPanel;
