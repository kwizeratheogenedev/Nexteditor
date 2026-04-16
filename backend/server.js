const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { exec } = require('child_process'); // For checkFFmpeg
const http = require('http'); // Required for Socket.IO
const { Server } = require('socket.io'); // Socket.IO server

const app = express();
const server = http.createServer(app); // Create HTTP server for Express and Socket.IO
const port = 3000;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

app.use(cors());
app.use(express.json());

// Setup Socket.IO
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for simplicity, adjust in production
        methods: ["GET", "POST"]
    }
});

// Log Socket.IO connections
io.on('connection', (socket) => {
    console.log('A user connected via WebSocket:', socket.id);
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// Serve clips statically so the frontend can preview them
app.use('/clips', express.static(path.join(__dirname, 'clips')));

// Check FFmpeg installation on startup
function checkFFmpeg() {
    return new Promise((resolve, reject) => {
        exec('ffmpeg -version', (error, stdout, stderr) => {
            if (error) {
                console.error('FFmpeg is not installed or not in PATH.');
                console.error('Please install FFmpeg to use this application.');
                reject(new Error('FFmpeg not found'));
                return;
            }
            console.log('FFmpeg detected:', stdout.split('\n')[0]);
            resolve();
        });
    });
}

// Periodic cleanup of files older than 1 hour to prevent disk overflow
setInterval(() => {
    const clipsDir = path.join(__dirname, 'clips');
    const uploadsDir = path.join(__dirname, 'uploads');
    const now = Date.now();
    
    [clipsDir, uploadsDir].forEach(dir => {
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir).forEach(file => {
            const filePath = path.join(dir, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtime.getTime() > 60 * 60 * 1000) {
                try { fs.unlinkSync(filePath); } catch(e) {}
            }
        });
    });
}, 15 * 60 * 1000);

// Configure Multer for temp storage
const upload = multer({ dest: 'uploads/' });

function probeVideo(file) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(file, (err, metadata) => {
            if (err) return reject(err);
            resolve(metadata.format.duration);
        });
    });
}

function unlinkIfExists(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

function pickShortClipDuration(maxDuration, sourceDuration) {
    const boundedMax = Math.min(maxDuration, sourceDuration);
    const minimumPreferred = Math.min(30, boundedMax);

    if (boundedMax <= minimumPreferred) {
        return boundedMax;
    }

    const tierMinimum = boundedMax <= 60
        ? 30
        : boundedMax <= 120
            ? 60
            : 120;

    const lowerBound = Math.min(tierMinimum, boundedMax);
    return lowerBound + Math.random() * (boundedMax - lowerBound);
}

function processClip(inputFile, startTime, outputFile, taskId, io) { // Added taskId, io for progress
    return new Promise((resolve, reject) => {
        ffmpeg(inputFile)
            .setStartTime(startTime)
            .setDuration(3)
            .videoFilters([
                'scale=1280:720:force_original_aspect_ratio=decrease',
                'pad=1280:720:(ow-iw)/2:(oh-ih)/2',
                'setsar=1',
                'fps=30'
            ])
            .noAudio()
            .outputOptions(['-c:v libx264', '-preset veryfast', '-crf 23'])
            .output(outputFile)
            .on('progress', (progress) => {
                if (io && taskId) io.emit('ffmpeg-progress', { taskId: `${taskId}-subclip-${path.basename(outputFile)}`, progress });
            })
            .on('end', () => {
                if (io && taskId) io.emit('ffmpeg-complete', { taskId: `${taskId}-subclip-${path.basename(outputFile)}`, status: 'success' });
                resolve(outputFile);
            })
            .on('error', (err) => {
                if (io && taskId) io.emit('ffmpeg-complete', { taskId: `${taskId}-subclip-${path.basename(outputFile)}`, status: 'error', error: err.message });
                reject(err);
            })
            .run();
    });
}

// Ensure uploads/ and clips/ dirs exist
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('clips')) fs.mkdirSync('clips');

