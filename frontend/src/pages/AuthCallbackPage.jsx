import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import './pages.css';

export default function AuthCallbackPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    refresh().then(() => {
      if (!cancelled) navigate('/app', { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [refresh, navigate]);

  return <div className="auth-loading">Signing you in...</div>;
}
