import { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const [socketId, setSocketId] = useState('');
  
  // Create socket outside of state to avoid setState in effect
  const socket = useMemo(() => {
    const newSocket = io(
      import.meta.env.VITE_SOCKET_URL || 
      import.meta.env.VITE_API_URL || 
      'http://localhost:3000'
    );

    newSocket.on('connect', () => {
      setSocketId(newSocket.id);
    });

    newSocket.on('disconnect', () => {
      setSocketId('');
    });

    return newSocket;
  }, []);

  useEffect(() => {
    return () => {
      socket.disconnect();
    };
  }, [socket]);

  return (
    <SocketContext.Provider value={{ socket, socketId }}>
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
