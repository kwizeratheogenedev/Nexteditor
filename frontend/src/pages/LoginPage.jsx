import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import './pages.css';

const GOOGLE_ERROR_MESSAGES = {
  google_not_configured: 'Google sign-in is not available right now.',
  google_failed: 'Google sign-in failed. Please try again.',
  no_email: 'Your Google account has no email address to sign in with.',
  access_denied: 'Google sign-in was cancelled.',
  account_suspended: 'This account has been suspended. Contact support if you think this is a mistake.',
};

export default function LoginPage() {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(GOOGLE_ERROR_MESSAGES[searchParams.get('error')] || '');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/app');
    } catch (err) {
      setError(err.message || 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(err.message || 'Google sign-in failed.');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Welcome back</h1>
        <p>Log in to keep working on your projects.</p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label htmlFor="login-email">Email</label>
            <input id="login-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="auth-field">
            <label htmlFor="login-password">Password</label>
            <input id="login-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Logging in...' : 'Log in'}
          </button>
        </form>

        <div className="auth-divider">or</div>

        <button type="button" className="btn btn-ghost btn-block" onClick={handleGoogle}>
          Continue with Google
        </button>

        <div className="auth-footer-link">
          Don't have an account? <Link to="/signup">Sign up</Link>
        </div>
      </div>
    </div>
  );
}
