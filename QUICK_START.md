# 🚀 Quick Start: Cloud Video URL Support

## 5-Minute Setup

### Step 1: Install Backend Dependencies
```bash
cd backend
npm install
```

### Step 2: Install yt-dlp (for YouTube support)
```bash
# macOS
brew install yt-dlp

# Ubuntu/Debian
sudo apt-get update && sudo apt-get install yt-dlp

# Windows (download from): https://github.com/yt-dlp/yt-dlp/releases
```

### Step 3: Start the Servers
```bash
# Terminal 1 - Backend
cd backend
npm start

# Terminal 2 - Frontend
cd frontend
npm run dev
```

### Step 4: Try It Out!
1. Open http://localhost:5173 in browser
2. Go to **Media** tab
3. In "Upload from device" mode, scroll down
4. You'll see **"Or Fetch Video 1 from URL"** sections
5. Paste a video URL (see examples below)
6. Click **"Fetch Video"** button
7. Watch the progress bar as it downloads
8. Use the video in your editor just like a regular upload!

---

## 📹 Test URLs to Try

### YouTube (requires yt-dlp)
```
https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

### Google Drive
```
https://drive.google.com/file/d/1_SAMPLE_FILE_ID/view
```
Make sure file is shared with "Anyone with link"

### Dropbox
```
https://www.dropbox.com/s/SAMPLE_PATH/video.mp4?dl=0
```

### Direct URL (works immediately)
```
https://commondatastorage.googleapis.com/gtv-videos-library/sample/BigBuckBunny.mp4
```

---

## 🎯 What You Can Now Do

✅ Download YouTube videos directly into your editor  
✅ Import from Google Drive without manual downloading  
✅ Use Dropbox links as video sources  
✅ Stream from any HTTPS video server  
✅ See real-time download progress  
✅ Handle errors gracefully with helpful messages  

---

## 🐛 Troubleshooting

### "yt-dlp not found" error
- Install yt-dlp (see Step 2 above)
- Or just use YouTube links will fail, but other sources work fine

### "Access denied" for Google Drive
- Right-click file → Share → Change to "Anyone with the link"

### Download stuck
- Check your internet connection
- Large files may take a while (100MB ≈ 30-60 seconds)

### Still not working?
- Check browser console (F12) for error details
- Make sure both backend and frontend servers are running
- Verify the URL works in your browser directly

---

## 📖 Full Documentation

See `CLOUD_VIDEO_SETUP.md` for:
- Detailed architecture explanation
- Backend API reference
- Configuration options
- Security considerations
- Future enhancement ideas

---

## ✨ That's It!

You now have cloud video URL support in your converter app. Your users can paste video URLs from their favorite sources and the app handles everything else! 🎉

Questions? Check `CLOUD_VIDEO_SETUP.md` for detailed info.
