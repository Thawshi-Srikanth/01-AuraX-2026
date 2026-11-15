import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, Play, Search } from 'lucide-react';
import { NavigationTab } from '../tokens/colors';
import { ResolvedTarget, resolveTarget } from '../services/api';
import { HOME_VIDEO } from '../content/homeMedia';
import { CHALLENGE_TARGETS, challengeTarget } from '../data/challengeTargets';
import { CHECKED_COMPARISON_URL } from '../data/checkedComparison';
import './landing.css';

interface LandingViewProps {
  onNavigate: (tab: NavigationTab) => void;
  onTargetResolved: (target: ResolvedTarget) => void;
  activeTarget: ResolvedTarget;
}

const EXAMPLES = CHALLENGE_TARGETS;
const HOME_FAQ = [
  { question: 'Do I need to know astronomy to start?', answer: 'No. Choose one of the five sample targets to fill its coordinates, then select Load image sequence. Start by browsing the dates and reading the details for one image.' },
  { question: 'Which coordinate format should I enter?', answer: 'Use decimal degrees in the ICRS frame. RA must be at least 0 and less than 360; Dec must be between −90 and +90. The samples already use the right format.' },
  { question: 'What do the detector colors mean?', answer: 'The six colors identify SPHEREx detectors and their wavelength ranges. They help you follow which detector made an observation; they are not the natural colors of the objects. The image display has its own colormap.' },
  { question: 'Why are some dates or images missing?', answer: 'Available observations depend on sky coverage, the archive release, your filters, and usable data. This app does not guarantee a complete observation history. Try a broader date range or another detector; an empty result does not mean the object is absent.' },
  { question: 'Why can’t I press Play for every image pair?', answer: 'Images supports manual timeline browsing. In Compare images, choose observations and press Analyse images. Blinking requires usable sky overlap and locally matching wavelengths; unsuitable pixels are hidden. Some pairs remain available only side by side.' },
  { question: 'Does a moving point mean I found a new object?', answer: 'A mark records a suspected change, not a confirmed discovery or motion measurement. Noise, brightness changes, and image artifacts can mislead. Review both dates and independent catalogs before drawing a conclusion.' },
  { question: 'Is everything shown a measured observation?', answer: 'The sky-image tools request public SPHEREx observations and report failures instead of substituting sample images. The landing cover is a published SPHEREx infrared image; the video poster is a labelled schematic. Saved targets can load real nearest-pixel spectral samples with uncertainties. These include background light and are not a complete source spectrum.' },
];

const DECIMAL_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

function sexagesimal(value: number, isRa: boolean) {
  const total = isRa
    ? Math.round(value / 15 * 360000) % 8640000
    : Math.round(Math.abs(value) * 360000);
  const major = Math.floor(total / 360000);
  const minutes = Math.floor(total % 360000 / 6000);
  const seconds = (total % 6000 / 100).toFixed(2).padStart(5, '0');
  const majorText = String(major).padStart(2, '0');
  const minuteText = String(minutes).padStart(2, '0');
  return isRa ? majorText + 'h ' + minuteText + 'm ' + seconds + 's'
    : (value < 0 ? '−' : '+') + majorText + '° ' + minuteText + '′ ' + seconds + '″';
}

function startingPosition(ra: number, dec: number, label: string, provenance: string): ResolvedTarget {
  const name = label.trim() || 'RA ' + ra.toFixed(5) + '°, Dec ' + dec.toFixed(5) + '°';
  return {
    query: name,
    canonical_name: name,
    object_type: 'Sky position',
    coordinates: { ra_deg: ra, dec_deg: dec, ra_hms: sexagesimal(ra, true), dec_dms: sexagesimal(dec, false), frame: 'ICRS', epoch: 'Not specified' },
    proper_motion: null,
    aliases: [],
    provenance,
  };
}

