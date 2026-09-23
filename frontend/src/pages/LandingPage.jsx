import { Link } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle.jsx';
import HeroShowcase from '../components/HeroShowcase.jsx';
import './pages.css';

const FEATURES = [
  {
    id: 'editor',
    eyebrow: 'EDIT · TIMELINE',
    title: 'A full multi-track editor',
    description:
      "Video, audio and text lanes on one timeline, with keyframe animation, color grading, transitions, speed ramps and adjustment layers. Drag clips in, trim, split and stack overlays, and every change composites live in the canvas - exactly what you see is what exports.",
    image: '/marketing/feature-editor.png',
  },
  {
    id: 'montage',
    eyebrow: 'MONTAGE · AUTO-SYNC',
    title: 'Beat-synced montages, automatically',
    description:
      "Drop in your clips and a track of music. NexEditor samples footage across your sources, times the cuts to the beat, and renders a polished highlight reel - no manual scrubbing or clip-matching required.",
    image: '/marketing/feature-montage.png',
  },
  {
    id: 'captions',
    eyebrow: 'TEXT · CAPTIONS',
    title: 'Captions that write themselves',
    description:
      "Auto-generate accurate captions straight from your video's audio and burn them in, with filler-word cleanup, language selection and position control - all in one pass, ready to download.",
    image: '/marketing/feature-captions.png',
  },
  {
    id: 'shorts',
    eyebrow: 'AI TOOLS · REPURPOSE',
    title: 'One video, every format',
    description:
      "NexEditor finds the strongest moments across a long video and reframes them automatically for TikTok, Reels, Shorts, YouTube and LinkedIn - vertical or landscape, your call.",
    image: '/marketing/feature-shorts.png',
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
          <ThemeToggle />
        </div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <span className="hero-eyebrow">
            <span className="hero-eyebrow-dot" />
            Timeline · Montage · Captions · Shorts — one editor
          </span>
          <h1>Edit videos like a <span>pro</span>, right in your browser</h1>
          <p>
            NexEditor is a full CapCut-style video editor - multi-track timeline, montage
            auto-sync, captions and shorts reformatting - with your projects saved to your
            account so you never lose your work.
          </p>
          <div className="hero-actions">
            <Link to="/signup" className="btn btn-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4" /><path d="M5 19h14" /></svg>
              Start editing free
            </Link>
            <a href="#features" className="btn btn-ghost">See all features</a>
          </div>
        </div>

        <div className="hero-showcase">
          <div className="hero-glow" aria-hidden="true" />
          <HeroShowcase videoSrc="/marketing/hero-demo.mp4" poster="/marketing/hero-demo-poster.jpg" />
        </div>
      </section>

      <section className="section" id="features">
        <div className="section-heading">
          <h2>Everything you need to ship a video</h2>
          <p>Four focused tools, one project that stays in sync.</p>
        </div>
        <div className="feature-grid">
          {FEATURES.map((feature) => (
            <div className="feature-card" key={feature.id}>
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

      {FEATURES.map((feature, index) => (
        <section className={`feature-showcase ${index % 2 === 1 ? 'is-reversed' : ''}`} key={feature.id} id={feature.id}>
          <div className="feature-showcase-media">
            <img src={feature.image} alt={`${feature.title} in NexEditor`} loading="lazy" />
          </div>
          <div className="feature-showcase-copy">
            <span className="feature-showcase-eyebrow">{feature.eyebrow}</span>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </div>
        </section>
      ))}

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
