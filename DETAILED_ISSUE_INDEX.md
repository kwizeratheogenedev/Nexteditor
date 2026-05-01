# Detailed Issue Index - MERN Video Converter

## Quick Reference: Issues by File

---

## backend/server.js

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 20-21 | Hardcoded port 3000 | 🟢 Low | Config | Not Fixed |
| 21 | Single CORS origin, no allowlist | 🟡 Medium | Config | Not Fixed |
| 21-22 | Environment variables not validated | 🟡 Medium | Config | Not Fixed |
| 59-75 | Cleanup interval hardcoded to 15 mins | 🟢 Low | Config | Not Fixed |
| 59-75 | No validation that /clips and /uploads exist | 🟡 Medium | Error Handling | Partial (mkdir called) |

**Priority Actions:**
```javascript
// Line 20-21: Change from
const port = 3000;
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

// To
const port = process.env.PORT || 3000;
const ALLOWED_ORIGIN = validateCorsOrigin(process.env.CORS_ORIGIN || 'http://localhost:5173');
```

---

## backend/socket.js

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 1-17 | No message validation on socket events | 🟡 Medium | Validation | Not Fixed |
| 9-11 | Connection/disconnect logging is verbose but not concerning | 🟢 Low | Logging | OK |

**Notes:** File is relatively safe. No critical issues.

---

## backend/services/ffmpeg.js

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 57-100 | No timeout mechanism for long operations | 🔴 Critical | Performance | Not Fixed |
| 57-100 | stderr accumulation in memory (could be large) | 🟡 Medium | Performance | Not Fixed |
| 75 | No validation that ffmpeg/ffprobe installed | 🟡 Medium | Validation | Not Fixed |

**Priority Fix 1 (Timeout):**
```javascript
// Wrap runFFmpeg with timeout
export function runFFmpeg(args, options = {}) {
  const timeout = parseInt(process.env.FFMPEG_TIMEOUT_MS || 3600000);
  return Promise.race([
    _runFFmpeg(args, options),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('FFmpeg timeout')), timeout)
    )
  ]);
}
```

**Priority Fix 2 (Concurrency):**
```javascript
// Add concurrency limit
import pLimit from 'p-limit';
const limit = pLimit(2);

export function runFFmpeg(args, options = {}) {
  return limit(() => _runFFmpeg(args, options));
}
```

---

## backend/middleware/upload.js

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 1-40 | Separate multer instance from routes | 🟡 Medium | Consistency | Not Fixed |
| 13-14 | No MIME type validation for subtitles | 🟡 Medium | Validation | Partial |
| 16 | File size limit 500MB, no documentation | 🟢 Low | Documentation | Not Fixed |

**Notes:** Generally secure. MIME types checked against whitelist.

---

## backend/routes/convert.js

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 10-15 | `emitToClient()` silently fails if socket not found | 🟡 Medium | Error Handling | Not Fixed |
| 67-82 | Inconsistent handling of 3 source modes (upload/link/path) | 🔴 Critical | Security | Not Fixed |
| 86-127 | Path mode: User-provided paths used without validation | 🔴 Critical | Security | **MUST FIX** |
| 131-132 | Sequential duration probing, then parallel | 🟡 Medium | Performance | Not Fixed |
| 157-162 | Progress calculation can exceed 100% | 🟡 Medium | Logic | Not Fixed |
| 190-195 | Video links not validated before download | 🟡 Medium | Validation | Not Fixed |

**Priority Fix (Path Validation):**
```javascript
// Lines 86-127: Add path validation
const validatePath = (filePath) => {
  const safe = path.resolve(filePath);
  const dir = path.resolve(process.cwd(), 'clips');
  if (!safe.startsWith(dir)) throw new Error('Invalid path');
  if (!fs.existsSync(safe)) throw new Error('File not found');
  return safe;
};
```

**Priority Fix (Progress Calc):**
```javascript
// Line 157: Change to
const scaledPercent = Math.min(100, 10 + (i / numClips) * 30 + (progress.percent / numClips));
```

---

