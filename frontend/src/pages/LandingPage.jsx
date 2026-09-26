import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './LandingPage.css';

// Landing page laid out like Blackmagic Design's DaVinci Resolve product page:
// a thin global bar, a sticky product sub-nav, a big centered hero, an
// "all in one" strip that switches between the app's workspaces, then one
// long section per workspace (headline, full-width screenshot, copy, a row of
// sub-feature tiles). Every screenshot is a real capture of the running app.

const IMG = '/marketing/resolve';

// Same stroke icons as the app's own left sidebar (LeftSidebar.jsx).
const ICON_PATHS = {
  media: 'M4 5h16v14H4z M4 15l4-4 4 4 3-3 5 5',
  edit: 'M3 7h18 M3 12h18 M3 17h18 M8 4v6 M15 9v6 M11 14v6',
  montage: 'M9 18V6l10-2v12 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  captions: 'M3 5h18v14H3z M7 13h4 M13 13h4 M7 16h10',
  shorts: 'M8 3h8v18H8z M11 18h2',
  mix: 'M4 12h3l2-6 3 12 3-9 2 3h3',
};

function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

const WORKSPACES = [
  { id: 'media', label: 'Media', icon: 'media', image: `${IMG}/app-media.jpg`, caption: 'Import video, audio and images from your device - everything lands in one media bin.' },
  { id: 'editor', label: 'Editor', icon: 'edit', image: `${IMG}/app-editor.jpg`, caption: 'Cut, trim, stack and grade on a multi-track timeline with a live preview.' },
  { id: 'montage', label: 'Montage', icon: 'montage', image: `${IMG}/app-montage.jpg`, caption: 'Drop in clips and a song - NexEditor cuts them to the music for you.' },
  { id: 'captions', label: 'Captions', icon: 'captions', image: `${IMG}/app-captions.jpg`, caption: 'Turn speech or lyrics into captions and burn them straight into the video.' },
  { id: 'shorts', label: 'Shorts', icon: 'shorts', image: `${IMG}/app-shorts.jpg`, caption: 'Find the strongest moments of a long video and reframe them for every platform.' },
  { id: 'longmix', label: 'Long Mix', icon: 'mix', image: `${IMG}/app-longmix.jpg`, caption: 'Turn a folder of songs into one long mix video with chapters.' },
];

