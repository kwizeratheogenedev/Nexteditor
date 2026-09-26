import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext(null);

function getSocketUrlCandidates() {
  const configuredUrls = [import.meta.env.VITE_SOCKET_URL, import.meta.env.VITE_API_URL]
    .filter(Boolean)
    .map((value) => value.trim().replace(/\/+$/, ''));

  if (typeof window === 'undefined') {
    return configuredUrls;
  }

  const protocol = window.location.protocol;
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const fallbackUrls = [
    // Reached from another device, "host:3000" isn't necessarily routable -
    // only this page's own origin is. Vite's dev proxy forwards /socket.io on
    // that same origin to the real backend, so try it first when not on
    // localhost.
    ...(isLocal ? [] : [window.location.origin]),
    `${protocol}//${host}:3000`,
    `${protocol}//localhost:3000`,
    `${protocol}//127.0.0.1:3000`,
    `${protocol}//${host}:3001`,
    `${protocol}//localhost:3001`,
    `${protocol}//127.0.0.1:3001`,
  ];

  return Array.from(new Set([...configuredUrls, ...fallbackUrls]));
}

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null);
  const [socketId, setSocketId] = useState('');
  const [socketError, setSocketError] = useState('');

  useEffect(() => {
    const urls = getSocketUrlCandidates();
    let cancelled = false;
    let attemptIndex = 0;
    let currentSocket = null;

    const connectNextUrl = () => {
      if (cancelled) {
        return;
      }

      const url = urls[attemptIndex];
      if (!url) {
        setSocketError('Could not connect to montage progress service');
        return;
      }

      const socketInstance = io(url, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 600,
        timeout: 4000,
      });

      currentSocket = socketInstance;
      setSocket(socketInstance);

      const handleConnect = () => {
        setSocketId(socketInstance.id || '');
        setSocketError('');
      };

      const handleDisconnect = () => {
        setSocketId('');
      };

      const handleConnectError = (error) => {
        if (cancelled) {
          return;
        }

        if (attemptIndex < urls.length - 1) {
          attemptIndex += 1;
          socketInstance.disconnect();
          connectNextUrl();
          return;
        }

        setSocketError(error?.message || 'Could not connect to montage progress service');
        setSocketId('');
      };

      socketInstance.on('connect', handleConnect);
      socketInstance.on('disconnect', handleDisconnect);
      socketInstance.on('connect_error', handleConnectError);
      socketInstance.on('connect_failed', handleConnectError);

      if (socketInstance.connected) {
        handleConnect();
      }
    };

    connectNextUrl();

    return () => {
      cancelled = true;
      if (currentSocket) {
        currentSocket.disconnect();
      }
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, socketId, socketError }}>
      {children}
    </SocketContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within SocketProvider');
  }
  return context;
}
