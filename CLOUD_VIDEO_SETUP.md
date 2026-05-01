# Cloud Video URL Support Implementation Guide

## ✅ What Was Implemented

A complete **cloud video URL fetching feature** has been added to your MERN stack converter app. Users can now download videos from YouTube, Google Drive, Dropbox, or direct URLs and use them in the editor.

---

## 📋 Installation & Setup

### 1. **Install Backend Dependencies**

```bash
cd backend
npm install
```

This installs `axios` (for HTTP streaming) as specified in the updated `package.json`.

### 2. **Install System Dependencies**

#### Option A: Install yt-dlp (for YouTube support)

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get update
sudo apt-get install yt-dlp
```

**macOS (with Homebrew):**
```bash
brew install yt-dlp
```

**Windows (with Chocolatey):**
```bash
choco install yt-dlp
```

Or download from: https://github.com/yt-dlp/yt-dlp/releases

**Verify Installation:**
```bash
yt-dlp --version
```

> **Note:** yt-dlp is only required if you want YouTube support. All other URL sources (Google Drive, Dropbox, direct) work without it.

### 3. **Start Backend Server**

```bash
cd backend
npm start
# Server runs on http://localhost:3000
```

### 4. **Start Frontend Dev Server**

In a new terminal:
```bash
cd frontend
npm run dev
# Frontend runs on http://localhost:5173
```

---

## 🎯 Backend Implementation Details

### New Route: `/api/fetch-url-video`

**Location:** `backend/routes/fetchUrlVideo.js`

**Request:**
```javascript
POST http://localhost:3000/api/fetch-url-video
Content-Type: application/json
x-socket-id: <socket-id>

{
  "url": "https://youtube.com/watch?v=...",
  "socketId": "<socket-id>"
}
```

**Response:**
```javascript
{
  "filePath": "/path/to/uploads/filename",
  "fileName": "filename",
  "duration": "120.5",
  "type": "youtube|gdrive|dropbox|direct"
}
```

**Error Response:**
```javascript
{
  "error": "Error message describing what went wrong"
}
```

### URL Type Detection

The backend automatically detects the URL type:

| URL Type | Pattern | Handler |
|----------|---------|---------|
| **YouTube** | youtube.com, youtu.be | `yt-dlp` CLI tool |
| **Google Drive** | drive.google.com/file/d/{ID} | Convert to direct download URL |
| **Dropbox** | dropbox.com/s/{PATH}?dl=0 | Convert ?dl=0 → ?dl=1 |
| **Direct** | Any other HTTP(S) URL | Direct streaming with axios |

### Real-time Progress Updates

Downloads emit Socket.IO events during processing:

```javascript
// Browser receives:
socket.on('url-fetch-progress', (payload) => {
  console.log(payload.percent);  // 0-100
  console.log(payload.status);   // Optional status message
});

socket.on('url-fetch-error', (payload) => {
  console.log(payload.error);    // Error message
});
```

### File Storage

- Downloaded videos are saved to `backend/uploads/` with random hex filenames
- Files are treated identically to uploaded files in downstream processing
- All existing routes (convert, burn-subtitles, extract-shorts, reformat-short) work seamlessly

---

## 🎨 Frontend Implementation Details

### New Component: `UrlVideoFetcher`

**Location:** `frontend/src/components/UrlVideoFetcher.jsx`

**Features:**
- ✅ URL input with validation
- ✅ Auto-detection of source type (shows emoji icon: ▶️ 📦 ☁️ 🔗)
- ✅ Real-time progress bar (0-100%)
- ✅ Keyboard support (Enter to fetch)
- ✅ Error handling with helpful messages
- ✅ Disabled state during processing

**Usage in MediaPanel:**
```jsx
<UrlVideoFetcher
  label="Or Fetch Video 1 from URL"
  onSuccess={(data) => handleVideo1UrlFetch(data)}
  onError={(error) => setErrorText(error)}
  socketId={socketId}
  isLoading={processing}
/>
```

### App.jsx Updates

New handler functions:
- `handleVideo1UrlFetch(data)` - Process fetched Video 1
- `handleVideo2UrlFetch(data)` - Process fetched Video 2
- `handleVideo3UrlFetch(data)` - Process fetched Video 3
- `handleAudioUrlFetch(data)` - Process fetched audio
- `handleUrlVideoFetched(data, setter, metaSetter, fieldName)` - Generic handler

These handlers store fetched file metadata in the same format as uploaded files, with the `filePath` pointing to the backend-downloaded file.

### MediaPanel.jsx Updates

Added URL fetcher sections alongside file upload UI:
```jsx
// For each video track and audio:
<UrlVideoFetcher
  label="Or Fetch Video 1 from URL"
  onSuccess={handleVideo1UrlFetch}
  onError={onError}
  socketId={socketId}
  isLoading={processing}
/>
```

---

## 🔄 Data Flow

```
User Workflow:
1. Open Media tab
2. Click "Paste URL" section
3. Enter YouTube/Drive/Dropbox/Direct URL
4. Click "Fetch Video"
   ↓
Backend (Node.js):
5. Detect URL type
6. Convert platform URLs to direct download links
7. Download file using yt-dlp (YouTube) or axios (others)
8. Emit progress via Socket.IO → Frontend
9. Probe video duration using ffprobe
10. Return filePath, fileName, duration
   ↓
