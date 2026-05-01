# Comprehensive Code Audit - MERN Video Converter Project

## Executive Summary
The project is a full-stack MERN application for video processing with multiple features (montage creation, shorts extraction, subtitle burning, etc.). While the core functionality is implemented, there are several architecture, security, error handling, and code quality issues that should be addressed.

---

## 1. ARCHITECTURE & DEPENDENCIES ISSUES

### 1.1 Backend Architecture Issues

**Issue:** Inconsistent multer configuration across routes
- **Files:** `backend/middleware/upload.js`, `backend/routes/createMontage.js`
- **Location:** `upload.js` (lines 1-40) vs `createMontage.js` (lines 11-25)
- **Problem:** Two different multer instances with potentially different configurations exist
- **Impact:** File size limits and handling may differ between routes
- **Solution:** Create a shared multer configuration or middleware

**Issue:** No dependency injection for socket.io
- **Files:** `backend/server.js`, `backend/routes/*.js`
- **Location:** Various routes import `getIo()` from socket.js (lines 6 in burnSubtitles.js, 7 in extractShorts.js, etc.)
- **Problem:** Routes depend on global socket state via `getIo()`, making testing difficult
- **Impact:** Hard to test routes without running a server
- **Recommendation:** Pass io instance through middleware or context

**Issue:** Environment variables not properly validated
- **File:** `backend/server.js`
- **Lines:** 20, 22
- **Problem:** `CORS_ORIGIN` and `BACKEND_URL` have defaults but no validation that they're proper URLs
- **Impact:** Could cause CORS or redirect issues in production if env vars are misconfigured

### 1.2 Frontend Architecture Issues

**Issue:** Global socket reference via `window.__socket`
- **File:** `frontend/src/App.jsx`
- **Lines:** 95, 160-161
- **Problem:** Socket instance stored on window object - fragile pattern
- **Impact:** 
  - Multiple components relying on window global
  - No clean way to manage socket lifecycle
  - Race conditions possible if socket reconnects
- **Solution:** Use React Context or state management library

**Issue:** Mixed state management patterns
- **File:** `frontend/src/App.jsx`
- **Lines:** 40-110
- **Problem:** Complex state with duplication:
  - `video1State`/`video2State`/`video3State` AND `video1`/`video2`/`video3`
  - `video1Meta`/`video2Meta`/`video3Meta` duplicating file metadata
  - Same for audio, captions, shorts
- **Impact:** State synchronization bugs, inconsistent data
- **Lines:** Comments on line 45-48 acknowledge this: "Legacy state (kept for backward compatibility)"
- **Recommendation:** Consolidate state structure

**Issue:** No environment configuration validation
- **File:** `frontend/src/config.js`
- **Lines:** 1-3
- **Problem:** Silently falls back to localhost if env vars missing
- **Impact:** Hard to debug production issues due to wrong API endpoint

### 1.3 Unused Imports & Dependencies