app.post('/api/convert', upload.fields([
    { name: 'video1', maxCount: 1 },
    { name: 'video2', maxCount: 1 },
    { name: 'video3', maxCount: 1 },
    { name: 'audio', maxCount: 1 }
]), async (req, res) => {
    try {
        // With upload.fields, files are in req.files
        const files = req.files;
        if (!files || !files.video1 || !files.video2 || !files.video3 || !files.audio) {
            return res.status(400).send('Missing files. Please upload 3 videos and 1 audio.');
        }

        const v1 = files.video1[0].path;
        const v2 = files.video2[0].path;
        const v3 = files.video3[0].path;
        const audio = files.audio[0].path;

        const taskId = `convert-${Date.now()}`; // Unique task ID for this operation
        // Get Audio Duration
        const audioDuration = await probeVideo(audio);
        console.log(`Audio duration: ${audioDuration} seconds`);

        // Get Video Durations
        const vDurations = [
            await probeVideo(v1),
            await probeVideo(v2),
            await probeVideo(v3)
        ];
        const vPaths = [v1, v2, v3];
        console.log(`Video durations: `, vDurations);

        const numClips = Math.ceil(audioDuration / 3);
        const clipPaths = [];
        const sessionId = Date.now();

        // Generate clips with random start times
        for (let i = 0; i < numClips; i++) {
            const vIndex = i % 3;
            const duration = vDurations[vIndex];
            let startTime = 0;
            
            if (duration > 3) {
                // Pick a random start time that leaves at least 3 seconds for the clip
                const maxStartTime = duration - 3;
                startTime = Math.random() * maxStartTime;
            }

            const clipPath = path.join('clips', `clip_${sessionId}_${i}.mp4`);
            console.log(`Processing clip ${i} from video ${vIndex + 1} at startTime ${startTime.toFixed(2)}s`);
            await processClip(vPaths[vIndex], startTime, clipPath, taskId, io); // Pass taskId and io
            clipPaths.push(`file '${path.resolve(clipPath).replace(/\\/g, '/')}'`);
        }

        // Create concat file
        const concatTxtPath = path.join('clips', `concat_${sessionId}.txt`);
        fs.writeFileSync(concatTxtPath, clipPaths.join('\n'));

        // Concatenate and add audio
        const outputPath = path.join('clips', `final_${sessionId}.mp4`);
        
        let outOptions = [
            '-c:a aac',       // Encode audio
            `-t ${audioDuration}`, // Trim exactly to audio length
            '-c:v copy'       // Copy video without re-encoding
        ];
        
        ffmpeg()
            .input(concatTxtPath)
            .inputOptions(['-f concat', '-safe 0'])
            .input(audio)
            .outputOptions(outOptions)
            .output(outputPath)
            .on('progress', (progress) => {
                io.emit('ffmpeg-progress', { taskId, progress });
            })
            .on('end', () => {
                console.log('Final video created.');
                io.emit('ffmpeg-complete', { taskId, status: 'success', outputPath: `final_${sessionId}.mp4` });
                res.download(outputPath, 'final_video.mp4', () => {
                    // Cleanup
                    const cleanupArray = [v1, v2, v3, audio];
                    cleanupArray.forEach(f => fs.unlinkSync(f));
                    // Optional: remove temp clips to save space
                    // We only remove the concat txt for now, let's also remove clips
                    fs.unlinkSync(concatTxtPath);
                    for (let i = 0; i < numClips; i++) {
                        fs.unlinkSync(path.join('clips', `clip_${sessionId}_${i}.mp4`));
                    }
                });
            })
            .on('error', (err) => {
                console.error('Error during final concat:', err);
                io.emit('ffmpeg-complete', { taskId, status: 'error', error: err.message });
                return res.status(500).send('Error generating video');
            })
            .run();
            
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('Server error');
    }
});

app.post('/api/burn-subtitles', upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'subtitle', maxCount: 1 }
]), async (req, res) => {
    try {
        // With upload.fields, files are in req.files
        const files = req.files;
        if (!files.video || !files.subtitle) {
            return res.status(400).send('Missing files. Please upload a video and a subtitle file. Files received: ' + JSON.stringify(Object.keys(files)));
        }

        const videoPath = files.video[0].path;
        const subPath = files.subtitle[0].path;
        const outputPath = path.join('clips', `subtitled_${Date.now()}.mp4`);
        const taskId = `burn-subtitles-${Date.now()}`; // Unique task ID

        ffmpeg(videoPath)
            .videoFilters(`subtitles='${subPath.replace(/\\/g, '/').replace(/:/g, '\\:')}'`)
            .outputOptions([
                '-c:a copy'
            ])
            .output(outputPath)
            .on('progress', (progress) => {
                io.emit('ffmpeg-progress', { taskId, progress });
            })
            .on('end', () => {
                console.log('Subtitles burned successfully.');
                io.emit('ffmpeg-complete', { taskId, status: 'success', outputPath: path.basename(outputPath) });
                res.download(outputPath, 'subtitled_video.mp4', () => {
                    // Cleanup after download
                    // Note: outputPath is deleted here, but frontend might need it. Consider keeping it for cleanup interval.
                    fs.unlinkSync(videoPath);
                    fs.unlinkSync(subPath);
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                });
            })
            .on('error', (err) => {
                console.error('Error burning subtitles:', err);
                io.emit('ffmpeg-complete', { taskId, status: 'error', error: err.message });
                res.status(500).send('Error generating subtitled video');
            })
            .run();

    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('Server error');
    }
});