export function LandingView({ onNavigate, onTargetResolved, activeTarget }: LandingViewProps) {
  const [ra, setRa] = useState(String(activeTarget.coordinates.ra_deg));
  const [dec, setDec] = useState(String(activeTarget.coordinates.dec_deg));
  const [positionTarget, setPositionTarget] = useState<ResolvedTarget | null>(activeTarget);
  const [positionNotice, setPositionNotice] = useState('');
  const [errors, setErrors] = useState<{ ra?: string; dec?: string }>({});
  const [name, setName] = useState('');
  const [searching, setSearching] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const raRef = useRef<HTMLInputElement>(null);
  const decRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const youtubeId = HOME_VIDEO.youtubeId && /^[A-Za-z0-9_-]{11}$/.test(HOME_VIDEO.youtubeId) ? HOME_VIDEO.youtubeId : null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function fillPosition(target: ResolvedTarget) {
    setRa(String(target.coordinates.ra_deg));
    setDec(String(target.coordinates.dec_deg));
    setPositionTarget(target);
    setPositionNotice('Coordinates filled for ' + (target.query || target.canonical_name) + '.');
    setErrors({});
    setNameError(null);
    raRef.current?.focus();
  }

  function fillExample(example: typeof EXAMPLES[number]) {
    fillPosition(challengeTarget(example));
    setPositionNotice('Fixed sky field centred near ' + example.name + ' at J2025.5 using approximate catalog proper motion. Images retain one sky grid so motion stays visible.');
  }

  async function submitName(event: FormEvent) {
    event.preventDefault();
    if (searching) return;
    const query = name.trim();
    if (!query) {
      setNameError('Enter an object name, or choose an example above.');
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    const example = EXAMPLES.find(item => item.name.toLowerCase() === query.toLowerCase());
    if (example) {
      fillExample(example);
      return;
    }
    setSearching(true);
    try {
      const target = await resolveTarget(query);
      if (mounted.current) fillPosition(target);
    } catch (error) {
      if (mounted.current) {
        setNameError(error instanceof Error && error.message.includes('not found')
          ? 'That name was not found. Check the spelling or enter coordinates above.'
          : 'Name lookup is unavailable right now. Try again, choose an example, or enter coordinates above.');
      }
    } finally {
      if (mounted.current) setSearching(false);
    }
  }

  function submitCoordinates(event: FormEvent, destination: NavigationTab = 'Observations') {
    event.preventDefault();
    if (searching) return;
    const raValue = Number(ra.trim());
    const decValue = Number(dec.trim());
    const nextErrors: typeof errors = {};
    if (!DECIMAL_NUMBER.test(ra.trim()) || !Number.isFinite(raValue) || raValue < 0 || raValue >= 360) {
      nextErrors.ra = 'Enter RA from 0 up to, but not including, 360 degrees.';
    }
    if (!DECIMAL_NUMBER.test(dec.trim()) || !Number.isFinite(decValue) || decValue < -90 || decValue > 90) {
      nextErrors.dec = 'Enter Dec between −90 and +90 degrees.';
    }
    setErrors(nextErrors);
    if (nextErrors.ra || nextErrors.dec) {
      (nextErrors.ra ? raRef : decRef).current?.focus();
      return;
    }
    const unchangedPosition = positionTarget
      && raValue === positionTarget.coordinates.ra_deg
      && decValue === positionTarget.coordinates.dec_deg;
    onTargetResolved(unchangedPosition ? positionTarget : startingPosition(raValue, decValue, '', 'User-entered coordinates'));
    onNavigate(destination);
  }

  return (
    <div className="landing-root">
      <div className="landing-content">
        <section className="landing-intro" aria-labelledby="landing-title">
          <div className="landing-start">
            <p className="landing-eyebrow">Explore the sky with SPHEREx</p>
            <h1 id="landing-title">Watch the sky<br />change over time.</h1>
            <p className="landing-lead">Start with a patch of sky. Explore its infrared images and compare dates to look for a point that moves.</p>

            <form className="landing-sequence-form" onSubmit={event => { void submitCoordinates(event); }} noValidate aria-label="Load a sky image sequence">
              <div className="landing-coordinate-fields">
                <div>
                  <label htmlFor="landing-ra">Right ascension <span>RA · degrees</span></label>
                  <input ref={raRef} id="landing-ra" type="text" inputMode="decimal" value={ra} onChange={event => {
                    setRa(event.target.value);
                    setPositionTarget(null);
                    setPositionNotice('');
                    setErrors(current => ({ ...current, ra: undefined }));
                  }} aria-invalid={!!errors.ra} aria-describedby={errors.ra ? 'landing-ra-error' : 'landing-coordinate-help'} autoComplete="off" spellCheck={false} disabled={searching} />
                  {errors.ra && <p id="landing-ra-error" className="landing-error" role="alert">{errors.ra}</p>}
                </div>
                <div>
                  <label htmlFor="landing-dec">Declination <span>Dec · degrees</span></label>
                  <input ref={decRef} id="landing-dec" type="text" inputMode="decimal" value={dec} onChange={event => {
                    setDec(event.target.value);
                    setPositionTarget(null);
                    setPositionNotice('');
                    setErrors(current => ({ ...current, dec: undefined }));
                  }} aria-invalid={!!errors.dec} aria-describedby={errors.dec ? 'landing-dec-error' : 'landing-coordinate-help'} autoComplete="off" spellCheck={false} disabled={searching} />
                  {errors.dec && <p id="landing-dec-error" className="landing-error" role="alert">{errors.dec}</p>}
                </div>
              </div>
              <p id="landing-coordinate-help" className="landing-field-hint">RA: 0–360° (excluding 360). Dec: −90° to +90°. Frame: ICRS.</p>

              <div className="landing-examples">
                <p>Try a challenge target to fill the coordinates.</p>
                <div className="landing-example-list" aria-label="Example sky positions">
                  {EXAMPLES.map(example => <button type="button" key={example.name} disabled={searching} aria-pressed={positionTarget?.provenance.startsWith('Challenge benchmark:') && positionTarget.canonical_name === example.name} onClick={() => fillExample(example)}>{example.name}</button>)}
                  <button type="button" disabled={searching} onClick={() => { const position = CHALLENGE_TARGETS[2].challengePosition; fillPosition(startingPosition(position.ra, position.dec, 'WISE 0855 · supplied coordinates', 'Challenge-supplied coordinates; epoch unspecified, not propagated.')); }}>WISE 0855 · supplied coordinates</button>
                </div>
              </div>
              <p className="landing-position-notice" role="status">{positionNotice}</p>
              {positionTarget?.benchmark && <p className="landing-field-hint">Fixed field at J2025.5 from an approximate proper-motion estimate. Parallax and perspective effects are not included. <a href={positionTarget.benchmark.source_url} target="_blank" rel="noreferrer">Catalog reference ↗</a> Your own RA/Dec inputs are used unchanged.</p>}
              <button type="submit" className="landing-primary landing-load-sequence" disabled={searching}>Load image sequence <ArrowRight size={16} aria-hidden="true" /></button>
            </form>
            <a className="landing-text-action landing-checked-example" href={CHECKED_COMPARISON_URL}>Try a checked Epsilon Indi B time comparison <ArrowRight size={14} aria-hidden="true" /></a>

          </div>

          <figure className="landing-illustration">
            <img src="/assets/home/spherex-all-sky.jpg" alt="SPHEREx all-sky infrared mosaic showing the Milky Way in a broad band of stars, gas, and dust." width={4160} height={2340} fetchPriority="high" decoding="async" />
            <figcaption><a href="https://www.jpl.nasa.gov/images/pia26600-spherexs-first-all-sky-map/" target="_blank" rel="noreferrer">SPHEREx all-sky map · NASA/JPL-Caltech ↗</a><span>Infrared mosaic · visible colors represent infrared light</span></figcaption>
          </figure>
        </section>

        <section className="landing-position-support landing-section" aria-labelledby="position-support-title">
          <div><p className="landing-eyebrow">A place to begin</p><h2 id="position-support-title">New to sky coordinates?</h2><p className="landing-body">RA and Dec work like an address in the sky. Right ascension runs around it; declination measures north or south of the celestial equator. Choose a sample above, or look up a familiar object to fill its position.</p></div>
          <div className="landing-position-lookup">
              <form className="landing-name-form" onSubmit={submitName} noValidate aria-label="Look up coordinates by name" aria-busy={searching}>
                <label htmlFor="landing-name">Object name</label>
                <div className="landing-search-row">
                  <div className="landing-name-field">
                    <Search size={17} aria-hidden="true" />
                    <input ref={nameRef} id="landing-name" type="text" value={name} onChange={event => { setName(event.target.value); setNameError(null); }} placeholder="For example, M101" maxLength={120} autoComplete="off" spellCheck={false} disabled={searching} aria-invalid={!!nameError} aria-describedby={nameError ? 'landing-name-error' : 'landing-name-help'} />
                  </div>
                  <button type="submit" className="landing-coordinate-submit" disabled={searching}>{searching ? 'Looking up…' : 'Fill coordinates'}</button>
                </div>
                {nameError && <p className="landing-error" id="landing-name-error" role="alert">{nameError}</p>}
                <p id="landing-name-help" className="landing-field-hint">This fills the position above. Then choose Load image sequence.</p>
                <span className="landing-search-status" role="status">{searching ? 'Looking up the sky position.' : ''}</span>
              </form>
            <button type="button" className="landing-sky-map landing-text-action" onClick={event => { void submitCoordinates(event, 'Explore'); }} disabled={searching}>Open sky map <ArrowRight size={15} aria-hidden="true" /></button>
          </div>
        </section>

        <section className="landing-mission landing-section" aria-labelledby="mission-title">
          <div className="landing-section-heading"><div><p className="landing-eyebrow">The mission behind the images</p><h2 id="mission-title">A different way to see the universe.</h2></div><a className="landing-source-link" href="https://science.nasa.gov/mission/spherex/" target="_blank" rel="noreferrer">Meet SPHEREx ↗</a></div>
          <div className="landing-mission-body"><div><p className="landing-body">SPHEREx is NASA’s space telescope for surveying the whole sky in infrared light, beyond what our eyes can see. Its measurements help scientists study galaxies, the early universe, and the ingredients for life in interstellar clouds.</p><p className="landing-body">AURAx brings public observations into a visual workspace. Return to the same patch of sky at different dates, inspect the images, and look closely at what changes.</p><a className="landing-source-link" href="https://www.nasa.gov/missions/spherex/nasas-spherex-space-telescope-begins-capturing-entire-sky/" target="_blank" rel="noreferrer">NASA’s guide to the survey ↗</a></div>
          <dl className="landing-mission-facts"><div><dt>102</dt><dd>infrared wavelength bands reveal different parts of the same sky.</dd></div><div><dt>6 months</dt><dd>is the planned time to survey the whole sky once.</dd></div><div><dt>6 detectors</dt><dd>record different wavelength ranges in each exposure.</dd></div></dl></div>
        </section>

        <section className="landing-history landing-section" aria-labelledby="history-title">
          <div><p className="landing-eyebrow">An old idea. A new view.</p><h2 id="history-title">Discoveries can begin<br />with a second look.</h2><p className="landing-body">In 1930, Clyde Tombaugh found Pluto by comparing photographs taken on different nights. A blink comparator switched between the plates, helping him spot a faint point that had moved against the stars.</p><a className="landing-source-link" href="https://www.aps.org/apsnews/2009/03/tombaugh-discovery-pluto-1930" target="_blank" rel="noreferrer">Read the discovery story ↗</a></div>
          <div className="landing-look-for"><h3>What might change?</h3><dl><div><dt>Position</dt><dd>Asteroids, comets, and nearby stars can shift against more distant objects.</dd></div><div><dt>Brightness</dt><dd>Variable stars can brighten or fade between observations.</dd></div><div><dt>The image itself</dt><dd>Noise, artifacts, and different wavelengths can imitate a change. A visual candidate needs further checks.</dd></div></dl><p className="landing-body">AURAx aligns selected images on one sky grid. Mark a possible change, then inspect the same area across observations and check their wavelengths.</p></div>
        </section>

        <section className="landing-workflow" aria-labelledby="workflow-title">
          <div className="landing-section-heading">
            <h2 id="workflow-title">From coordinates to a sequence</h2>
            <button type="button" className="landing-text-action" onClick={() => onNavigate('Docs')}>Read the guide <ArrowRight size={14} aria-hidden="true" /></button>
          </div>
          <ol>
            <li><span className="landing-step-number" aria-hidden="true">1</span><div><h3>Choose a patch of sky</h3><p>Enter RA and Dec, or use an example. Load the observations available for that position.</p></div></li>
            <li><span className="landing-step-number" aria-hidden="true">2</span><div><h3>Compare observation dates</h3><p>Browse the Images timeline. In Compare images, align two to four images, then press Play. Use matching wavelengths over time for stricter comparisons.</p></div></li>
            <li><span className="landing-step-number" aria-hidden="true">3</span><div><h3>Pause on a change</h3><p>Mark a point that seems to move. Inspect the same area in both dates before drawing a conclusion.</p></div></li>
          </ol>
        </section>

        <section className="landing-video" aria-labelledby="landing-video-title">
          <div className="landing-video-intro"><p className="landing-eyebrow">A closer look</p><h2 id="landing-video-title">Watch how it works.</h2><p>From choosing coordinates to comparing dates and inspecting a possible change.</p><button type="button" className="landing-text-action" onClick={() => onNavigate('Docs')}>Explore the guide <ArrowRight size={15} aria-hidden="true" /></button></div>
          <figure className="landing-video-frame">
            {youtubeId ? <iframe src={'https://www.youtube-nocookie.com/embed/' + youtubeId + '?rel=0'} title={HOME_VIDEO.title} loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
              : <div className="landing-video-placeholder"><img src="/assets/docs/epoch-comparison-v2.png" alt="Schematic showing two sky images aligned before inspecting a possible change in position." width={1752} height={897} loading="lazy" /><div className="landing-video-notice"><span className="landing-video-symbol" aria-hidden="true"><Play size={22} /></span><strong>Video coming soon</strong><span>A guided introduction to AURAx.</span></div></div>}
            {!youtubeId && <figcaption>Comparison schematic · illustration, not observation data.</figcaption>}
          </figure>
        </section>

        <section className="landing-faq landing-section" aria-labelledby="faq-title">
          <div><p className="landing-eyebrow">Before you explore</p><h2 id="faq-title">A few useful answers.</h2><p className="landing-body">You can start with a sample target. The guide explains the tools and their scientific limits in more detail.</p><button type="button" className="landing-text-action" onClick={() => onNavigate('Docs')}>Open the guide <ArrowRight size={14} aria-hidden="true" /></button></div>
          <div className="landing-faq-list">
            {HOME_FAQ.map(item => <details key={item.question}><summary>{item.question}<ChevronDown size={16} aria-hidden="true" /></summary><p>{item.answer}</p></details>)}
          </div>
        </section>
        <footer className="landing-footer">
          <span>AURAx · Public SPHEREx observations</span>
          <a href="https://irsa.ipac.caltech.edu/Missions/spherex.html" target="_blank" rel="noreferrer">SPHEREx archive ↗</a>
        </footer>
      </div>
    </div>
  );
}
export default LandingView;