Frontend (React):
11. Receive successful fetch response
12. Store metadata in state (same as uploaded file)
13. Update UI to show "Video loaded from [source]"
14. User can now use the video in editor just like an upload
```

---

## 🧪 Testing the Feature

### Test YouTube URL:
```
https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

### Test Google Drive:
```
https://drive.google.com/file/d/1_SAMPLE_FILE_ID_HERE/view
```

### Test Dropbox:
```
https://www.dropbox.com/s/SAMPLE_PATH/video.mp4?dl=0
```

### Test Direct URL:
```
https://commondatastorage.googleapis.com/gtv-videos-library/sample/BigBuckBunny.mp4
```

---

## ⚙️ Configuration

### Environment Variables (Optional)

**Backend (`backend/server.js`):**
```bash
CORS_ORIGIN=http://localhost:5173    # Frontend URL
BACKEND_URL=http://localhost:3000     # Backend URL
```

**Frontend (`frontend/src/config.js`):**
```bash
VITE_API_URL=http://localhost:3000
VITE_SOCKET_URL=http://localhost:3000
```

---

## 🐛 Error Handling

The system handles these error cases gracefully:

| Error | Handling |
|-------|----------|
| Invalid URL format | Message: "Invalid URL. Please check the format." |
| Private/Password-protected file | Message: "Access denied. The URL may be private..." |
| File not found (404) | Message: "URL not found (404). Please check the link." |
| Network error | Message: "Invalid domain or network error." |
| yt-dlp not installed | Message: "yt-dlp not found. Please install yt-dlp system-wide" |
| Download timeout | Message: "Failed to download video: timeout" |

All errors are:
- Emitted via Socket.IO for real-time UI updates
- Displayed in the ErrorPopup component
- Logged to browser console

---

## ♻️ Backward Compatibility

✅ **Fully maintained:**
- All existing file upload functionality works unchanged
- Existing "Use video link" mode (direct URL linking) still works
- All downstream routes work with both uploaded and fetched files
- No breaking changes to the API

---

## 📊 Performance Notes

### File Size Limits
- Default: 500 MB (inherited from Multer configuration)
- Adjustable in `backend/middleware/upload.js`

### Download Speed Factors
- Depends on source server speed
- YouTube downloads typically 2-10 Mbps depending on quality
- Google Drive/Dropbox speeds vary by region

### Disk Space
- Ensure sufficient space in `backend/uploads/`
- Old files are automatically cleaned up (see cleanup logic in `server.js`)

---

## 🔐 Security Considerations

1. **URL Validation:** Only HTTP(S) URLs accepted
2. **Timeout Protection:** 5-minute timeout on HTTP downloads prevents hanging
3. **File Type Detection:** Backend verifies video format via ffprobe
4. **Temporary Storage:** Downloaded files stored server-side, not exposed to other users
5. **Error Messages:** Generic error messages don't leak system paths

---

## 🚀 Future Enhancements

Potential improvements you could add:

1. **Pause/Resume Downloads** - Track download state more granularly
2. **Concurrent Downloads** - Allow multiple URL fetches simultaneously
3. **Download Queue** - Queue URLs if system busy
4. **File Caching** - Cache frequently accessed URLs to avoid re-downloads
5. **API Key Support** - Handle private YouTube/Drive links with authentication
6. **Format Selection** - Let users choose video quality (YouTube)
7. **Conversion to Common Format** - Auto-convert to MP4 if needed

---

## 📞 Troubleshooting

### "yt-dlp not found" error
```bash
# Verify installation
which yt-dlp
yt-dlp --version

# If not found, reinstall
sudo apt-get install yt-dlp  # or brew/choco on macOS/Windows
```

### "Access denied" for Google Drive
- Make sure the file sharing is set to "Anyone with the link can view"
- Or make sure the share link is accessible

### "Failed to download" for direct URLs
- Verify the URL works in browser (test with curl)
- Check that server has internet access
- Verify URL isn't behind a paywall or authentication

### Progress bar not updating
- Check WebSocket connection (open DevTools → Network → WS)
- Verify `socketId` is being sent in request headers
- Check browser console for connection errors

### Files accumulating in /uploads
- The server has cleanup logic that removes old files
- Can adjust retention time in `server.js` cleanup interval

---

## 📝 Code Structure

```
backend/
├── routes/
│   ├── fetchUrlVideo.js          ← NEW: URL fetching route
│   ├── convert.js                 (unchanged)
│   ├── burnSubtitles.js           (unchanged)
│   ├── extractShorts.js           (unchanged)
│   └── reformatShort.js           (unchanged)
├── middleware/
│   └── upload.js                  (unchanged)
├── services/
│   ├── ffmpeg.js                  (unchanged)
│   └── jobStore.js                (unchanged)
└── server.js                       (updated with new route)

frontend/
├── src/
│   ├── components/
│   │   ├── UrlVideoFetcher.jsx    ← NEW: URL fetcher component
│   │   ├── UrlVideoFetcher.css    ← NEW: Styling
│   │   ├── MediaPanel.jsx         (updated with URL fetcher UI)
│   │   └── ...
│   └── App.jsx                     (updated with URL handlers)
```

---

## ✨ Summary

You now have a fully functional cloud video integration system that:

✅ Supports YouTube, Google Drive, Dropbox, and direct URLs
✅ Shows real-time download progress
✅ Integrates seamlessly with existing file upload
✅ Handles errors gracefully with helpful messages
✅ Works with all existing video processing features
✅ Maintains full backward compatibility

**Ready to use!** Users can now paste video URLs and have them automatically downloaded and ready for editing. 🎉