## backend/routes/burnSubtitles.js

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 32 | Subtitle path insufficiently escaped for ffmpeg | 🔴 Critical | Security | Not Fixed |
| 41-43 | File cleanup errors silently ignored | 🟡 Medium | Error Handling | Not Fixed |
| 48 | emitToClient could fail silently | 🟡 Medium | Error Handling | Not Fixed |

**Priority Fix (Escaping):**
```javascript
// Line 32: Change from
const subtitleFilter = `subtitles='${subPath.replace(/\\/g, '/').replace(/:/g, '\\:')}'`;

// To (safe version using JSON)
const subtitleFilter = `subtitles=${JSON.stringify(subPath)}`;

// Or better yet, use ffmpeg filter array syntax if available
```

---

## backend/routes/extractShorts.js

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 52-62 | aspectRatio not validated (no check for '9:16' or '16:9') | 🟡 Medium | Validation | Not Fixed |
| 52 | maxDuration not validated (could be 0 or negative) | 🟡 Medium | Validation | Not Fixed |
| 56 | "Video too short" check but no max length check | 🟢 Low | Validation | Partial |
| 74-75 | Potential division by zero (sourceDuration == clipDur) | 🟡 Medium | Logic | Not Fixed |
| 76 | File copied unnecessarily (source already temp file) | 🟡 Medium | Performance | Not Fixed |
| 102-113 | Temp files cleanup incomplete | 🟡 Medium | File Management | Not Fixed |

**Priority Fix (Validation):**
```javascript
// Add at start of route handler:
const maxDuration = Number.parseInt(durationSetting, 10);
const aspectRatio = req.body.aspectRatio || '9:16';

if (!Number.isFinite(maxDuration) || maxDuration <= 0) {
  return res.status(400).json({ error: 'Invalid duration' });
}
if (!['9:16', '16:9'].includes(aspectRatio)) {
  return res.status(400).json({ error: 'Invalid aspect ratio' });
}
```

---

## backend/routes/createMontage.js

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 11-25 | Duplicate multer config (also in upload.js) | 🟡 Medium | Consistency | Not Fixed |
| 56-68 | **PATH TRAVERSAL - User paths not validated** | 🔴 Critical | Security | **MUST FIX** |
| 95-96 | Large concat list built in memory | 🟡 Medium | Performance | Not Fixed |
| 127-150 | concat list file cleanup needs verification | 🟡 Medium | File Management | Partial |

**Priority Fix (Path Traversal):**
```javascript
// Add function to validate paths
const SAFE_DIRS = [
  path.resolve(__dirname, '..', 'clips'),
  path.resolve(__dirname, '..', 'uploads')
];

function validatePath(filePath) {
  const resolved = path.resolve(filePath);
  const isSafe = SAFE_DIRS.some(dir => resolved.startsWith(path.resolve(dir)));
  if (!isSafe || !fs.existsSync(resolved)) {
    throw new Error('Invalid file path');
  }
  return resolved;
}

// Then use:
if (videoPath) {
  const validPath = validatePath(videoPath);
  videoFiles.push(validPath);
}
```

---

## backend/routes/fetchUrlVideo.js

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 106 | All yt-dlp errors reported as "not installed" | 🟡 Medium | Error Handling | Not Fixed |
| 140-165 | No size limit on downloaded files | 🟡 Medium | Validation | Not Fixed |
| 172-175 | Basic URL validation only | 🟡 Medium | Validation | Partial |
| 193 | Redundant `.replace('?dl=1', '?dl=1')` | 🟢 Low | Code Quality | Not Fixed |
| 242+ | No MIME type validation of downloaded file | 🟡 Medium | Validation | Not Fixed |
| 251-270 | Detailed error messages leak system info | 🟡 Medium | Security | Not Fixed |

**Priority Fix (Error Handling):**
```javascript
// Line 106: Change from
.on('error', (err) => {
  reject(new Error(`yt-dlp not found: ...`));
});

// To
.on('error', (err) => {
  if (err.code === 'ENOENT') {
    reject(new Error('yt-dlp not installed on server'));
  } else {
    reject(new Error(`Failed to download video: ${err.message}`));
  }
});
```