const SECTIONS = [
  {
    id: 'editor',
    eyebrow: 'Editor',
    title: ['A real multi-track editor,', 'right in your browser'],
    image: `${IMG}/app-editor.jpg`,
    body: "The editor gives you video, audio and text tracks on one timeline, with a live preview that shows exactly what will export. Drag clips in, split, trim, group and ripple-delete, add adjustment layers and markers, and fine-tune every clip in the inspector - scale, position, rotation and opacity with keyframes, plus brightness, contrast, saturation, temperature and vignette. Projects save to your account, so you can close the tab and pick up where you left off.",
    tiles: [
      { image: `${IMG}/t-editor-timeline.jpg`, label: ['Multi-track', 'timeline'] },
      { image: `${IMG}/t-editor-keyframes.jpg`, label: ['Keyframe', 'animation'] },
      { image: `${IMG}/t-editor-color.jpg`, label: ['Color grading', 'and presets'] },
      { image: `${IMG}/t-editor-media.jpg`, label: ['One media bin', 'for every file'] },
    ],
  },
  {
    id: 'montage',
    eyebrow: 'Montage',
    title: ['Beat-synced montages,', 'made for you'],
    image: `${IMG}/app-montage.jpg`,
    body: "Add your video sources and a song, then press Merge Montage. NexEditor samples footage across every source, skips intros you don't want, and times each cut to the music. Choose Beat, Scene or Auto sync, set how aggressive the tempo should feel, and pick a look - Cinematic, Vivid or Soft Glow. What used to take an evening of scrubbing takes a few minutes.",
    tiles: [
      { image: `${IMG}/t-montage-sources.jpg`, label: ['Multiple', 'video sources'] },
      { image: `${IMG}/t-montage-sync.jpg`, label: ['Beat, scene', 'and auto sync'] },
      { image: `${IMG}/t-montage-style.jpg`, label: ['Cinematic', 'beauty styles'] },
      { image: `${IMG}/t-montage-audio.jpg`, label: ['Your own', 'music track'] },
    ],
  },
  {
    id: 'captions',
    eyebrow: 'Captions',
    title: ['Captions that', 'write themselves'],
    image: `${IMG}/app-captions.jpg`,
    body: "Upload a video and NexEditor recognises the speech, cleans up filler words like “um” and “uh”, and renders the captions directly into your video. Switch to Auto lyrics for music, or Local captions to work entirely on your own device. Choose the spoken language and where the captions sit on screen, then download a finished, captioned file.",
    tiles: [
      { image: `${IMG}/t-captions-modes.jpg`, label: ['Captions, lyrics', 'or local mode'] },
      { image: `${IMG}/t-captions-preview.jpg`, label: ['Preview before', 'you download'] },
      { image: `${IMG}/t-captions-language.jpg`, label: ['Filler-word', 'cleanup'] },
      { image: `${IMG}/t-captions-generate.jpg`, label: ['Position and', 'one-click render'] },
    ],
  },
  {
    id: 'shorts',
    eyebrow: 'Shorts',
    title: ['One long video,', 'every short format'],
    image: `${IMG}/app-shorts.jpg`,
    body: "Drop in a long video, choose the part worth analysing, and NexEditor picks distinct, strong moments across it and reframes them automatically. Go vertical 9:16 for TikTok, Reels and YouTube Shorts, or landscape 16:9 for YouTube, X and LinkedIn, with clips under a minute, 60 to 90 seconds, or up to three minutes for story-style posts.",
    tiles: [
      { image: `${IMG}/t-shorts-destination.jpg`, label: ['Vertical or', 'landscape'] },
      { image: `${IMG}/t-shorts-range.jpg`, label: ['Choose the', 'analyse range'] },
      { image: `${IMG}/t-shorts-length.jpg`, label: ['Balanced', 'clip selection'] },
      { image: `${IMG}/t-shorts-steps.jpg`, label: ['Three steps', 'to publish'] },
    ],
  },
  {
    id: 'longmix',
    eyebrow: 'Long Mix',
    title: ['Hours of music,', 'one finished video'],
    image: `${IMG}/app-longmix.jpg`,
    body: "LongMix Studio turns a whole folder of songs and a few background scenes into one long mix video - the kind that runs for an hour or more on YouTube. Put the tracks in order, rename them, and each title becomes a YouTube chapter. Songs crossfade into each other, scenes change with the music, and a fast parallel renderer builds the final video. Open it in the editor if you want to fine-tune anything.",
    tiles: [
      { image: `${IMG}/t-longmix-songs.jpg`, label: ['Your whole', 'songs folder'] },
      { image: `${IMG}/t-longmix-header.jpg`, label: ['Automatic', 'YouTube chapters'] },
      { image: `${IMG}/t-longmix-steps.jpg`, label: ['Songs, scenes,', 'settings, create'] },
      { image: `${IMG}/t-longmix-flow.jpg`, label: ['Four steps,', 'then export'] },
    ],
  },
];

const SUBNAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'all-in-one', label: 'All in One' },
  ...SECTIONS.map(({ id, eyebrow }) => ({ id, label: eyebrow })),
];

function useActiveSection(ids) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

const SUBNAV_IDS = SUBNAV.map((s) => s.id);

