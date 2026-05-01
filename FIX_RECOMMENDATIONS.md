# MERN Video Converter - Fix Recommendations with Code Examples

## Quick Fix Priority List

### CRITICAL - Security Issues (Fix Immediately)

#### 1. Path Traversal Vulnerability in createMontage.js

**Location:** `backend/routes/createMontage.js`, lines 56-68

**Issue:** User can specify arbitrary file paths through request body

**Current Code:**
```javascript
// Collect video files
const videoFiles = [];

// Handle uploaded files
for (let i = 1; i <= 3; i++) {
  const videoFile = req.files?.find(f => f.fieldname === `video${i}`);
  const videoPath = req.body[`video${i}Path`];  // ← User-controlled!
  
  if (videoFile || videoPath) {
    const sourcePath = getFileSource(videoFile, videoPath);
    if (sourcePath) {
      videoFiles.push(sourcePath);  // ← Used directly without validation
    }
  }
}
```

**Attack Example:**
```
POST /api/create-montage
Body:
{
  "video1Path": "/etc/passwd",
  "video2Path": "/etc/shadow",
  "video3Path": "../../sensitive/file.mp4"
}
```

**Fixed Code:**
```javascript
const path = require('path');
const fs = require('fs');

const SAFE_DIR = path.resolve(__dirname, '..', 'clips');
const UPLOADS_DIR = path.resolve(__dirname, '..', 'uploads');
const SAFE_DIRS = [SAFE_DIR, UPLOADS_DIR];

function validateFilePath(filePath) {
  // Resolve to absolute path
  const resolved = path.resolve(filePath);
  
  // Check if resolved path is within allowed directories
  const isSafe = SAFE_DIRS.some(dir => 
    resolved.startsWith(path.resolve(dir))
  );
  
  if (!isSafe) {
    throw new Error(`Access denied: ${filePath}`);
  }
  
  // Check file exists
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  return resolved;
}

// In route handler:
for (let i = 1; i <= 3; i++) {
  const videoFile = req.files?.find(f => f.fieldname === `video${i}`);
  const videoPath = req.body[`video${i}Path`];
  
  if (videoFile) {
    videoFiles.push(videoFile.path);  // Multer-provided paths are safe
  } else if (videoPath) {
    try {
      const validatedPath = validateFilePath(videoPath);
      videoFiles.push(validatedPath);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
}
```

---

#### 2. Fix reformatShort.js Path Traversal

**Location:** `backend/routes/reformatShort.js`, lines 23-26

**Current Code:**
```javascript
const originalVideo = resolveJob(jobId);
if (!originalVideo) {
  res.status(400).json({ error: 'Unknown or expired job' });
  return;
}
```

**Fixed Code:**
```javascript
const validateJobPath = (filePath) => {
  const clipsDir = path.resolve(process.cwd(), 'clips');
  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  const resolved = path.resolve(filePath);
  
  const isValid = resolved.startsWith(clipsDir) || resolved.startsWith(uploadsDir);
  if (!isValid) {
    throw new Error('Invalid file path');
  }
  
  if (!fs.existsSync(resolved)) {
    throw new Error('File not found or expired');
  }
  
  return resolved;
};

const originalVideo = resolveJob(jobId);
if (!originalVideo) {
  res.status(400).json({ error: 'Unknown or expired job' });
  return;
}

try {
  const validatedPath = validateJobPath(originalVideo);
  // Use validatedPath instead of originalVideo
} catch (err) {
  return res.status(400).json({ error: err.message });
}
```

---

#### 3. Add Input Validation Middleware

**Create:** `backend/middleware/validation.js`

```javascript
import { body, query, validationResult } from 'express-validator';

export const validateConvertRequest = [
  body('videoSourceMode')
    .isIn(['upload', 'link', 'path'])
    .withMessage('Invalid source mode'),
  body('video1Link').if(() => false).optional().isURL(),
  body('video2Link').if(() => false).optional().isURL(),
  body('video3Link').if(() => false).optional().isURL(),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

export const validateExtractShortsRequest = [
  body('duration')
    .isInt({ min: 1, max: 3600 })
    .withMessage('Duration must be between 1 and 3600 seconds'),
  body('aspectRatio')
    .isIn(['9:16', '16:9'])
    .withMessage('Aspect ratio must be 9:16 or 16:9'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

export const validateReformatRequest = [
  body('jobId').notEmpty().withMessage('jobId is required'),
  body('startTime').isFloat({ min: 0 }).withMessage('startTime must be >= 0'),
  body('duration').isFloat({ min: 0.1 }).withMessage('duration must be > 0'),
  body('formatStrategy').isIn(['crop', 'letterbox']).withMessage('Invalid format strategy'),
  body('aspectRatio').isIn(['9:16', '16:9']).withMessage('Invalid aspect ratio'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];
```