**Priority Fix (File Validation):**
```javascript
// After download, before returning:
const duration = await probeDuration(outputPath);
if (!duration || !Number.isFinite(duration) || duration <= 0) {
  fs.unlinkSync(outputPath);
  throw new Error('Downloaded file is not a valid video');
}
```

---

## backend/routes/reformatShort.js

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 23-26 | resolveJob() returns path without validation | 🔴 Critical | Security | Not Fixed |
| 23-26 | No check that file still exists | 🟡 Medium | Validation | Not Fixed |

**Priority Fix (Path Validation):**
```javascript
// After resolveJob():
const originalVideo = resolveJob(jobId);
if (!originalVideo) {
  return res.status(400).json({ error: 'Unknown or expired job' });
}

// Add path validation:
const SAFE_DIRS = [
  path.resolve(process.cwd(), 'clips'),
  path.resolve(process.cwd(), 'uploads')
];

const resolved = path.resolve(originalVideo);
const isSafe = SAFE_DIRS.some(dir => resolved.startsWith(path.resolve(dir)));

if (!isSafe || !fs.existsSync(resolved)) {
  return res.status(400).json({ error: 'File not found or expired' });
}

// Then use resolved instead of originalVideo
```

---

## frontend/src/main.jsx

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 1-14 | No socket provider wrapper | 🟡 Medium | Architecture | Not Fixed |

**Priority Fix:**
```javascript
// Import SocketProvider
import { SocketProvider } from './context/SocketContext';

// Wrap App
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <SocketProvider>
        <App />
      </SocketProvider>
    </AppErrorBoundary>
  </StrictMode>,
)
```

---

## frontend/src/App.jsx

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 24-25 | BottomTimeline and UrlVideoFetcher imported but not used | 🟢 Low | Dead Code | Not Fixed |
| 40-110 | **MAJOR: Duplicate state** (video1 AND video1State, etc.) | 🔴 Critical | Architecture | **MUST FIX** |
| 45-48 | Comments acknowledge legacy state problem | 🔴 Critical | Architecture | **MUST FIX** |
| 93-102 | Manual socket creation, no context | 🟡 Medium | Architecture | Not Fixed |
| 95 | Socket stored on window.__socket global | 🔴 Critical | Architecture | **MUST FIX** |
| 160-161 | window.__socket used without null check | 🟡 Medium | Safety | Not Fixed |
| 338 | No validation of fetched duration | 🟡 Medium | Validation | Not Fixed |
| 385-391 | Network/JSON errors not specifically handled | 🟡 Medium | Error Handling | Not Fixed |
| 460-461 | Blob URL leak (no guarantee revoke called) | 🟡 Medium | Memory | Not Fixed |

**Priority Fix #1 (Consolidate State):**
Create `useMediaState.js` hook (see FIX_RECOMMENDATIONS.md)
Then replace 20+ state declarations with:
```javascript
const [video1State, setVideo1State, video1Meta, setVideo1Meta] = useMediaState(KEY_VIDEO1_META);
const [video2State, setVideo2State, video2Meta, setVideo2Meta] = useMediaState(KEY_VIDEO2_META);
const [video3State, setVideo3State, video3Meta, setVideo3Meta] = useMediaState(KEY_VIDEO3_META);
const [audioState, setAudioState, audioMeta, setAudioMeta] = useMediaState(KEY_AUDIO_META);
// ... etc
```

**Priority Fix #2 (Move Socket to Context):**
```javascript
// Remove lines 93-102 entirely
// Replace with:
import { useSocket } from './context/SocketContext';

function App() {
  const { socket, socketId } = useSocket();
  // ... rest of component
}
```

