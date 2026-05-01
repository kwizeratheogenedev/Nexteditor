# MediaPanel UI Layout - Visual Reference

## New Per-Field Design

```
┌─────────────────────────────────────────────────────────────────┐
│                     MEDIA PANEL CONTAINER                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────┐            │
│  │    Video 1       [✕] │  │    Video 2       [✕] │            │
│  ├──────────────────────┤  ├──────────────────────┤            │
│  │ [📁 From Device][🔗 From URL]                  │            │
│  ├──────────────────────┤  ├──────────────────────┤            │
│  │  Choose File         │  │  Choose File         │            │
│  │                      │  │                      │            │
│  │  Click to browse     │  │  Click to browse     │            │
│  └──────────────────────┘  └──────────────────────┘            │
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────┐            │
│  │    Video 3       [✕] │  │     Audio        [✕] │            │
│  ├──────────────────────┤  ├──────────────────────┤            │
│  │ [📁 From Device][🔗 From URL]                  │            │
│  ├──────────────────────┤  ├──────────────────────┤            │
│  │  Choose File         │  │  Choose File         │            │
│  │                      │  │                      │            │
│  │  Click to browse     │  │  Click to browse     │            │
│  └──────────────────────┘  └──────────────────────┘            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Device Mode

```
┌──────────────────────┐
│    Video 1       [✕] │
├──────────────────────┤
│ [📁 From Device] [🔗 From URL]   ← Toggle pill
├──────────────────────┤
│                      │
│  [Choose File]       │  ← Button to browse
│                      │
└──────────────────────┘

After file selected:

┌──────────────────────┐
│    Video 1       [✕] │
├──────────────────────┤
│ [📁 From Device] [🔗 From URL]
├──────────────────────┤
│ ✓ movie.mp4          │  ← Green checkmark + name
│ Duration: 2:45       │
│ Size: 125.5 MB       │
└──────────────────────┘
```

## URL Mode

```
┌──────────────────────┐
│    Video 1       [✕] │
├──────────────────────┤
│ [📁 From Device] [🔗 From URL]   ← Toggle pill
├──────────────────────┤
│                      │
│ [URL input...] [🎬]  │  ← Icon auto-detects YouTube
│ [Fetch]              │
│                      │
└──────────────────────┘

During fetch:

┌──────────────────────┐
│    Video 1           │
├──────────────────────┤
│ [📁 From Device] [🔗 From URL]
├──────────────────────┤
│ [URL input...] [🎬]  │
│ [Downloading...]     │  ← Button state changes
│ ▓▓▓▓▓░░░░░░░░░░░░░░  │  ← Progress bar
│ 34%                  │
└──────────────────────┘

On success:

┌──────────────────────┐
│    Video 1       [✕] │
├──────────────────────┤
│ [📁 From Device] [🔗 From URL]
├──────────────────────┤
│ ✓ video_12345abc     │
│ Duration: 8:30       │
└──────────────────────┘

On error:

┌──────────────────────┐
│    Video 1           │
├──────────────────────┤
│ [📁 From Device] [🔗 From URL]
├──────────────────────┤
│ [URL input...]   [❌] │
│ [Fetch]              │
│ ┌──────────────────┐ │
│ │ Access denied.   │ │  ← Red error box
│ │ File is private  │ │
│ └──────────────────┘ │
└──────────────────────┘
```

## URL Type Detection Icons

```
YouTube          →  🎬 (with label "YouTube")
Google Drive     →  📂 (with label "Google Drive")  
Dropbox          →  📦 (with label "Dropbox")
Direct URL       →  🔗 (with label "Direct URL")
```

## Field States

```
IDLE STATE
┌──────────────────────┐
│    Video 1           │
├──────────────────────┤
│ [📁 From Device] [🔗 From URL]
├──────────────────────┤
│  Click "Choose File" │  ← Hint text
│  or paste a URL      │
└──────────────────────┘

LOADING STATE
┌──────────────────────┐
│    Video 1           │
├──────────────────────┤
│ [📁] [🔗]            │
├──────────────────────┤
│ [Input...] [🎬]      │
│ [Downloading...]     │  ← Disabled, loading state
│ ▓▓▓▓▓░░░░░░░░░░░░░░  │
│ 45%                  │
└──────────────────────┘