**Usage in routes:**
```javascript
import { validateConvertRequest } from '../middleware/validation.js';

router.post('/', validateConvertRequest, upload.fields([...]), async (req, res) => {
  // Validated request body
});
```

---

### HIGH PRIORITY - Architecture Issues

#### 4. Consolidate State in App.jsx

**Problem:** Duplicate state management (video1State AND video1, etc.)

**Create New File:** `frontend/src/hooks/useMediaState.js`

```javascript
import { useState } from 'react';
import { usePersistedState } from './usePersistedState';

const createMediaState = () => ({
  sourceMode: 'device',
  file: null,
  url: '',
  filePath: '',
  fileName: '',
  duration: null,
  status: 'idle',
  progress: 0,
  error: '',
});

export function useMediaState(storageKey) {
  const [state, setStateRaw] = useState(createMediaState());
  const [meta, setMeta] = usePersistedState(storageKey, null);

  const setState = (updates) => {
    setStateRaw(prev => {
      const next = typeof updates === 'function' ? updates(prev) : updates;
      // Update meta when file info changes
      if (next.file || next.fileName) {
        const newMeta = {
          name: next.fileName,
          size: next.file?.size || 0,
          type: next.file?.type || 'video/mp4',
          lastModified: Date.now(),
          filePath: next.filePath,
          source: next.sourceMode,
        };
        setMeta(newMeta);
      }
      return next;
    });
  };

  return [state, setState, meta, setMeta];
}
```

**Usage in App.jsx:**
```javascript
import { useMediaState } from './hooks/useMediaState';

function App() {
  const [video1State, setVideo1State, video1Meta, setVideo1Meta] = useMediaState(KEY_VIDEO1_META);
  const [video2State, setVideo2State, video2Meta, setVideo2Meta] = useMediaState(KEY_VIDEO2_META);
  const [video3State, setVideo3State, video3Meta, setVideo3Meta] = useMediaState(KEY_VIDEO3_META);
  const [audioState, setAudioState, audioMeta, setAudioMeta] = useMediaState(KEY_AUDIO_META);

  // Remove all the duplicate state declarations
  // Remove: const [video1, setVideo1] = useState(null);
  // Remove: const [video1Meta, setVideo1Meta] = usePersistedState(...);
  // etc.
}
```

---

#### 5. Move Socket to React Context

**Create:** `frontend/src/context/SocketContext.jsx`

```javascript
import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext();

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null);
  const [socketId, setSocketId] = useState('');

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_SOCKET_URL || 
                      import.meta.env.VITE_API_URL || 
                      'http://localhost:3000';
    
    const newSocket = io(socketUrl);

    newSocket.on('connect', () => {
      setSocketId(newSocket.id);
      console.log('Socket connected:', newSocket.id);
    });

    newSocket.on('disconnect', () => {
      setSocketId('');
      console.log('Socket disconnected');
    });

    newSocket.on('error', (error) => {
      console.error('Socket error:', error);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, socketId }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within SocketProvider');
  }
  return context;
}
```

**Update main.jsx:**
```javascript
import { SocketProvider } from './context/SocketContext';

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

**Update App.jsx:**
```javascript
import { useSocket } from './context/SocketContext';

function App() {
  const { socket, socketId } = useSocket();
  
  // Remove the manual useEffect that creates socket
  // Remove: const [socketId, setSocketId] = useState('');
  // Remove: useEffect(() => { const socket = io(...); ... }, []);
}
```

---

#### 6. Fix Socket ID Race Condition

**Create:** `frontend/src/hooks/useApi.js`

```javascript
import { useCallback } from 'react';
import { useSocket } from '../context/SocketContext';

export function useApi() {
  const { socketId } = useSocket();

  const fetchWithSocket = useCallback(async (url, options = {}) => {
    // Wait for socket ID if not yet available
    let retries = 0;
    while (!socketId && retries < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      retries++;
    }

    const headers = {
      ...options.headers,
      ...(socketId && { 'X-Socket-Id': socketId })
    };

    return fetch(url, {
      ...options,
      headers
    });
  }, [socketId]);

  return { fetchWithSocket, socketId };
}
```

**Usage in components:**
```javascript
const { fetchWithSocket } = useApi();

const response = await fetchWithSocket(API_ENDPOINTS.extractShorts, {
  method: 'POST',
  body: formData,
});
```

---

### MEDIUM PRIORITY - Performance Issues

#### 7. Add Concurrency Control for FFmpeg

**Update:** `backend/services/ffmpeg.js`

```javascript
import pLimit from 'p-limit';

// Global concurrency limit
const ffmpegLimit = pLimit(2); // Max 2 concurrent ffmpeg processes

export function runFFmpeg(args, options = {}) {
  return ffmpegLimit(() => _runFFmpeg(args, options));
}

