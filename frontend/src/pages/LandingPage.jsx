import { Link } from 'react-router-dom';
import './pages.css';

const FEATURES = [
  {
    title: 'Editor',
    description: 'A full multi-track timeline with keyframes, color grading, transitions, speed curves and adjustment layers.',
  },
  {
    title: 'Montage',
    description: 'Drop in your clips and music - NexEditor auto-syncs cuts to the beat and renders a polished montage.',
  },
  {
    title: 'Captions',
    description: 'Auto-generate accurate captions and burn them straight into your video.',
  },
  {
    title: 'Shorts',
    description: 'Reformat any video into vertical shorts, ready for TikTok, Reels and YouTube Shorts.',
  },
];

export default function LandingPage() {
  return (
    <div className="marketing-page">
      <nav className="marketing-nav">
        <div className="brand-mark">
          <span className="brand-mark-primary">Next</span>
          <span style={{ color: 'var(--accent)' }}>Editor</span>
        </div>
        <div className="marketing-nav-links">
          <a href="#features">Features</a>
          <Link to="/pricing">Pricing</Link>
          <Link to="/login">Log in</Link>
          <Link to="/signup" className="btn btn-primary">Start editing free</Link>
        </div>
      </nav>

      <section className="hero">
        <h1>Edit videos like a <span>pro</span>, right in your browser</h1>
        <p>
          NexEditor is a full CapCut-style video editor - multi-track timeline, montage
          auto-sync, captions and shorts reformatting - with your projects saved to your
          account so you never lose your work.
        </p>
        <div className="hero-actions">
          <Link to="/signup" className="btn btn-primary">Start editing free</Link>
          <Link to="/login" className="btn btn-ghost">Log in</Link>
        </div>
      </section>

      <section className="section" id="features">
        <div className="section-heading">
          <h2>Everything you need to ship a video</h2>
          <p>Four focused tools, one project that stays in sync.</p>
        </div>
        <div className="feature-grid">
          {FEATURES.map((feature) => (
            <div className="feature-card" key={feature.title}>
              <div className="feature-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>Simple pricing</h2>
          <p>Start free. Upgrade when you need more.</p>
        </div>
        <div className="hero-actions">
          <Link to="/pricing" className="btn btn-primary">See pricing</Link>
        </div>
      </section>

      <footer className="marketing-footer">
        &copy; {new Date().getFullYear()} NexEditor. All rights reserved.
      </footer>
    </div>
  );
}
