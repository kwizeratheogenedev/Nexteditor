import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { API_ENDPOINTS } from '../config.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'authenticated' | 'anonymous'
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(API_ENDPOINTS.authMe, { credentials: 'include' });
      const data = await res.json();
      setUser(data.user || null);
      setStatus(data.user ? 'authenticated' : 'anonymous');
    } catch (_err) {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (email, password) => {
    setError('');
    const res = await fetch(API_ENDPOINTS.authLogin, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Login failed.');
      throw new Error(data.error || 'Login failed.');
    }
    setUser(data.user);
    setStatus('authenticated');
    return data.user;
  }, []);

  const signup = useCallback(async (email, password, name) => {
    setError('');
    const res = await fetch(API_ENDPOINTS.authSignup, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Signup failed.');
      throw new Error(data.error || 'Signup failed.');
    }
    setUser(data.user);
    setStatus('authenticated');
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await fetch(API_ENDPOINTS.authLogout, { method: 'POST', credentials: 'include' });
    setUser(null);
    setStatus('anonymous');
  }, []);

  const loginWithGoogle = useCallback(async () => {
    const res = await fetch(API_ENDPOINTS.authGoogleUrl, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Google sign-in is not available.');
      throw new Error(data.error || 'Google sign-in is not available.');
    }
    window.location.href = data.url;
  }, []);

  return (
    <AuthContext.Provider value={{ user, status, error, login, signup, logout, loginWithGoogle, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
