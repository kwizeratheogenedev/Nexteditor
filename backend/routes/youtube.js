import express from 'express';
import fs from 'fs';
import path from 'path';
import { PassThrough } from 'stream';
import { google } from 'googleapis';
import { getFileSource } from '../services/fileResolve.js';
import { getIo } from '../socket.js';
import { requireAuth, requireSubscription } from '../middleware/auth.js';

const router = express.Router();
const clipsDir = path.resolve(process.cwd(), 'clips');

// youtube.upload lets us insert/update videos; youtube.readonly lets the
// "Connected as ..." status check read the channel's own name/thumbnail.
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

// A generic, always-valid category ("People & Blogs") - avoids YouTube
// rejecting the initial upload for lacking one; the post-upload details
// panel doesn't expose category choice (out of scope), so every upload
// gets this same default.
const DEFAULT_CATEGORY_ID = '22';

function getOAuthClient() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// Tokens are stored per-user on the User doc (user.youtube), not in a shared
// global file - two different logged-in users must not share one channel
// connection. A refreshed access token (Google rotates these automatically
// once the OAuth2 client has a refresh_token) needs to be persisted back to
// the user doc, or every request after the first would re-hit the token
// endpoint - `tokens` on the 'tokens' event only carries the FIELDS that
// changed, so the saved refresh_token (which Google normally only issues
// once) must be preserved.
async function getAuthorizedClient(user) {
  const oauth2Client = getOAuthClient();
  if (!oauth2Client || !user?.youtube?.refreshToken) return null;
  oauth2Client.setCredentials({
    access_token: user.youtube.accessToken || undefined,
    refresh_token: user.youtube.refreshToken,
    expiry_date: user.youtube.expiryDate || undefined,
    scope: user.youtube.scope || undefined,
  });
  oauth2Client.on('tokens', (fresh) => {
    user.youtube.accessToken = fresh.access_token || user.youtube.accessToken;
    user.youtube.refreshToken = fresh.refresh_token || user.youtube.refreshToken;
    user.youtube.expiryDate = fresh.expiry_date || user.youtube.expiryDate;
    user.youtube.scope = fresh.scope || user.youtube.scope;
    user.save().catch((err) => console.error('Failed to persist refreshed YouTube token:', err));
  });
  return oauth2Client;
}