READY STATE
┌──────────────────────┐
│    Video 1       [✕] │  ← Clear button appears
├──────────────────────┤
│ [📁 From Device] [🔗 From URL]
├──────────────────────┤
│ ✓ filename.mp4       │  ← Green checkmark
│ Duration: 3:20       │
│ Size: 87.2 MB        │
└──────────────────────┘

ERROR STATE
┌──────────────────────┐
│    Video 1           │
├──────────────────────┤
│ [📁] [🔗]            │
├──────────────────────┤
│ [Input...] [❌]      │
│ [Fetch]              │
│ ┌──────────────────┐ │
│ │ Invalid URL.     │ │  ← Red error message
│ │ Check format     │ │
│ └──────────────────┘ │
└──────────────────────┘
```

## Responsive Breakpoints

### Desktop (4 columns)
```
[Card1] [Card2] [Card3] [Card4]
```

### Tablet (2 columns)
```
[Card1] [Card2]
[Card3] [Card4]
```

### Mobile (1 column)
```
[Card1]
[Card2]
[Card3]
[Card4]
```

## Color Scheme

| Element | Color | Use Case |
|---------|-------|----------|
| **Active Toggle** | #0066cc (Blue) | Selected mode |
| **Checkmark** | #27ae60 (Green) | Ready state |
| **Error** | #c33 (Red) | Error state |
| **Progress Bar** | #0066cc → #00b8ff | Loading animation |
| **Background** | #f5f5f5 | Panel background |
| **Card Border** | #e0e0e0 | Field card outline |

## Interaction Flow

```
1. User clicks toggle
   ↓
2. Input method changes (From Device ↔ From URL)
   ↓
3. Either:
   a) Click "Choose File" → Select file → Auto-detect duration
   b) Paste URL → Click "Fetch" → Download with progress
   ↓
4. Field reaches "ready" state
   ↓
5. Clear button (✕) appears
   ↓
6. User can:
   - Proceed to process (all 3 videos + audio ready)
   - Click ✕ to reset and choose different file
   - Switch to different source mode and repeat
```

## Accessibility Features

- All buttons have hover states
- All inputs have focus states (blue outline)
- Error messages in plain text (not just icons)
- Progress percentage shown as text (not just visual bar)
- Keyboard support (Enter to fetch in URL mode)
- Clear labels and hints for guidance
- Status clearly indicated by visual design (green, red, blue)

## Animation

- Progress bar fills smoothly (0.3s ease transition)
- Hover effects on all interactive elements
- Loading state changes button appearance
- Smooth state transitions (no jarring changes)

---

## Implementation Notes for Developers

### Key Variables per Field
```javascript
// Device Mode
state.file              // File object
state.fileName          // "video.mp4"
state.duration          // 120.5

// URL Mode
state.url               // "https://youtube.com/watch?v=..."
state.filePath          // "/uploads/abc123def456"
state.fileName          // "abc123def456"
state.duration          // 240.0

// Always Available
state.sourceMode        // 'device' or 'url'
state.status            // 'idle' | 'loading' | 'ready' | 'error'
state.progress          // 0-100
state.error             // "Error message"
```

### Styling Classes Available
- `.media-panel-container` - Main wrapper
- `.media-panel-grid` - Grid layout
- `.media-field-card` - Individual field
- `.media-field-label` - Title
- `.source-tab` - Toggle buttons (`.active` when selected)
- `.device-upload-btn` - File upload button
- `.url-input` - URL text input
- `.url-type-indicator` - Icon badge
- `.fetch-btn` - Fetch button
- `.progress-bar` - Progress container
- `.file-name` - Ready state filename
- `.error-message` - Error display

---

## Testing Checklist

- [ ] All 4 fields render at once
- [ ] Each field has independent toggle
- [ ] File upload shows duration
- [ ] File upload shows file size
- [ ] URL input detects type (shows correct icon)
- [ ] Fetch button fetches correctly
- [ ] Progress bar animates during download
- [ ] Progress updates in real-time
- [ ] Error messages display correctly
- [ ] Clear button (✕) resets field
- [ ] Can mix device and URL sources
- [ ] All fields can be set to ready simultaneously
- [ ] Responsive layout on mobile
- [ ] Responsive layout on tablet
- [ ] No console errors
