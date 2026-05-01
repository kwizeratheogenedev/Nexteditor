# Quick Win Action Items - MERN Video Converter

## 🚨 CRITICAL - Fix These First (Security)

### Priority 1.1: Fix Path Traversal in createMontage.js
**Time to fix:** 30 minutes
**Risk if not fixed:** Remote code execution via file access
**Action:**
1. Add `validateFilePath()` function to createMontage.js (see FIX_RECOMMENDATIONS.md)
2. Test with path traversal attempts: `../../etc/passwd`, `/var/log/auth.log`, etc.
3. Validate in reformatShort.js as well

**File:** `backend/routes/createMontage.js` (lines 56-68)
```javascript
// Replace with path validation before using videoPath
```

---

### Priority 1.2: Add Route Validation
**Time to fix:** 45 minutes
**Risk if not fixed:** Invalid inputs cause crashes, wasted resources
**Action:**
1. Install `express-validator`: `cd backend && npm install express-validator`
2. Create `backend/middleware/validation.js` with validators
3. Add validators to routes: convert.js, extractShorts.js, reformatShort.js
4. Test with invalid inputs: negative durations, invalid aspect ratios, etc.

**Files affected:**
- `backend/routes/convert.js`
- `backend/routes/extractShorts.js` 
- `backend/routes/reformatShort.js`

---

### Priority 1.3: Add FFmpeg Timeout
**Time to fix:** 15 minutes
**Risk if not fixed:** Hung processes consume memory indefinitely
**Action:**
1. Update `backend/services/ffmpeg.js` to add timeout (1 hour default)
2. Set configurable via environment variable
3. Test timeout by running long operation (create timeout scenario)

**File:** `backend/services/ffmpeg.js` (line 57-100)
```javascript
// Add Promise timeout wrapper
```

---

## 🔴 HIGH - Fix These for Stability

### Priority 2.1: Consolidate State in App.jsx
**Time to fix:** 2-3 hours
**Impact:** Reduces bugs from state desync
**Action:**
1. Create `frontend/src/hooks/useMediaState.js` 
2. Replace duplicate state declarations with single hook
3. Update all places that set state (handlers, etc.)
4. Test all tabs: media, captions, shorts, editor

**Files:**
- `frontend/src/App.jsx` (remove ~20 state declarations)
- Create `frontend/src/hooks/useMediaState.js`

---

### Priority 2.2: Move Socket to Context
**Time to fix:** 1.5 hours
**Impact:** Fixes socket lifecycle issues, simplifies components
**Action:**
1. Create `frontend/src/context/SocketContext.jsx`
2. Wrap app with `<SocketProvider>` in main.jsx
3. Replace `window.__socket` usage with `useSocket()` hook
4. Remove socket useEffect from App.jsx
5. Test: refresh page, check socket reconnects properly

**Files:**
- Create `frontend/src/context/SocketContext.jsx`
- Update `frontend/src/main.jsx`
- Update `frontend/src/App.jsx`
- Update `frontend/src/components/MediaPanel.jsx`
- Update `frontend/src/components/MontageTab.jsx`

---

### Priority 2.3: Fix Blob URL Leaks
**Time to fix:** 30 minutes  
**Impact:** Prevents memory leaks on long sessions
**Action:**
1. Add `finally` block to `handleShortDownload()` 
2. Add cleanup useEffect for `resultUrl`
3. Test: download multiple files, check DevTools Memory tab

**File:** `frontend/src/App.jsx` (lines 460-461)

---

## 🟡 MEDIUM - Do Before Production

### Priority 3.1: Fix Progress Calculation Overflow
**Time to fix:** 15 minutes
**Impact:** Prevents UI showing >100% progress
**File:** `backend/routes/convert.js` (line 157-162)
```javascript
// Fix: const scaledPercent = Math.min(100, 10 + (i / numClips) * 30 + ...);
```

---

### Priority 3.2: Parallelize Duration Probing
**Time to fix:** 20 minutes
**Impact:** 30-50% faster video processing
**File:** `backend/routes/convert.js` (lines 131-132)
```javascript
// Current: sequential then parallel
const audioDuration = await probeDuration(audioPath);
const vDurations = await Promise.all(videoPaths.map(...));

// Better: all parallel
const [audioDuration, ...vDurations] = await Promise.all([
  probeDuration(audioPath),
  ...videoPaths.map(p => probeDuration(p))
]);
```

---

### Priority 3.3: Add Error Boundaries
**Time to fix:** 1 hour
**Impact:** Prevents one component crash from crashing entire app
**Action:**
1. Create `frontend/src/components/SectionErrorBoundary.jsx`
2. Wrap: MediaPanel, EditorPanel, ShortsPanel, CaptionsPanel
3. Test: cause error in each section, verify others still work

**Files:**
- Create `frontend/src/components/SectionErrorBoundary.jsx`
- Update tab components to wrap children

---

### Priority 3.4: Validate Downloaded Files
**Time to fix:** 30 minutes
**Impact:** Prevents processing of wrong file types
**File:** `backend/routes/fetchUrlVideo.js` (after line 242)
```javascript
// Add after download:
const duration = await probeDuration(outputPath);
if (!duration || !isFinite(duration)) {
  throw new Error('Downloaded file is not a valid video');
}
```

---

## 🟢 LOW - Polish Before Release

### Priority 4.1: Remove Unused Imports
**Time to fix:** 5 minutes
**File:** `frontend/src/App.jsx` (lines 24-25)
```javascript
// Remove: import BottomTimeline from './components/BottomTimeline';
// Remove: import UrlVideoFetcher from './components/UrlVideoFetcher';
```

---