export default function LandingPage() {
  const active = useActiveSection(SUBNAV_IDS);
  const [workspace, setWorkspace] = useState(WORKSPACES[1].id);
  const current = WORKSPACES.find((w) => w.id === workspace);

  return (
    <div className="dv-page">
      <header className="dv-globalbar">
        <Link to="/" className="dv-logo" aria-label="NexEditor home">
          Nex<span>Editor</span>
        </Link>
        <nav className="dv-globalbar-links" aria-label="Site">
          <a href="#all-in-one">Features</a>
          <Link to="/pricing">Pricing</Link>
          <Link to="/login">Log in</Link>
        </nav>
      </header>

      <nav className="dv-subnav" aria-label="Product">
        <div className="dv-subnav-inner">
          <span className="dv-subnav-product">NexEditor</span>
          <div className="dv-subnav-links">
            {SUBNAV.map((item) => (
              <a key={item.id} href={`#${item.id}`} className={active === item.id ? 'is-active' : ''}>
                {item.label}
              </a>
            ))}
            <Link to="/pricing">Pricing</Link>
          </div>
          <Link to="/signup" className="dv-subnav-cta">Start free</Link>
        </div>
      </nav>

      <main>
        <section className="dv-hero" id="overview">
          <div className="dv-hero-copy">
            <h1>NexEditor</h1>
            <p className="dv-hero-tagline">Professional editing, montage, captions{' '}<br />and shorts - right in your browser!</p>
            <div className="dv-hero-ctas">
              <div className="dv-cta">
                <span className="dv-cta-label">NexEditor</span>
                <Link to="/signup" className="dv-btn dv-btn-light">Start Editing Free</Link>
              </div>
              <div className="dv-cta">
                <span className="dv-cta-label">NexEditor Pro</span>
                <Link to="/pricing" className="dv-btn dv-btn-outline">Upgrade to Pro</Link>
              </div>
            </div>
          </div>
          <div className="dv-hero-media">
            <video
              src="/marketing/hero-demo.mp4"
              poster="/marketing/hero-demo-poster.jpg"
              autoPlay
              muted
              loop
              playsInline
              aria-label="NexEditor product demo"
            />
          </div>
        </section>

        <section className="dv-intro">
          <p className="dv-lead">
            NexEditor combines a multi-track video editor, automatic beat-synced montages,
            AI captions, long-video-to-shorts and long music mixes in one tool that runs in
            your browser. There is nothing to install and no powerful computer required -
            heavy rendering happens on our servers while you keep working. Its clean, modern
            interface is quick to learn for new creators, yet deep enough for people who
            publish every single day.
          </p>
          <div className="dv-intro-split">
            <div>
              <h2>Built for creators<br />who publish daily</h2>
              <p>
                Most creators juggle an editor, a caption tool, a clipping service and a
                music-video app. NexEditor puts all of it behind one login, with one media
                library and projects that are saved to your account - so you spend your time
                creating, not moving files between apps.
              </p>
            </div>
            <div>
              <h2>Start free,<br />upgrade when you grow</h2>
              <p>
                Every tool is available on the free plan so you can try the whole workflow.
                When you need longer exports, more projects and unlimited renders, NexEditor
                Pro unlocks them, with payment by card or Mobile Money.
              </p>
            </div>
          </div>
        </section>

        <section className="dv-allinone" id="all-in-one">
          <div className="dv-section-head">
            <h2>All in One Solution<br />for Video Creators</h2>
            <p>
              NexEditor is divided into workspaces, each giving you dedicated tools for one job.
              Edit on the timeline, build montages, caption, cut shorts and assemble long mixes -
              switching between them takes a single click.
            </p>
          </div>
          <div className="dv-tabs" role="tablist" aria-label="Workspaces">
            {WORKSPACES.map((w) => (
              <button
                key={w.id}
                type="button"
                role="tab"
                aria-selected={workspace === w.id}
                className={`dv-tab ${workspace === w.id ? 'is-active' : ''}`}
                onClick={() => setWorkspace(w.id)}
              >
                <Icon name={w.icon} />
                <span>{w.label}</span>
              </button>
            ))}
          </div>
          <figure className="dv-allinone-shot" role="tabpanel">
            <img key={current.id} src={current.image} alt={`The ${current.label} workspace in NexEditor`} />
            <figcaption>{current.caption}</figcaption>
          </figure>
        </section>

        {SECTIONS.map((section) => (
          <section className="dv-feature" id={section.id} key={section.id}>
            <div className="dv-section-head">
              <span className="dv-eyebrow">{section.eyebrow}</span>
              <h2>{section.title[0]}<br />{section.title[1]}</h2>
            </div>
            <div className="dv-feature-shot">
              <img src={section.image} alt={`${section.eyebrow} in NexEditor`} loading="lazy" />
            </div>
            <div className="dv-feature-body">
              <p>{section.body}</p>
              <Link to="/signup" className="dv-learn">Try it free</Link>
            </div>
            <ul className="dv-tiles">
              {section.tiles.map((tile) => (
                <li className="dv-tile" key={tile.label.join(' ')}>
                  <img src={tile.image} alt="" loading="lazy" />
                  <span>{tile.label[0]}<br />{tile.label[1]}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="dv-final">
          <h2>Start editing<br />in seconds</h2>
          <p>Create a free account and open your first project - no download, no credit card.</p>
          <div className="dv-hero-ctas">
            <div className="dv-cta">
              <span className="dv-cta-label">NexEditor</span>
              <Link to="/signup" className="dv-btn dv-btn-light">Start Editing Free</Link>
            </div>
            <div className="dv-cta">
              <span className="dv-cta-label">Compare plans</span>
              <Link to="/pricing" className="dv-btn dv-btn-outline">See Pricing</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="dv-footer">
        <div className="dv-footer-cols">
          <div>
            <h3>Workspaces</h3>
            {SECTIONS.map((s) => <a key={s.id} href={`#${s.id}`}>{s.eyebrow}</a>)}
          </div>
          <div>
            <h3>Account</h3>
            <Link to="/signup">Sign up</Link>
            <Link to="/login">Log in</Link>
            <Link to="/pricing">Pricing</Link>
          </div>
          <div className="dv-footer-brand">
            <span className="dv-logo">Nex<span>Editor</span></span>
            <p>Edit, montage, caption and repurpose - in your browser.</p>
          </div>
        </div>
        <p className="dv-copyright">&copy; {new Date().getFullYear()} NexEditor. All rights reserved.</p>
      </footer>
    </div>
  );
}
