import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import '../pages/pages.css';

export default function RequireAuth({ children }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return <div className="auth-loading">Loading...</div>;
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace />;
  }

  return children;
}