**Issue:** Unused imports in App.jsx
- **File:** `frontend/src/App.jsx`
- **Lines:** 24-25 (BottomTimeline, UrlVideoFetcher imported but don't appear in render)
- **Problem:** Components imported but never used in the JSX
- **Impact:** Unnecessary bundle size increase

**Issue:** Unused variables in routes
- **File:** `backend/routes/convert.js`
- **Lines:** Check if `fs.rm` callbacks properly handle errors
- **Problem:** Fire-and-forget error handling on cleanup
- **Impact:** May silently fail to clean up files

---

## 2. CODE QUALITY PROBLEMS

### 2.1 Error Handling Issues

**Issue:** Swallowed errors in cleanup
- **File:** `backend/routes/burnSubtitles.js`
- **Lines:** 41-43
```javascript
for (const filePath of outputFiles) {
  fs.rm(filePath, { force: true }, () => {});  // Silently ignores errors
}
```
- **Problem:** File cleanup errors are ignored
- **Impact:** Disk could fill up with orphaned files

**Issue:** No timeout on ffmpeg operations
- **File:** `backend/services/ffmpeg.js`
- **Lines:** 57-100
- **Problem:** `runFFmpeg()` has no timeout mechanism
- **Impact:** Hung ffmpeg processes could block indefinitely, consuming resources

**Issue:** Incomplete error handling for yt-dlp
- **File:** `backend/routes/fetchUrlVideo.js`
- **Lines:** 106
```javascript
}).on('error', (err) => {
  reject(new Error(`yt-dlp not found: Please install yt-dlp system-wide...`));
});
```
- **Problem:** All errors treated as "not installed" - could mask real issues
- **Impact:** Users get wrong error message (e.g., network error shows as "not installed")

**Issue:** Missing null checks before file operations
- **File:** `backend/routes/fetchUrlVideo.js`
- **Lines:** 156-165
- **Problem:** `resolveJob()` returns null but caller doesn't always check
- **Solution:** Add validation in reformatShort.js line 20

**Issue:** Catch block doesn't cover all error types
- **File:** `frontend/src/App.jsx`
- **Lines:** 385-391
```javascript
} catch (error) {
  console.error('Montage error:', error);
  setErrorText(error.message || 'Error generating montage');
```
- **Problem:** Network errors, JSON parse errors not specifically handled
- **Impact:** Users see "Request failed" instead of actionable errors

### 2.2 Missing Validation

**Issue:** No input validation on URL lengths
- **File:** `backend/routes/fetchUrlVideo.js`
- **Lines:** 172-175
- **Problem:** URL not validated for length or structure beyond basic check
- **Impact:** Could accept malformed URLs or extremely long URLs

**Issue:** No validation of aspect ratio values
- **File:** `backend/routes/extractShorts.js`
- **Lines:** 52
- **Problem:** aspectRatio directly used without validation that it's '9:16' or '16:9'
- **Impact:** Could pass invalid ratios to ffmpeg

**Issue:** No validation of file path existence before ffmpeg calls
- **File:** `backend/routes/reformatShort.js`
- **Lines:** 23-26
- **Problem:** `resolveJob()` called but no verification the file still exists
- **Impact:** ffmpeg called on non-existent file, returns cryptic error

**Issue:** Division by zero risk
- **File:** `backend/routes/extractShorts.js`
- **Lines:** 74-75
```javascript
const clipDur = pickShortClipDuration(maxDuration, sourceDuration);
const maxStart = Math.max(0, sourceDuration - clipDur);
const startTime = Math.random() * maxStart;  // If sourceDuration == clipDur, maxStart == 0
```
- **Problem:** If sourceDuration equals clipDur, startTime is always 0
- **Impact:** All clips start from beginning, reducing diversity

### 2.3 Logic Errors

**Issue:** Incorrect progress calculation
- **File:** `backend/routes/convert.js`
- **Lines:** 157-162
```javascript
const scaledPercent = 10 + (i / numClips) * 30 + (progress.percent / numClips);
```
- **Problem:** Progress calculation can exceed 100% due to scaling
- **Impact:** UI shows invalid percentages

**Issue:** Condition never true
- **File:** `backend/routes/fetchUrlVideo.js`
- **Lines:** 193
```javascript
return url.replace('?dl=0', '?dl=1').replace('?dl=1', '?dl=1');
```
- **Problem:** Second `.replace()` is redundant - first one already replaced
- **Impact:** Dead code, no functional issue but indicates incomplete code

**Issue:** Inconsistent file cleanup logic
- **File:** `backend/routes/extractShorts.js`
- **Lines:** 102-113
- **Problem:** Some files in `tempFiles` array are never cleaned up (uploaded file is in tempFiles but source copy is in outputFiles)
- **Impact:** Uploaded temp files left on disk

---

## 3. SECURITY VULNERABILITIES

### 3.1 Path Traversal Risks

**Issue:** Insufficient path validation in createMontage
- **File:** `backend/routes/createMontage.js`
- **Lines:** 56-68
- **Problem:** `videoFiles` and `audioSource` constructed from user input via request body
- **Code:**
```javascript
const videoPath = req.body[`video${i}Path`];  // User-controlled
if (sourcePath) {
  videoFiles.push(sourcePath);  // Used directly in ffmpeg
}
```
- **Impact:** CRITICAL - User could specify arbitrary file paths like `../../etc/passwd`
- **Solution:** Validate paths are within expected directories, use basename() only

**Issue:** Path traversal in reformatShort.js
- **File:** `backend/routes/reformatShort.js`
- **Lines:** 23-26
- **Problem:** `resolveJob()` returns a user-provided path
- **Solution:** Validate the resolved path is within `/clips` directory

**Issue:** Unsafe shell escaping in subtitles filter
- **File:** `backend/routes/burnSubtitles.js`
- **Lines:** 32
```javascript
const subtitleFilter = `subtitles='${subPath.replace(/\\/g, '/').replace(/:/g, '\\:')}'`;
```
- **Problem:** Insufficient escaping for all special characters
- **Impact:** Could allow ffmpeg filter injection

**Recommended Fix:**
```javascript
// Use array format for ffmpeg filter to avoid shell injection
const subtitleFilter = `subtitles=${JSON.stringify(subPath)}`;
```

### 3.2 CORS & Authentication Issues

**Issue:** No CORS origin validation for real-world use
- **File:** `backend/server.js`
- **Lines:** 21-22
- **Problem:** Single origin string allows only one domain
- **Impact:** Difficult to support multiple environments (staging, production)
- **Solution:** Parse comma-separated origins or use allowlist from config

**Issue:** No authentication on video processing endpoints
- **Files:** All route files
- **Problem:** Anyone can call `/api/extract-shorts`, `/api/convert`, etc.
- **Impact:** Potential DoS vulnerability - bad actors could flood with requests
- **Solution:** Add rate limiting and optional authentication middleware

### 3.3 File Handling Issues

**Issue:** No file size validation in routes
- **File:** `backend/routes/createMontage.js`
- **Lines:** Line 23-24 defines 500MB limit in multer
- **Problem:** But `downloadRemoteVideo()` in convert.js has no size limit for downloaded files
- **Impact:** Could download infinite-size files

**Issue:** Predictable filename generation (partial)
- **File:** `backend/services/ffmpeg.js`
- **Lines:** Looks OK - uses UUID
- **Problem:** But in some places uses `Date.now()` for filenames
- **Files/Lines:** `backend/routes/burnSubtitles.js` line 30, `extractShorts.js` line 60
- **Impact:** Timing attacks possible, filename collision risk

**Issue:** No file type verification on backend
- **File:** `backend/routes/fetchUrlVideo.js`
- **Lines:** After download, no verification that downloaded file is actually a video
- **Impact:** Could process non-video files, wasting resources

### 3.4 Information Disclosure

**Issue:** Detailed error messages leaked to client
- **File:** `backend/routes/fetchUrlVideo.js`
- **Lines:** 251-270
- **Problem:** Full error paths and system information shown to users
- **Example:** `"yt-dlp not found: Please install yt-dlp system-wide. Visit: ..."`
- **Impact:** Reveals system configuration to potential attackers

---

## 4. PERFORMANCE ISSUES

### 4.1 Memory Management

**Issue:** No limits on number of concurrent ffmpeg operations
- **File:** `backend/routes/extractShorts.js`
- **Lines:** 85-115 (Promise.all with 3 concurrent operations)
- **Problem:** No global concurrency control - multiple requests create unbounded parallel operations
- **Impact:** Could exhaust system resources on high traffic

**Issue:** Blob URL leaks in frontend
- **File:** `frontend/src/App.jsx`
- **Lines:** 460-461
```javascript
const blob = await response.blob();
const url = URL.createObjectURL(blob);
```
- **Problem:** No guarantee `revokeObjectURL()` is called if component unmounts
- **Impact:** Memory leaks, dangling object URLs

**Issue:** WebSocket listeners not cleaned up properly
- **File:** `frontend/src/components/MediaPanel.jsx`
- **Lines:** 90-106
- **Problem:** Socket event listeners added in useEffect
- **Problem:** Listener cleanup depends on `socketId` dependency, but socket instance from `window.__socket`
- **Impact:** If socket connection changes, old listeners remain

### 4.2 Inefficient Operations

**Issue:** File copied twice in extractShorts
- **File:** `backend/routes/extractShorts.js`
- **Lines:** 71-76
```javascript
const managedSourcePath = path.join(clipsDir, `source_${sessionId}...`);
await fs.promises.copyFile(videoPath, managedSourcePath);
```
- **Problem:** Uploaded file already in temp location, now copied to clips dir
- **Impact:** Doubles I/O and disk usage for large files

**Issue:** Duration probed multiple times
- **File:** `backend/routes/convert.js`
- **Lines:** 131-132
```javascript
const audioDuration = await probeDuration(audioPath);
const vDurations = await Promise.all(videoPaths.map((videoPath) => probeDuration(videoPath)));
```
- **Problem:** Serial then parallel operations - could all be parallel
- **Impact:** Slower processing time

**Issue:** Large in-memory concatenation list
- **File:** `backend/routes/createMontage.js`
- **Lines:** 95-96
```javascript
const concatList = videoFiles.map(f => `file '${f}'`).join('\n');
fs.writeFileSync(concatListPath, concatList);
```
- **Problem:** For thousands of files, entire list in memory
- **Impact:** Memory spike for large montages

---

## 5. MISSING ERROR BOUNDARIES & VALIDATION

### 5.1 Frontend Error Boundaries

**Issue:** Error boundary only at App level
- **File:** `frontend/src/main.jsx`
- **Lines:** 7-12
- **Problem:** Single error boundary for entire app
- **Impact:** One component error crashes everything
- **Solution:** Add error boundaries around major sections (MediaPanel, EditorPanel, etc.)

**Issue:** No error boundary in MontageTab
- **File:** `frontend/src/components/MontageTab.jsx`
- **Lines:** Entire component
- **Problem:** If child components error, entire tab crashes
- **Recommendation:** Wrap components in try-catch or add error boundary

**Issue:** No validation of fetched video duration
- **File:** `frontend/src/App.jsx`
- **Lines:** 338
```javascript
const { type, originalUrl } = detectUrlType(url_trimmed);
```
- **Problem:** Duration returned from backend but never validated
- **Impact:** Could be NaN or negative, breaking calculations

### 5.2 Backend Validation

**Issue:** No schema validation
- **Files:** All route files
- **Problem:** Request bodies not validated against schema
- **Recommendation:** Add validation library (joi, zod, etc.)

**Issue:** No socket message validation
- **File:** `backend/socket.js`
- **Lines:** 5-10
- **Problem:** No event or message validation
- **Impact:** Could cause issues if client sends unexpected data

---

## 6. INCONSISTENT PATTERNS

### 6.1 Error Handling Patterns

**Issue:** Inconsistent error response format
- **Files:** Multiple routes
- **Pattern 1:** `{ error: string }` (most routes)
- **Pattern 2:** `{ error, errorCode }` (inconsistent)
- **Impact:** Frontend error handling complex

### 6.2 Progress Reporting

**Issue:** Inconsistent progress event names
- **Files:** Various routes
- **Events:**
  - `ffmpeg-progress` (convert.js, burnSubtitles.js)
  - `montage-progress` (createMontage.js)
  - `url-fetch-progress` (fetchUrlVideo.js)
- **Impact:** Frontend must handle multiple event names

### 6.3 File Naming

**Issue:** Inconsistent temporary file prefixes
- **Files:** All routes
- **Prefixes:** 
  - `clip_` (convert.js line 142)
  - `short_` (extractShorts.js line 89)
  - `source_` (extractShorts.js line 74)
  - `concat_` (convert.js line 179)
- **Impact:** Hard to manage/debug temporary files

---

## 7. FRONTEND & BACKEND INTEGRATION ISSUES

### 7.1 File Path Handling Mismatch

**Issue:** Inconsistent file path handling between upload and URL modes
- **Files:** `frontend/src/App.jsx`, `backend/routes/convert.js`
- **Problem:**
  - Upload mode: Uses FormData with File objects
  - URL mode: Uses file paths in request body
  - Backend expects different headers for each mode
- **Lines:** `convert.js` 86-127
- **Impact:** Hard to maintain, easy to introduce bugs

### 7.2 Socket ID Propagation

**Issue:** Socket ID sent via header `X-Socket-Id`
- **Files:** Multiple routes
- **Lines:** `convert.js` line 10, etc.
- **Problem:** 
  - Not a standard header
  - Could conflict with other headers
  - No validation that socket ID is valid
- **Solution:** Send socketId in request body for POST requests

**Issue:** Race condition in Socket ID propagation
- **File:** `frontend/src/App.jsx`
- **Lines:** 93-102
- **Problem:** Socket ID set asynchronously, but requests sent before it's set
- **Impact:** First requests won't get progress updates
- **Solution:** Queue requests until socket connects

### 7.3 API Endpoint Configuration

**Issue:** Hardcoded API endpoints
- **File:** `frontend/src/config.js`
- **Lines:** 1-9
- **Problem:** Limited flexibility for different environments
- **Solution:** Support API endpoint discovery or more granular config

---

## 8. CONFIGURATION ISSUES

### 8.1 Environment Configuration

**Issue:** Missing .env.example or .env.template
- **Problem:** No documentation of required environment variables
- **Required vars:**
  - `CORS_ORIGIN` (backend)
  - `VITE_API_URL` or `VITE_SOCKET_URL` (frontend)
  - `BACKEND_URL` (backend, for clip URLs)

**Issue:** No validation of ffmpeg availability
- **File:** `backend/services/ffmpeg.js`
- **Problem:** No startup check that ffmpeg/ffprobe are installed
- **Impact:** Users don't discover missing tools until first request fails
- **Solution:** Add validation in server startup

**Issue:** Port hardcoded
- **File:** `backend/server.js`
- **Line:** 21
```javascript
const port = 3000;
```
- **Problem:** No environment variable, can't use different ports
- **Solution:** Use `process.env.PORT || 3000`

### 8.2 Build Configuration

**Issue:** No source maps in production
- **File:** `frontend/vite.config.js`
- **Problem:** Errors in production are hard to debug
- **Solution:** Enable source maps with sourcemap rollup option

---

## 9. BUGS & LOGICAL ERRORS

### 9.1 Critical Bugs

**Bug #1: Undefined socket in some components**
- **File:** `frontend/src/components/MediaPanel.jsx`
- **Lines:** 87-90
```javascript
const socket = window.__socket; // Could be undefined
socket?.on('url-fetch-progress', handleUrlProgress);
```
- **Issue:** If component mounts before socket connects, socket is undefined
- **Fix:** Wait for socket or add null check

**Bug #2: Duplicate file deletion**
- **File:** `backend/routes/convert.js`
- **Lines:** 261-267
- **Problem:** Files deleted both in callback and in catch block
- **Impact:** Attempted double-deletion (though `force: true` prevents errors)

**Bug #3: Memory leak in editor**
- **File:** `frontend/src/App.jsx`
- **Lines:** 199-207
```javascript
useEffect(() => () => {
  editorTimelineRef.current.forEach((clip) => {
    if (clip.url) {
      URL.revokeObjectURL(clip.url);  // Good
    }
  });
}, []);
```
- **Issue:** Cleanup runs on unmount, but urls might still be in state
- **Risk:** Low, but could cause issues if component remounts

### 9.2 Minor Bugs

**Bug #4: Missing return after error response**
- **File:** `backend/routes/extractShorts.js`
- **Lines:** 59-60
```javascript
res.status(400).json({ error: 'Invalid shorts duration.' });
return;  // Good
```
- **Status:** Actually code is correct, uses return
- **But inconsistent with other routes**

**Bug #5: No check for socket existence before emit**
- **File:** `backend/routes/convert.js`
- **Lines:** 10-15
```javascript
function emitToClient(req, eventName, payload) {
  const io = getIo();
  const socketId = req.headers['x-socket-id'];
  const clientSocket = socketId ? io?.sockets.sockets.get(socketId) : null;
  if (clientSocket) {
    clientSocket.emit(eventName, payload);
  }
}
```
- **Issue:** If `io` is null or client not found, silently fails
- **Impact:** Progress updates disappear without error

---

## 10. SPECIFIC FILE ISSUES

### Frontend Files

**frontend/src/App.jsx (400+ lines)**
- Line 46-48: Legacy state comments indicate refactoring needed
- Line 93-102: Race condition with socket ID
- Line 460-461: Blob URL leak risk
- Complex component, should be split

**frontend/src/components/MediaPanel.jsx**
- Line 87-90: Socket might be undefined
- Missing prop validation with PropTypes
- Component accepts many props, hard to follow

**frontend/src/components/MontageTab.jsx**
- No error handling
- Displays results without validation

### Backend Files

**backend/server.js**
- Line 21: Hardcoded port
- Line 21-22: Single CORS origin
- Lines 59-75: File cleanup interval should be configurable

**backend/routes/convert.js**
- Lines 157-162: Progress calculation overflow risk
- Lines 131-132: Could parallelize duration probing
- Lines 67-82: Inconsistent file path handling (upload vs link vs path modes)

**backend/routes/fetchUrlVideo.js**
- Lines 106: Overgeneralized error handling
- No size limit on downloaded files
- No MIME type validation of downloaded content

**backend/routes/createMontage.js**
- Line 56-68: Path traversal vulnerability
- Inconsistent multer configuration vs upload.js
- No validation of input paths

**backend/routes/extractShorts.js**
- Line 76: File copied twice (inefficient)
- Line 54: No validation of aspectRatio value
- Line 74-75: Potential division by zero in maxStart

**backend/services/ffmpeg.js**
- Line 57-100: No timeout mechanism
- stderr accumulation could cause memory issues with large videos

---

## SUMMARY OF RECOMMENDATIONS

### Critical (Security/Stability)
1. ✓ Fix path traversal vulnerabilities in createMontage.js and reformatShort.js
2. ✓ Implement input validation for all route parameters
3. ✓ Add timeout mechanism to ffmpeg operations
4. ✓ Implement rate limiting on endpoints
5. ✓ Validate downloaded files are actually videos

### High Priority (Architecture/Performance)
1. ✓ Consolidate state management in App.jsx
2. ✓ Move socket to React Context
3. ✓ Implement concurrency control for ffmpeg
4. ✓ Fix blob URL leaks in frontend
5. ✓ Dedup multer configuration

### Medium Priority (Code Quality)
1. ✓ Add comprehensive error boundaries in frontend
2. ✓ Implement schema validation on routes
3. ✓ Standardize error response format
4. ✓ Consolidate progress event naming
5. ✓ Add request logging middleware

### Low Priority (Polish)
1. ✓ Remove unused imports
2. ✓ Fix redundant code (double replace in convertDropboxUrl)
3. ✓ Make port and cleanup interval configurable
4. ✓ Add PropTypes/TypeScript for components
5. ✓ Create .env.example file

---

## Testing Gaps

- No unit tests for utility functions (detectUrlType, formatDuration, etc.)
- No integration tests for API routes
- No E2E tests for frontend workflows
- No tests for error scenarios
- No load/stress tests for concurrent ffmpeg operations

---

## Documentation Gaps

- No API documentation (OpenAPI/Swagger)
- No environment variable documentation
- No architecture/decision documentation
- No deployment/hosting guidelines
- No FFmpeg dependency documentation