// Rename original function
function _runFFmpeg(args, options = {}) {
  return new Promise((resolve, reject) => {
    // ... existing implementation
  });
}

// Add timeout mechanism
export function runFFmpegWithTimeout(args, timeout = 3600000, options = {}) {
  return new Promise((resolve, reject) => {
    let timer;
    
    const promise = _runFFmpeg(args, options);
    
    timer = setTimeout(() => {
      reject(new Error(`FFmpeg operation timed out after ${timeout}ms`));
    }, timeout);

    promise
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
```

**Install dependency:**
```bash
npm install p-limit
```

---

#### 8. Fix Blob URL Leaks

**Update:** `frontend/src/App.jsx`

```javascript
const handleShortDownload = useCallback(async (clip, index) => {
  let downloadUrl = null;
  
  try {
    const response = await fetch(clip.url);
    if (!response.ok) {
      throw new Error('Failed to download clip');
    }

    const blob = await response.blob();
    downloadUrl = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `NexEditor_Short_${index + 1}.mp4`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    console.error(error);
    setErrorText(error.message || 'Failed to download clip');
  } finally {
    // ALWAYS revoke the URL
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
    }
  }
}, []);

// Also add cleanup on unmount
useEffect(() => {
  return () => {
    // Revoke any object URLs on component unmount
    if (resultUrl) {
      URL.revokeObjectURL(resultUrl);
    }
  };
}, [resultUrl]);
```

---

### LOW PRIORITY - Code Quality

#### 9. Remove Unused Imports

**In:** `frontend/src/App.jsx`

```javascript
// Remove these unused imports (lines 24-25):
// import BottomTimeline from './components/BottomTimeline';
// import UrlVideoFetcher from './components/UrlVideoFetcher';

// Or if they should be used, add them to the JSX
```

---

#### 10. Fix Redundant Dropbox URL Conversion

**In:** `backend/routes/fetchUrlVideo.js`, line 193

**Current:**
```javascript
function convertDropboxUrl(url) {
  return url.replace('?dl=0', '?dl=1').replace('?dl=1', '?dl=1');
}
```

**Fixed:**
```javascript
function convertDropboxUrl(url) {
  return url.endsWith('?dl=0') 
    ? url.replace('?dl=0', '?dl=1')
    : url.endsWith('?dl=1')
      ? url
      : url + '?dl=1';
}
```

---

## Configuration Files to Create

### `.env.example` (in project root)

```bash
# Backend
PORT=3000
CORS_ORIGIN=http://localhost:5173
BACKEND_URL=http://localhost:3000
CLEANUP_INTERVAL_MS=900000
FFMPEG_TIMEOUT_MS=3600000

# Frontend
VITE_API_URL=http://localhost:3000
VITE_SOCKET_URL=http://localhost:3000
```

### `.env.production` (in project root)

```bash
# Backend
PORT=3000
CORS_ORIGIN=https://yourdomain.com
BACKEND_URL=https://api.yourdomain.com
CLEANUP_INTERVAL_MS=900000
FFMPEG_TIMEOUT_MS=3600000

# Frontend
VITE_API_URL=https://api.yourdomain.com
VITE_SOCKET_URL=https://api.yourdomain.com
```

---

## Package.json Updates

### Add validation library to backend

```bash
cd backend
npm install express-validator
npm install p-limit
```

### Update scripts

**backend/package.json:**
```json
{
  "scripts": {
    "start": "nodemon --env-file=.env server.js",
    "test": "node --test test/**/*.test.js"
  }
}
```

---

## Testing Example

**Create:** `backend/test/pathValidation.test.js`

```javascript
import assert from 'assert';
import { validateFilePath } from '../routes/createMontage.js';

describe('Path Validation', () => {
  it('should reject paths outside safe directory', () => {
    assert.throws(() => {
      validateFilePath('/etc/passwd');
    }, /Access denied/);
  });

  it('should reject non-existent files', () => {
    assert.throws(() => {
      validateFilePath('./clips/nonexistent.mp4');
    }, /not found/);
  });

  it('should accept valid clip paths', () => {
    // Assuming file exists
    const result = validateFilePath('./clips/valid_clip.mp4');
    assert.ok(result);
  });
});
```

---

## Deployment Checklist

- [ ] Set environment variables in production
- [ ] Verify ffmpeg/ffprobe are installed on server
- [ ] Configure CORS_ORIGIN for production domain
- [ ] Set up disk cleanup (or use S3 for clips)
- [ ] Enable HTTPS
- [ ] Add rate limiting (express-rate-limit)
- [ ] Set up monitoring for zombie ffmpeg processes
- [ ] Add logging (morgan for HTTP, winston for errors)
- [ ] Configure backup/retention for generated clips
- [ ] Test error scenarios under load