function htmlMessage(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:60px 24px;background:#0a0a12;color:#e5e5f0;">
    <h2 style="margin-bottom:8px;">${title}</h2>
    <p style="color:#9a9ab0;">${body}</p>
    <script>setTimeout(function(){ window.close(); }, 1800);</script>
  </body></html>`;
}

router.use(requireAuth);

router.get('/auth/url', (req, res) => {
  const oauth2Client = getOAuthClient();
  if (!oauth2Client) {
    return res.status(500).json({
      error: 'YouTube isn\'t configured yet - add YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET and YOUTUBE_REDIRECT_URI to backend/.env, then restart the server.',
    });
  }
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // forces Google to always hand back a refresh_token, even on a re-consent
    scope: SCOPES,
  });
  res.json({ url });
});

router.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    res.status(400).send(htmlMessage('Connection cancelled', String(error)));
    return;
  }
  const oauth2Client = getOAuthClient();
  if (!oauth2Client || !code) {
    res.status(400).send(htmlMessage('Connection failed', 'Missing authorization code.'));
    return;
  }
  try {
    const { tokens } = await oauth2Client.getToken(String(code));
    req.user.youtube = {
      accessToken: tokens.access_token || null,
      refreshToken: tokens.refresh_token || req.user.youtube?.refreshToken || null,
      expiryDate: tokens.expiry_date || null,
      scope: tokens.scope || null,
      channelTitle: req.user.youtube?.channelTitle || null,
      channelThumbnail: req.user.youtube?.channelThumbnail || null,
    };
    await req.user.save();
    res.send(htmlMessage('Connected!', 'You can close this tab and go back to NexEditor.'));
  } catch (err) {
    res.status(500).send(htmlMessage('Connection failed', err.message || 'Unknown error'));
  }
});

router.get('/auth/status', async (req, res) => {
  const configured = Boolean(getOAuthClient());
  const oauth2Client = await getAuthorizedClient(req.user);
  if (!oauth2Client) {
    res.json({ connected: false, configured });
    return;
  }
  try {
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const { data } = await youtube.channels.list({ part: ['snippet'], mine: true });
    const channel = data.items?.[0];
    const channelTitle = channel?.snippet?.title || null;
    const channelThumbnail = channel?.snippet?.thumbnails?.default?.url || null;
    req.user.youtube.channelTitle = channelTitle;
    req.user.youtube.channelThumbnail = channelThumbnail;
    await req.user.save();
    res.json({ connected: true, configured, channelTitle, channelThumbnail });
  } catch (err) {
    // A saved-but-revoked/expired token still counts as "not connected" to
    // the frontend, which should fall back to the connect flow.
    res.json({ connected: false, configured, error: err.message });
  }
});

router.post('/auth/disconnect', async (req, res) => {
  req.user.youtube = { accessToken: null, refreshToken: null, expiryDate: null, scope: null, channelTitle: null, channelThumbnail: null };
  await req.user.save();
  res.json({ ok: true });
});

const progressByJob = new Map();

router.get('/upload/progress/:jobId', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(progressByJob.get(req.params.jobId) || { percent: 0 });
});

router.post('/upload', requireSubscription('youtubeUpload'), async (req, res) => {
  const oauth2Client = await getAuthorizedClient(req.user);
  if (!oauth2Client) {
    res.status(401).json({ error: 'Not connected to YouTube yet.' });
    return;
  }

  const { fileName, filePath: requestedPath, title, privacyStatus } = req.body || {};
  let sourcePath;
  try {
    const candidate = requestedPath || (fileName ? path.join(clipsDir, fileName) : null);
    sourcePath = getFileSource(null, candidate, [clipsDir]);
  } catch (err) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    res.status(400).json({ error: 'Video file not found - it may have been cleaned up. Re-run the montage and try again.' });
    return;
  }

  const jobId = req.headers['x-job-id'];
  const socketId = req.headers['x-socket-id'];
  const socket = socketId ? getIo()?.sockets.sockets.get(socketId) : null;

  const emitProgress = (percent) => {
    const payload = { percent: Math.min(100, Math.round(percent)) };
    if (jobId) progressByJob.set(jobId, { ...payload, updatedAt: Date.now() });
    socket?.emit('youtube-upload-progress', payload);
  };

  try {
    const fileSize = fs.statSync(sourcePath).size;
    // Track bytes as they're read off disk and piped into the request body
    // - the googleapis/gaxios upload consumes the stream roughly as fast as
    // the network allows (it isn't buffered upfront), so this tracks real
    // upload progress closely enough for a progress bar, without depending
    // on gaxios's own upload-progress event support (inconsistent across
    // versions in a Node/stream context).
    const readStream = fs.createReadStream(sourcePath);
    const trackedStream = new PassThrough();
    let bytesRead = 0;
    readStream.on('data', (chunk) => {
      bytesRead += chunk.length;
      emitProgress(fileSize ? (bytesRead / fileSize) * 100 : 0);
    });
    readStream.on('error', (err) => trackedStream.destroy(err));
    readStream.pipe(trackedStream);

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: title?.trim() || `NexEditor export - ${new Date().toLocaleString()}`,
          categoryId: DEFAULT_CATEGORY_ID,
        },
        status: {
          privacyStatus: privacyStatus || 'private',
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: trackedStream,
      },
    });

    emitProgress(100);
    const videoId = response.data.id;
    res.json({ videoId, videoUrl: `https://youtube.com/watch?v=${videoId}` });
  } catch (err) {
    console.error('YouTube upload failed:', err);
    res.status(500).json({ error: err.errors?.[0]?.message || err.message || 'Upload failed.' });
  }
});

// Saves the "finish your details" panel's title/description/tags/hashtags
// back to an already-uploaded video. `part=snippet` requires title AND
// categoryId in the request body or YouTube clears them - fetching the
// existing snippet first and spreading it under the new fields keeps
// whatever wasn't explicitly changed (categoryId, etc.) intact.
router.patch('/videos/:videoId', requireSubscription('youtubeUpload'), async (req, res) => {
  const oauth2Client = await getAuthorizedClient(req.user);
  if (!oauth2Client) {
    res.status(401).json({ error: 'Not connected to YouTube yet.' });
    return;
  }

  const { videoId } = req.params;
  const { title, description, tags, hashtags, privacyStatus } = req.body || {};

  try {
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const { data } = await youtube.videos.list({ part: ['snippet', 'status'], id: [videoId] });
    const existing = data.items?.[0];
    if (!existing) {
      res.status(404).json({ error: 'Video not found on YouTube.' });
      return;
    }

    // YouTube has no dedicated hashtag field - typed hashtags become
    // clickable when they appear in the description text, so they're just
    // appended there.
    const hashtagText = String(hashtags || '')
      .split(/[\s,]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
      .join(' ');
    const combinedDescription = [description?.trim(), hashtagText].filter(Boolean).join('\n\n');

    const tagList = Array.isArray(tags)
      ? tags
      : String(tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);

    await youtube.videos.update({
      part: ['snippet', 'status'],
      requestBody: {
        id: videoId,
        snippet: {
          ...existing.snippet,
          title: title?.trim() || existing.snippet.title,
          description: combinedDescription,
          tags: tagList,
        },
        status: {
          ...existing.status,
          privacyStatus: privacyStatus || existing.status.privacyStatus,
        },
      },
    });

    res.json({ ok: true, videoUrl: `https://youtube.com/watch?v=${videoId}` });
  } catch (err) {
    console.error('YouTube metadata update failed:', err);
    res.status(500).json({ error: err.errors?.[0]?.message || err.message || 'Update failed.' });
  }
});

export default router;
