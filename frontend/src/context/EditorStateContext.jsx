import { createContext, useContext, useMemo } from 'react';

// Split into two contexts so consumers that only care about the
// timeline/selection (not the playhead) can subscribe to just that half.
// RightPanel does read the playhead now (M3, to resolve/edit keyframed
// property values at the current point in a clip), but EditorPanel's media
// grid and other timeline-only consumers still benefit from not
// re-rendering on every playback tick.
const EditorTimelineContext = createContext(null);
const EditorPlaybackContext = createContext(null);

export function EditorStateProvider({ timelineValue, playbackValue, children }) {
  return (
    <EditorTimelineContext.Provider value={timelineValue}>
      <EditorPlaybackContext.Provider value={playbackValue}>
        {children}
      </EditorPlaybackContext.Provider>
    </EditorTimelineContext.Provider>
  );
}

export function useEditorTimeline() {
  const context = useContext(EditorTimelineContext);
  if (!context) {
    throw new Error('useEditorTimeline must be used within an EditorStateProvider');
  }
  return context;
}

export function useEditorPlayback() {
  const context = useContext(EditorPlaybackContext);
  if (!context) {
    throw new Error('useEditorPlayback must be used within an EditorStateProvider');
  }
  return context;
}

// Convenience helper for consumers (like RightPanel) that only need to derive
// the currently-selected clip, without needing to know how selection is
// tracked internally.
export function useSelectedEditorClip() {
  const { timeline, selectedClipId } = useEditorTimeline();
  return useMemo(
    () => timeline.find((clip) => clip.id === selectedClipId) || null,
    [timeline, selectedClipId],
  );
}
