# 🎧 LongMix Studio

A standalone tab in NexEditor (sidebar: Editor · Montage · Shorts · **LongMix** · Captions) that
turns a folder of songs plus a few background scenes into one long mix video with YouTube
chapters — replacing the standalone LongMix Studio tool.

It works like Shorts or Captions: a guided four-step wizard, then the mix renders on the server
and comes back as a finished video to **preview and download**. The editor is optional — "Open
in the editor" hands the same clips to the timeline for hand-editing, but nobody has to go
there. Under the hood it posts to the same `/api/editor/export` route the editor's own Export
button uses, so a long mix is rendered by exactly the same pipeline, with the same
preview-matches-export guarantee, as anything assembled by hand.

---

## 📦 Files created

| File | Purpose |
|------|---------|
| `frontend/src/components/LongMixPanel.jsx` | The 4-step wizard (Songs → Background → Settings → Build) |
| `frontend/src/components/LongMixPanel.css` | Its styling, using the existing panel tokens |
| `frontend/src/timeline/longMix.js` | The assembler: songs/scenes → clips, and chapters back out of the timeline |
| `frontend/src/timeline/motionPresets.js` | Ken Burns presets (zoom in/out, pan L→R, pan R→L) as plain keyframes |
| `frontend/src/timeline/clipKinds.js` | `isVideoLikeClip` / `isImageClip` / `laneTypeForClip` |
| `frontend/src/timeline/exportRequest.js` | The render request, shared by the editor's Export button and LongMix's Create |
| `backend/services/filterGraph/clipKinds.js` | The export-side mirror of the same two questions |

## 📝 Files modified

| File | Changes |
|------|---------|
| `backend/middleware/upload.js` | `IMAGE_MIME` added to the allow-list; per-request file cap raised from 6 to 200 |
| `backend/routes/exportTimeline.js` | Image inputs (`-loop 1 -framerate -t`), **one ffmpeg input per clip**, `-filter_complex_script` for very large graphs, clip-id validation |
| `backend/services/filterGraph/index.js` | Image clips render on lane 0 and overlay lanes; inputs keyed by clip id |
| `backend/services/filterGraph/effects/transform.js` | `scaleX`/`scaleY` are keyframeable via `scale=…:eval=frame` |
| `frontend/src/hooks/usePersistedEditorState.js` | `createImageClip`, `scaleX`/`scaleY` keyframe tracks, `chapterTitle` on audio clips |
| `frontend/src/timeline/useTimelinePlayer.js` | `<img>` pool for stills, keyframed scale in the canvas preview |
| `frontend/src/components/RightPanel.jsx` | Scale keyframe diamond + the **Animate** preset row |
| `frontend/src/components/BottomTimeline.jsx` | Image clip blocks; waveforms/filmstrips only build for clips actually on screen |
| `frontend/src/components/EditorPanel.jsx`, `CenterPanel.jsx`, `LeftSidebar.jsx`, `TopBar.jsx`, `App.jsx`, `index.css` | Tab wiring, image import, image clip styling |

---

## 🧭 The flow

Each step states what it is for and what it needs; Back/Next sits in the same place on every
step with the blocking reason beside it, and a step can't be opened until the ones before it
are satisfied.

1. **Songs** — add the tracks, reorder them, rename them (the name becomes the chapter title).
2. **Background** — one image is enough for a whole mix; add more to have the picture change.
3. **Settings** — crossfade, how scenes change, camera move, video size, optional looping.
4. **Create** — renders on the server with a progress bar, then shows the video with
   **Download**, **Open in the editor**, and the chapter list with **Copy chapters**.

## 🎬 How a mix is assembled

1. **Songs** are placed end to end on **two alternating audio lanes**, each overlapping the
   previous by the crossfade length with matching fade-in/fade-out. Alternating lanes matter:
   two clips overlapping on one lane would be ambiguous to the preview (which resolves one
   active clip per lane), while across two lanes both the preview and the export simply mix
   them — so the crossfade you hear while editing is the one that renders.
2. **Scenes** sit on video lane 0 for the whole runtime — one continuous background, one per
   song, or one every N minutes. Adjacent scenes get a real `transitionOut` crossfade, placed
   at exactly the overlap point `transitions.js` requires for a blend to render.
3. **Stills** are given a slow camera move so the picture is never frozen. It's a normal
   keyframe set, so "None" in the inspector's Animate row removes it and the handles still work.
4. **Chapters** are derived from the very clips that were sent to the renderer, so the
   timestamps cannot drift from the file that comes back.
5. **Target duration** repeats the playlist to reach a runtime. It warns about YouTube's
   repetitious-content policy when enabled.

---

## ⚠️ The memory fix (why exports of long mixes work at all)

The export used to open each **source file** once and reference that input from every clip
using it. When two clips fed by one input play minutes apart, ffmpeg inserts a `split`, and a
split whose branches are consumed minutes apart must hold every frame in between in memory.
A long mix cycling five backgrounds across twenty scenes is exactly that shape.

Measured before the change, at 1280×720:

| lane-0 scenes | scene length | peak ffmpeg RSS |
|---|---|---|
| 4 | 10 s | 301 MB |
| 6 | 10 s | 1 532 MB |
| 8 | 10 s | 3 884 MB |
| 6 | 30 s | 3 692 MB |

Opening one ffmpeg input **per clip** (one extra decoder, nothing else) makes it flat: 8 scenes
now peak at 393 MB, and a 25-song / 25-scene / 91-minute timeline renders at ~610 MB with 54
file descriptors.

---

## 🧪 What was verified

- Ken Burns geometry matches the canvas preview's own `drawW = vw × fitScale × scaleX` to within
  a pixel of even-size rounding, measured frame by frame out of a real render.
- An overlay-lane clip with a camera move keeps its transparency (this is why `scale=…:eval=frame`
  is used and not `zoompan`, which silently drops the alpha channel).
- A 12-song / 12-scene mix renders to exactly the runtime the panel predicted, and every copied
  chapter timestamp lands on the right track in the rendered audio.
- Every state of the panel (empty, mid-wizard, rendering, finished) renders without throwing.
- Frontend builds clean; no new lint errors.

## 🔭 Known limits

- **Free-plan exports** are still capped by `FREE_EXPORT_MAX_SECONDS`, so a long mix needs Pro.
- A **video** scene shorter than its window plays out and leaves black until the next scene —
  trim or extend it on the timeline, or use a still.
- Pan presets keep the picture inside its own overhang. Pushing `Position` far past that in the
  inspector shows black at the frame edge in the preview, and the export clamps instead.