**Priority Fix #3 (Fix Blob Leaks):**
```javascript
// Around line 460, change to:
const handleShortDownload = useCallback(async (clip, index) => {
  let downloadUrl = null;
  try {
    const response = await fetch(clip.url);
    if (!response.ok) throw new Error('Failed to download');
    const blob = await response.blob();
    downloadUrl = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `NexEditor_Short_${index + 1}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    setErrorText(error.message || 'Failed to download');
  } finally {
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);  // ALWAYS revoke
    }
  }
}, []);
```

---

## frontend/src/config.js

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 1-3 | No validation of API URL | 🟡 Medium | Config | Not Fixed |
| 1-3 | Silently falls back to localhost | 🟡 Medium | Config | Not Fixed |

**Priority Fix:**
```javascript
// Add validation
const API_BASE_URL = (() => {
  const url = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  try {
    new URL(url);
    return url;
  } catch {
    console.error(`Invalid API URL: ${url}`);
    return 'http://localhost:3000';
  }
})();
```

---

## frontend/src/components/MediaPanel.jsx

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 87-90 | window.__socket could be undefined | 🟡 Medium | Safety | Not Fixed |
| 87-106 | Socket listener setup depends on undefined socket | 🟡 Medium | Safety | Not Fixed |

**Priority Fix:**
After moving to Context, use `useSocket()` instead:
```javascript
import { useSocket } from '../context/SocketContext';

function MediaFieldCard(...) {
  const { socket } = useSocket();
  
  useEffect(() => {
    if (!socket) return undefined;
    
    const handleProgress = (payload) => { ... };
    socket?.on('url-fetch-progress', handleProgress);
    
    return () => {
      socket?.off('url-fetch-progress', handleProgress);
    };
  }, [socket]);
}
```

---

## frontend/src/components/MontageTab.jsx

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 1-end | No error handling in component | 🟡 Medium | Error Handling | Not Fixed |
| 1-end | No error boundary wrapper | 🟡 Medium | Resilience | Not Fixed |

**Priority Fix:** Add error boundary wrapper:
```javascript
// In parent (CenterPanel.jsx):
<ErrorBoundary fallback={<div>Error in Montage</div>}>
  <MontageTab {...mediaProps} />
</ErrorBoundary>
```

---

## frontend/src/components/AppErrorBoundary.jsx

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 1-47 | Only top-level error boundary | 🟡 Medium | Resilience | Works as designed |
| 1-47 | One component error crashes entire app | 🟡 Medium | Resilience | Not Fixed |

**Not critical but should add section-level error boundaries**

---

## frontend/src/hooks/usePersistedState.js

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 1-47 | No issues found | 🟢 OK | - | OK |

---

## frontend/src/constants/storageKeys.js

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 1-10 | No issues found | 🟢 OK | - | OK |

---

## frontend/src/components/CenterPanel.jsx

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 1-end | No issues found | 🟢 OK | - | OK |

---

## frontend/src/components/ShortsPanel.jsx

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 1-end | No issues found | 🟢 OK | - | OK |

---

## frontend/src/components/UrlVideoFetcher.jsx

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 50-100 | Creates new socket instance on each fetch | 🟡 Medium | Architecture | Not Fixed |
| 50-100 | Should use shared socket from context | 🟡 Medium | Architecture | Not Fixed |

**Priority Fix:** Replace with context:
```javascript
import { useSocket } from '../context/SocketContext';

function UrlVideoFetcher({ ... }) {
  const { socket } = useSocket();
  
  const handleFetch = async () => {
    // Use existing socket instead of creating new one
    // socket.emit('fetch-url-video', { url, socketId: socket.id });
  };
}
```

---

## frontend/src/components/EditorPanel.jsx

| Line | Issue | Severity | Type | Status |
|------|-------|----------|------|--------|
| 1-end | No issues found | 🟢 OK | - | OK |

---

## Summary Statistics

### By Severity
- 🔴 **CRITICAL:** 6 issues (path traversal x2, state duplication, socket global, validation)
- 🟡 **MEDIUM:** 32 issues (error handling, validation, performance, architecture)
- 🟢 **LOW:** 8 issues (code quality, configuration, documentation)

### By Category
- **Security:** 6 issues (4 critical)
- **Architecture:** 8 issues (3 critical)
- **Performance:** 6 issues
- **Error Handling:** 8 issues
- **Validation:** 7 issues
- **Code Quality:** 6 issues
- **Configuration:** 4 issues

### By File
- **backend/routes/convert.js:** 5 issues
- **frontend/src/App.jsx:** 10 issues ← Most problems
- **backend/routes/createMontage.js:** 4 issues
- **backend/routes/fetchUrlVideo.js:** 6 issues
- Other files: 1-3 issues each

