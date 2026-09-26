import { Server } from 'socket.io';

let _io;

function normalizeAllowedOrigins(allowedOrigin) {
  const fallbackOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
  ];

  const rawValue = (allowedOrigin || '').trim();
  if (!rawValue) {
    return fallbackOrigins;
  }

  return rawValue
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function parseAllowedOrigins(allowedOrigin) {
  return normalizeAllowedOrigins(allowedOrigin);
}

export function isOriginAllowed(origin, allowedOrigins = []) {
  if (!origin) {
    return true;
  }

  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    return true;
  }

  try {
    const parsedOrigin = new URL(origin);
    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(parsedOrigin.hostname);
    if (isLocalhost && ['http:', 'https:'].includes(parsedOrigin.protocol)) {
      return true;
    }
  } catch (_error) {
    return false;
  }

  return allowedOrigins.some((allowedOrigin) => allowedOrigin === origin);
}

export function initSocket(httpServer, allowedOrigin) {
  const allowedOrigins = parseAllowedOrigins(allowedOrigin);

  _io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || isOriginAllowed(origin, allowedOrigins)) {
          callback(null, true);
          return;
        }

        console.warn('Rejected socket origin:', origin);
        callback(new Error(`Origin not allowed: ${origin}`));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    allowEIO3: true,
  });

  _io.on('connection', (socket) => {
    console.log('A user connected via WebSocket:', socket.id);
    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });

  return _io;
}

export function getIo() {
  return _io;
}