### Priority 4.2: Create .env.example
**Time to fix:** 10 minutes
**Impact:** Helps others set up project
**File:** Create `.env.example` in root with all env vars

---

### Priority 4.3: Make Port Configurable
**Time to fix:** 5 minutes
**File:** `backend/server.js` (line 21)
```javascript
// Change from:
const port = 3000;
// To:
const port = process.env.PORT || 3000;
```

---

### Priority 4.4: Cleanup Interval Configurable  
**Time to fix:** 10 minutes
**File:** `backend/server.js` (line 85)
```javascript
// Change interval from hardcoded 15 * 60 * 1000 to:
const cleanupIntervalMs = parseInt(process.env.CLEANUP_INTERVAL_MS || (15 * 60 * 1000));
setInterval(() => { ... }, cleanupIntervalMs);
```

---

## Testing Checklist

### Security Tests
- [ ] Try path traversal: `/api/create-montage` with `video1Path: "../../etc/passwd"`
- [ ] Try invalid durations: `duration: -100`, `duration: "abc"`
- [ ] Try invalid aspect ratios: `aspectRatio: "invalid"`
- [ ] Try missing required fields in all endpoints

### Performance Tests
- [ ] Load test with 5+ concurrent requests
- [ ] Monitor memory during large video processing
- [ ] Check that cleanup deletes temp files (no accumulation)
- [ ] Verify progress doesn't exceed 100%

### Integration Tests
- [ ] Upload → Convert → Download (full flow)
- [ ] Extract shorts → Reformat → Download
- [ ] Burn subtitles
- [ ] URL fetch for YouTube, Google Drive, Dropbox, direct links
- [ ] Browser refresh during processing (socket reconnect)

---

## Estimated Effort Summary

| Priority | Task | Time | Status |
|----------|------|------|--------|
| 1.1 | Fix path traversal | 30 min | ⭕ Not Started |
| 1.2 | Add route validation | 45 min | ⭕ Not Started |
| 1.3 | Add FFmpeg timeout | 15 min | ⭕ Not Started |
| 2.1 | Consolidate state | 2-3 hrs | ⭕ Not Started |
| 2.2 | Socket context | 1.5 hrs | ⭕ Not Started |
| 2.3 | Fix blob leaks | 30 min | ⭕ Not Started |
| 3.1 | Progress overflow | 15 min | ⭕ Not Started |
| 3.2 | Parallelize probing | 20 min | ⭕ Not Started |
| 3.3 | Error boundaries | 1 hour | ⭕ Not Started |
| 3.4 | Validate downloads | 30 min | ⭕ Not Started |
| 4.1-4.4 | Polish tasks | 30 min | ⭕ Not Started |
| **TOTAL** | **All fixes** | **~8-9 hours** | |

---

## Implementation Order (Recommended)

**Week 1 (Critical Security):**
1. Priority 1.1 - Fix path traversal (30 min)
2. Priority 1.2 - Add validation (45 min)
3. Priority 1.3 - Add FFmpeg timeout (15 min)
4. Test security fixes (30 min)

**Week 1 (High Priority Architecture):**
5. Priority 2.1 - Consolidate state (2-3 hrs)
6. Priority 2.2 - Socket context (1.5 hrs)
7. Priority 2.3 - Fix blob leaks (30 min)
8. Full integration testing (1 hr)

**Week 2 (Performance & Stability):**
9. Priority 3.1-3.4 - Performance & validation (1.5 hrs)
10. Priority 4.1-4.4 - Polish (30 min)
11. Full regression testing (2 hrs)

---

## File Changes Summary

### Backend Files to Modify
- `server.js` - Make port configurable
- `socket.js` - No changes needed
- `services/ffmpeg.js` - Add timeout, concurrency control
- `middleware/upload.js` - No changes needed
- `middleware/validation.js` - CREATE NEW
- `routes/convert.js` - Add validation, fix progress calc
- `routes/burnSubtitles.js` - No security issues, just logging
- `routes/extractShorts.js` - Add validation, parallelize duration
- `routes/createMontage.js` - CRITICAL: Add path validation
- `routes/fetchUrlVideo.js` - Validate downloads
- `routes/reformatShort.js` - Add path validation

### Frontend Files to Modify
- `main.jsx` - Wrap with SocketProvider
- `App.jsx` - Major refactor: consolidate state, remove window.__socket
- `config.js` - Add env validation
- `hooks/useMediaState.js` - CREATE NEW
- `context/SocketContext.jsx` - CREATE NEW
- `context/SocketContext.jsx` - CREATE NEW
- `hooks/useApi.js` - CREATE NEW
- `components/AppErrorBoundary.jsx` - No changes
- `components/SectionErrorBoundary.jsx` - CREATE NEW
- `components/*.jsx` - Update socket usage to use context

### Config Files
- `.env.example` - CREATE NEW
- `.env.production` - CREATE NEW

---

## Validation Playbook

### Before Starting Any Fix:
```bash
# 1. Commit current state
git add .
git commit -m "Checkpoint before audit fixes"

# 2. Create feature branch
git checkout -b audit-fixes/critical-security

# 3. Make changes incrementally
# 4. Test after each change
# 5. Commit each feature
```

### After Each Priority Level:
```bash
# Backend
cd backend && npm test

# Frontend  
cd frontend && npm run lint && npm run build

# Integration test
# Try the feature end-to-end
```

---

## Red Flags to Watch

During implementation, watch for:
1. ✋ Socket undefined errors - indicates timing issues
2. ✋ "Access denied" in production - indicates hardcoded paths
3. ✋ Memory grows over time - indicates leaks
4. ✋ Requests timeout - indicates ffmpeg hanging
5. ✋ Files not deleted - indicates cleanup issues

