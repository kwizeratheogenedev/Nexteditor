import { Server } from 'socket.io';

let _io;

export function initSocket(httpServer, allowedOrigin) {
  _io = new Server(httpServer, {
    cors: { origin: allowedOrigin, methods: ['GET', 'POST'] },
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
