import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { API_ENDPOINTS } from '../config.js';
import ThemeToggle from '../components/ThemeToggle.jsx';
import './pages.css';

const FREE_FEATURES = [
  'Up to 3 saved projects',
  'Exports up to 720p with watermark',
  'Max 3 minute export length',
  '5 exports per month',
  '2GB cloud storage',
];

const PRO_FEATURES = [
  'Unlimited saved projects',
  'Full-resolution exports, no watermark',
  'No export length limit',
  'Unlimited exports',
  'Expanded cloud storage',
  'YouTube upload',
  'AI tools',
  'Adjustment layers',
];

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

function MomoUpgradeCard({ onSuccess }) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [state, setState] = useState('idle'); // idle | requesting | pending | success | error
  const [message, setMessage] = useState('');
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const handlePay = async () => {
    if (!phoneNumber.trim()) return;
    setState('requesting');
    setMessage('');
    try {
      const res = await fetch(API_ENDPOINTS.momoRequestToPay, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phoneNumber.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start MoMo payment.');

      setState('pending');
      setMessage('Check your phone and approve the payment prompt...');
      const startedAt = Date.now();
      pollRef.current = setInterval(async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          clearInterval(pollRef.current);
          setState('error');
          setMessage('Payment timed out. Please try again.');
          return;
        }
        try {
          const statusRes = await fetch(API_ENDPOINTS.momoStatus(data.referenceId), { credentials: 'include' });
          const statusData = await statusRes.json();
          if (statusData.status === 'SUCCESSFUL') {
            clearInterval(pollRef.current);
            setState('success');
            setMessage('Payment successful - you\'re now Pro!');
            onSuccess();
          } else if (statusData.status === 'FAILED') {
            clearInterval(pollRef.current);
            setState('error');
            setMessage('Payment failed or was declined. Please try again.');
          }
        } catch (_err) {
          // transient poll failure - keep trying until timeout
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      setState('error');
      setMessage(err.message || 'Failed to start MoMo payment.');
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div className="auth-field" style={{ marginBottom: 8 }}>
        <label htmlFor="momo-phone">MTN Mobile Money number</label>
        <input
          id="momo-phone"
          type="tel"
          placeholder="e.g. 2507xxxxxxxx"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          disabled={state === 'requesting' || state === 'pending'}
        />
      </div>
      <button
        type="button"
        className="btn btn-primary btn-block"
        onClick={handlePay}
        disabled={!phoneNumber.trim() || state === 'requesting' || state === 'pending' || state === 'success'}
      >
        {state === 'requesting' ? 'Starting...' : state === 'pending' ? 'Waiting for approval...' : 'Pay with MTN MoMo'}
      </button>
      {message && (
        <div style={{ fontSize: 13, marginTop: 8, color: state === 'error' ? 'var(--danger)' : 'var(--text-secondary)' }}>
          {message}
        </div>
      )}
    </div>
  );
}

function CardUpgradeButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleClick = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(API_ENDPOINTS.cardsCheckoutSession, { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start card payment.');
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err.message || 'Failed to start card payment.');
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" className="btn btn-ghost btn-block" onClick={handleClick} disabled={busy}>
        {busy ? 'Starting...' : 'Pay with card'}
      </button>
      {error && <div style={{ fontSize: 13, marginTop: 8, color: 'var(--danger)' }}>{error}</div>}
    </div>
  );
}

export default function PricingPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cardVerifyMessage, setCardVerifyMessage] = useState('');

  const handleUpgraded = async () => {
    await refresh();
    setTimeout(() => navigate('/app'), 1500);
  };

  // Flutterwave redirects back here with these query params after checkout -
  // always re-verify server-side rather than trusting them directly.
  useEffect(() => {
    const transactionId = searchParams.get('transaction_id');
    const txRef = searchParams.get('tx_ref');
    if (!transactionId || !txRef) return;
    setSearchParams({}, { replace: true });
    setCardVerifyMessage('Confirming your payment...');
    fetch(API_ENDPOINTS.cardsVerify(transactionId, txRef), { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data.status === 'success') {
          setCardVerifyMessage('Payment successful - you\'re now Pro!');
          handleUpgraded();
        } else {
          setCardVerifyMessage('Payment could not be confirmed. If you were charged, contact support.');
        }
      })
      .catch(() => setCardVerifyMessage('Could not confirm payment status.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="marketing-page">
      <nav className="marketing-nav">
        <Link to="/" className="brand-mark" style={{ textDecoration: 'none' }}>
          <span className="brand-mark-primary">Next</span>
          <span style={{ color: 'var(--accent)' }}>Editor</span>
        </Link>
        <div className="marketing-nav-links">
          {user ? (
            <Link to="/app" className="btn btn-primary">Back to editor</Link>
          ) : (
            <>
              <Link to="/login">Log in</Link>
              <Link to="/signup" className="btn btn-primary">Start editing free</Link>
            </>
          )}
          <ThemeToggle />
        </div>
      </nav>

      <section className="section">
        <div className="section-heading">
          <h2>Simple pricing</h2>
          <p>Start free. Upgrade whenever you need more.</p>
        </div>
        <div className="pricing-grid">
          <div className="pricing-card">
            <h3>Free</h3>
            <div className="pricing-price">$0<small> forever</small></div>
            <ul>
              {FREE_FEATURES.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
            <Link to={user ? '/app' : '/signup'} className="btn btn-ghost btn-block">
              {user ? 'Current plan' : 'Get started'}
            </Link>
          </div>
          <div className="pricing-card featured">
            <h3>Pro</h3>
            <div className="pricing-price">$9<small> / month</small></div>
            <ul>
              {PRO_FEATURES.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
            {cardVerifyMessage && (
              <div style={{ fontSize: 13, marginBottom: 8, color: 'var(--text-secondary)' }}>{cardVerifyMessage}</div>
            )}
            {user?.subscription?.plan === 'pro' ? (
              <button type="button" className="btn btn-ghost btn-block" disabled>Current plan</button>
            ) : user ? (
              <>
                <MomoUpgradeCard onSuccess={handleUpgraded} />
                <CardUpgradeButton />
              </>
            ) : (
              <Link to="/signup" className="btn btn-primary btn-block">Sign up to upgrade</Link>
            )}
          </div>
        </div>
      </section>

      <footer className="marketing-footer">
        &copy; {new Date().getFullYear()} NexEditor. All rights reserved.
      </footer>
    </div>
  );
}
