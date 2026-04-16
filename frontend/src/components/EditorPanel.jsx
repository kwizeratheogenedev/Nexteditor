import React, { useState, useRef, useEffect } from 'react';

function EditorPanel() {
  const [timeline, setTimeline] = useState([]);
  const [playhead, setPlayhead] = useState(0); // in seconds
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  
  const videoRef = useRef();
  const fileInputRef = useRef();
  const animationRef = useRef();

  // The total duration of all clips in the timeline sequentially
  const totalDuration = timeline.reduce((acc, clip) => acc + (clip.trimmedEnd - clip.trimmedStart), 0);

  // Cleanup object URLs when timeline changes to prevent memory leaks
  useEffect(() => {
    return () => {
      timeline.forEach(clip => {
        if (clip.url) {
          URL.revokeObjectURL(clip.url);
        }
      });
    };
  }, []);

  const handleVideoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const tempVideo = document.createElement('video');
      tempVideo.src = url;
      tempVideo.onloadedmetadata = () => {
         setTimeline(prev => [...prev, {
            id: Date.now(),
            file: file,
            url: url,
            duration: tempVideo.duration,
            trimmedStart: 0,
            trimmedEnd: tempVideo.duration,
         }]);
      };
    }
  };

  const handleSplit = () => {
    // Find which clip the playhead is currently over
    let accumulatedTime = 0;
    let targetIndex = -1;
    let localTime = 0;

    for (let i = 0; i < timeline.length; i++) {
        const clipDuration = timeline[i].trimmedEnd - timeline[i].trimmedStart;
        if (playhead >= accumulatedTime && playhead < accumulatedTime + clipDuration) {
            targetIndex = i;
            localTime = playhead - accumulatedTime;
            break;
        }
        accumulatedTime += clipDuration;
    }

    if (targetIndex !== -1) {
        const clipToSplit = timeline[targetIndex];
        const splitPoint = clipToSplit.trimmedStart + localTime;

        // Clip 1 (Left Half)
        const leftClip = {
            ...clipToSplit,
            trimmedEnd: splitPoint
        };
        // Clip 2 (Right Half)
        const rightClip = {
            ...clipToSplit,
            id: Date.now() + 1, // new id
            trimmedStart: splitPoint
        };

        const newTimeline = [...timeline];
        newTimeline.splice(targetIndex, 1, leftClip, rightClip);
        setTimeline(newTimeline);
    }
  };

  // Canvas / Video Sync Logic
  useEffect(() => {
    if (!videoRef.current || timeline.length === 0) return;

    // Find active clip
    let accumulatedTime = 0;
    for (let i = 0; i < timeline.length; i++) {
        const clipDur = timeline[i].trimmedEnd - timeline[i].trimmedStart;
        if (playhead >= accumulatedTime && playhead < accumulatedTime + clipDur) {
            if (activeClipIndex !== i) {
                setActiveClipIndex(i);
                videoRef.current.src = timeline[i].url;
            }
            const localTarget = timeline[i].trimmedStart + (playhead - accumulatedTime);
            // Only seek if we are far off (to prevent stuttering during playback)
            if (Math.abs(videoRef.current.currentTime - localTarget) > 0.2 && !isPlaying) {
                videoRef.current.currentTime = localTarget;
            }
            break;
        }
        accumulatedTime += clipDur;
    }
  }, [playhead, timeline, isPlaying, activeClipIndex]);

  // Reset video when playhead resets to 0
  useEffect(() => {
    if (playhead === 0 && videoRef.current && timeline.length > 0) {
      videoRef.current.pause();
      videoRef.current.currentTime = timeline[0].trimmedStart;
    }
  }, [playhead, timeline]);

  const togglePlayback = () => {
    if (isPlaying) {
        videoRef.current.pause();
        cancelAnimationFrame(animationRef.current);
    } else {
        // Ensure correct clip is loaded before playing
        let accumulatedTime = 0;
        for (let i = 0; i < timeline.length; i++) {
            const clipDur = timeline[i].trimmedEnd - timeline[i].trimmedStart;
            if (playhead >= accumulatedTime && playhead < accumulatedTime + clipDur) {
                if (activeClipIndex !== i) {
                    setActiveClipIndex(i);
                    videoRef.current.src = timeline[i].url;
                    videoRef.current.currentTime = timeline[i].trimmedStart + (playhead - accumulatedTime);
                }
                break;
            }
            accumulatedTime += clipDur;
        }
        
        videoRef.current.play();
        const updatePlayhead = () => {
            if (!videoRef.current || videoRef.current.ended) {
                setIsPlaying(false);
                setPlayhead(0);
                if (videoRef.current) {
                    videoRef.current.currentTime = timeline[0]?.trimmedStart || 0;
                }
                return;
            }
            
            const currentLocal = videoRef.current.currentTime;
            let acc = 0;
            for(let i=0; i<activeClipIndex; i++) {
                acc += (timeline[i].trimmedEnd - timeline[i].trimmedStart);
            }
            const newGlobalPlayhead = acc + (currentLocal - timeline[activeClipIndex].trimmedStart);
            setPlayhead(newGlobalPlayhead);
            
            // Check if we need to switch clips natively
            if (currentLocal >= timeline[activeClipIndex].trimmedEnd) {
                 if (activeClipIndex + 1 < timeline.length) {
                     setActiveClipIndex(activeClipIndex + 1);
                     videoRef.current.src = timeline[activeClipIndex + 1].url;
                     videoRef.current.currentTime = timeline[activeClipIndex + 1].trimmedStart;
                     videoRef.current.play();
                 } else {
                     videoRef.current.pause();
                     setIsPlaying(false);
                     setPlayhead(0);
                     if (videoRef.current) {
                         videoRef.current.currentTime = timeline[0]?.trimmedStart || 0;
                     }
                     return;
                 }
            }
            animationRef.current = requestAnimationFrame(updatePlayhead);
        };
        animationRef.current = requestAnimationFrame(updatePlayhead);
    }
    setIsPlaying(!isPlaying);
  };

  return (
    <div className="nle-container" style={{display: 'flex', flexDirection: 'column', height: '100%', gap: '1rem'}}>
      
      {/* Top Half: Bin and Player */}
      <div style={{display: 'flex', height: '50%', gap: '1rem'}}>
        {/* Media Bin */}
        <div style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '1rem', overflowY: 'auto'}}>
            <h3>Media Bin</h3>
            <button onClick={() => fileInputRef.current.click()} className="submit-btn" style={{marginTop: '1rem'}}>Import Media</button>
            <input type="file" ref={fileInputRef} onChange={handleVideoUpload} style={{display:'none'}} accept="video/*" />
            
            <div style={{marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
                {timeline.map((clip, i) => (
                    <div key={clip.id} style={{padding: '0.5rem', background: 'rgba(255,255,255,0.1)', borderRadius: '6px', fontSize: '0.9rem'}}>
                        Clip {i + 1}: {(clip.trimmedEnd - clip.trimmedStart).toFixed(2)}s
                    </div>
                ))}
            </div>
        </div>

        {/* Canvas Player */}
        <div style={{flex: 2, backgroundColor: '#000', borderRadius: '12px', position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
           {timeline.length > 0 ? (
               <video ref={videoRef} style={{maxHeight: '100%', maxWidth: '100%'}} />
           ) : (
               <p style={{color: '#666'}}>Load media to begin editing</p>
           )}
           
           <div style={{position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '10px'}}>
                <button onClick={togglePlayback} className="submit-btn" style={{padding: '0.5rem 1rem'}} disabled={timeline.length === 0}>
                    {isPlaying ? '⏸ Pause' : '▶ Play'}
                </button>
                <button onClick={handleSplit} className="submit-btn" style={{padding: '0.5rem 1rem', backgroundColor: '#e11d48'}} disabled={timeline.length === 0 || isPlaying}>
                    ✂ Split at Playhead
                </button>
           </div>
        </div>
      </div>

      {/* Bottom Half: Timeline */}
      <div style={{flex: 1, backgroundColor: '#111827', borderRadius: '12px', padding: '1rem', position: 'relative', overflowX: 'auto'}}>
          <h3 style={{marginBottom: '1rem'}}>Timeline ({totalDuration.toFixed(2)}s)</h3>
          
          <div style={{position: 'relative', height: '100px', backgroundColor: '#1f2937', borderRadius: '6px', display: 'flex'}}>
             {timeline.length === 0 && <span style={{position:'absolute', left:'50%', top:'50%', transform:'translate(-50%, -50%)', color:'#4b5563'}}>No clips in sequence</span>}
             
             {/* Render each clip as a block */}
             {timeline.map((clip, i) => {
                 // Calculate width percentage relative to total duration
                 const widthPct = ((clip.trimmedEnd - clip.trimmedStart) / totalDuration) * 100;
                 // Assign random color just to distinguish blocks easily
                 const blockColor = `hsl(${(i * 50) % 360}, 70%, 50%)`;
                 
                 return (
                     <div key={clip.id} style={{
                         width: `${widthPct}%`, 
                         height: '100%', 
                         backgroundColor: blockColor,
                         borderRight: '2px solid #000',
                         display: 'flex',
                         alignItems: 'center',
                         justifyContent: 'center',
                         color: '#fff',
                         fontSize: '0.8rem',
                         overflow: 'hidden'
                     }}>
                         Clip {i + 1}
                     </div>
                 )
             })}

             {/* Playhead Scrubber Line */}
             {timeline.length > 0 && (
                 <div 
                    style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        width: '2px',
                        backgroundColor: '#ef4444',
                        left: `${(playhead / totalDuration) * 100}%`,
                        zIndex: 10,
                        cursor: 'ew-resize'
                    }}
                 >
                    <div style={{
                        position: 'absolute',
                        top: '-10px',
                        left: '-5px',
                        width: '12px',
                        height: '12px',
                        backgroundColor: '#ef4444',
                        borderRadius: '50%'
                    }} />
                 </div>
             )}
          </div>

          {/* Simple invisible overlay to handle click-to-seek */}
          {timeline.length > 0 && (
              <div 
                  onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const clickX = e.clientX - rect.left;
                      const pct = clickX / rect.width;
                      setPlayhead(pct * totalDuration);
                  }}
                  style={{position: 'absolute', top: '3rem', left: '1rem', right: '1rem', height: '100px', zIndex: 5, cursor: 'pointer'}}
              />
          )}

      </div>
    </div>
  );
}

export default EditorPanel;