app.post('/api/extract-shorts', upload.single('video'), async (req, res) => {
    try {
        // With upload.single, file is in req.file
        if (!req.file) return res.status(400).send('Missing video file.');

        const videoPath = req.file.path;
        const durationSetting = req.body.duration || '60'; // default 60s
        const maxDuration = parseInt(durationSetting, 10);
        const aspectRatio = req.body.aspectRatio || '9:16';
        const mainTaskId = `extract-shorts-${Date.now()}`; // Main task ID for this request

        if (!Number.isFinite(maxDuration) || maxDuration <= 0) {
            unlinkIfExists(videoPath);
            return res.status(400).send('Invalid shorts duration.');
        }
        
        const sourceDuration = await probeVideo(videoPath);
        const sessionId = Date.now();
        const results = [];

        if (sourceDuration < 10) {
            unlinkIfExists(videoPath);
            return res.status(400).send('Video is too short for shorts extraction.');
        }

        let vFilters = [];
        if (aspectRatio === '16:9') {
            vFilters = [
                'scale=1920:1080:force_original_aspect_ratio=decrease',
                'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black'
            ];
        } else {
            vFilters = [
                'scale=1080:1920:force_original_aspect_ratio=decrease',
                'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black'
            ];
        }

        const processPromises = [];
        
        for (let i = 0; i < 3; i++) {
            // Pick a random duration within the selected tier and keep it inside the source length.
            const clipDur = pickShortClipDuration(maxDuration, sourceDuration);
            const maxStart = Math.max(0, sourceDuration - clipDur);
            const startTime = Math.random() * maxStart;

            const outputPath = path.join('clips', `short_${sessionId}_${i}.mp4`);
            const p = new Promise((resolve, reject) => {
                ffmpeg(videoPath)
                    .setStartTime(startTime)
                    .setDuration(clipDur)
                    .videoFilters(vFilters)
                    .outputOptions(['-c:v libx264', '-preset veryfast', '-crf 23', '-c:a aac'])
                    .output(outputPath)
                    .on('progress', (progress) => {
                        io.emit('ffmpeg-progress', { taskId: `${mainTaskId}-short-${i}`, progress });
                    })
                    .on('end', () => {
                        io.emit('ffmpeg-complete', { taskId: `${mainTaskId}-short-${i}`, status: 'success', outputPath: path.basename(outputPath) });
                        results[i] = {
                            id: `short_${sessionId}_${i}`,
                            url: `${BACKEND_URL}/clips/short_${sessionId}_${i}.mp4`,
                            formatStrategy: 'letterbox',
                            aspectRatio,
                            startTime,
                            duration: clipDur,
                            originalVideo: videoPath // Kept on disk until the 1hr cleaner deletes it
                        };
                        resolve();
                    })
                    .on('error', (err) => {
                        io.emit('ffmpeg-complete', { taskId: `${mainTaskId}-short-${i}`, status: 'error', error: err.message });
                        reject(err);
                    })
                    .run();
            });
            processPromises.push(p);
        }

        await Promise.all(processPromises);
        res.json({ shorts: results });
        
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error');
    }
});

app.post('/api/reformat-short', async (req, res) => {
    try {
        const { originalVideo, startTime, duration, formatStrategy, id, aspectRatio } = req.body;
        
        if (!originalVideo || startTime == null || duration == null || !formatStrategy || !id) {
            return res.status(400).send('Missing arguments for re-formatting.');
        }
        
        if (!fs.existsSync(originalVideo)) {
            return res.status(404).send('Original source video has expired or been deleted from the server.');
        }

        const taskId = `reformat-short-${Date.now()}`; // Unique task ID
        const newId = `${id}_edit_${Date.now()}`;
        const outputPath = path.join('clips', `${newId}.mp4`);

        let vFilters = [];
        if (formatStrategy === 'crop') {
            if (aspectRatio === '16:9') {
                 vFilters = ['scale=1920:-1', 'crop=1920:1080'];
            } else {
                 vFilters = ['scale=-1:1920', 'crop=1080:1920'];
            }
        } else { // default letterbox
            if (aspectRatio === '16:9') {
                 vFilters = [
                     'scale=1920:1080:force_original_aspect_ratio=decrease',
                     'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black'
                 ];
            } else {
                 vFilters = [
                     'scale=1080:1920:force_original_aspect_ratio=decrease',
                     'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black'
                 ];
            }
        }

        ffmpeg(originalVideo)
            .setStartTime(startTime)
            .setDuration(duration)
            .videoFilters(vFilters)
            .outputOptions(['-c:v libx264', '-preset veryfast', '-crf 23', '-c:a aac'])
            .output(outputPath)
            .on('progress', (progress) => {
                io.emit('ffmpeg-progress', { taskId, progress });
            })
            .on('end', () => {
                res.json({
                    id: newId,
                    url: `${BACKEND_URL}/clips/${newId}.mp4`,
                    formatStrategy,
                    aspectRatio,
                    startTime,
                    duration,
                    originalVideo
                });
                io.emit('ffmpeg-complete', { taskId, status: 'success', outputPath: path.basename(outputPath) });
            })
            .on('error', (err) => {
                console.error(err);
                io.emit('ffmpeg-complete', { taskId, status: 'error', error: err.message });
                res.status(500).send('Error rendering new format');
            })
            .run();
            
    } catch (e) {
        console.error(e);
        res.status(500).send('Server error');
    }
});

server.listen(port, async () => { // Use server.listen instead of app.listen
    try {
        await checkFFmpeg();
        console.log(`Video processing backend is listening on port ${port}`);
    } catch (error) {
        console.error('Failed to start server due to missing FFmpeg.');
        process.exit(1);
    }
});
