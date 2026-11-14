import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Crosshair, Loader2, Maximize2, Pause, Play, SlidersHorizontal, X } from 'lucide-react';
import { compareSequence, findComparisonMatches } from '../services/api';
import type { ResolvedTarget, SequenceRequest, MatchRequest } from '../services/api';
import { DETECTOR_COLORS } from '../tokens/colors';
import { ComparisonCanvas, ComparisonPatch } from '../components/ComparisonCanvas';
import type { CompareTransform, ImagePoint } from '../components/ComparisonCanvas';
import { createSequenceLoader, displayedSequence, observationIdentity, sequenceKey } from '../utils/comparisonSequence';
import { createMatchLoader, matchKey, recommendedObservations } from '../utils/comparisonMatches';
import type { MatchState } from '../utils/comparisonMatches';
import type { SequenceState } from '../utils/comparisonSequence';
import { matchesObservation } from '../utils/navigation';
import { useRetainedState } from '../utils/AnalysisContext';
import './compare.css';

const FIT: CompareTransform = { zoom: 1, pan: { x: 0, y: 0 } };
const dateLabel = (value: string) => value.slice(0, 10);
const utc = (value: string) => value.replace('T', ' ').replace(/Z$/, '') + ' UTC';
export const timeGap = (days: number) => days >= 1 ? days.toFixed(1) + ' days' : days * 24 >= 1 ? (days * 24).toFixed(1) + ' hours' : (days * 1440).toFixed(1) + ' minutes';
type Selection = { key: string; a: string; b: string; c?: string; d?: string };

export function CompareView({ target }: { target: ResolvedTarget | null }) {
  const targetKey = JSON.stringify(target ? [target.coordinates.ra_deg, target.coordinates.dec_deg] : null);
  const [filters, setFilters] = useRetainedState('compare', targetKey, 'filters', { key: '', detector: '', from: '', to: '' });
  const [selection, setSelection] = useRetainedState<Selection>('compare', targetKey, 'selection', { key: '', a: '', b: '' });
  const [preferredGroup, setPreferredGroup] = useRetainedState('compare', targetKey, 'group', '');
  const [manualDates, setManualDates] = useRetainedState('compare', targetKey, 'manualDates', false);
  const [size, setSize] = useRetainedState('compare', targetKey, 'size', 200);
  const [stretch, setStretch] = useRetainedState('compare', targetKey, 'stretch', 'zscale');
  const [mode, setMode] = useRetainedState<string>('compare', targetKey, 'mode', 'blink');
  const [speed, setSpeed] = useRetainedState('compare', targetKey, 'speed', 1000);
  const [invert, setInvert] = useRetainedState('compare', targetKey, 'invert', false);
  const [contrast, setContrast] = useRetainedState('compare', targetKey, 'contrast', 1);
  const [activeFrame, setActiveFrame] = useRetainedState('compare', targetKey, 'frame', 0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [state, setState] = useState<SequenceState | null>(null);
  const [loader] = useState(() => createSequenceLoader(compareSequence));
  const [matchingLoader] = useState(() => createMatchLoader(findComparisonMatches));
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [searchRevision, setSearchRevision] = useState({ key: '', value: 0 });
  const [playing, setPlaying] = useState(false);
  const [marking, setMarking] = useState(false);
  const [mark, setMark] = useState<{ key: string; point: ImagePoint } | null>(null);
  const [markError, setMarkError] = useState('');
  const [view, setView] = useState<{ key: string; transform: CompareTransform } | null>(null);
  const from = filters.key === targetKey ? filters.from : '';
  const to = filters.key === targetKey ? filters.to : '';
  const matchRequest = useMemo<MatchRequest | null>(() => target ? { ra_deg: target.coordinates.ra_deg, dec_deg: target.coordinates.dec_deg, from_date: from || undefined, to_date: to || undefined, size_px: size } : null, [target, from, to, size]);
  const searchKey = matchRequest ? matchKey(matchRequest) : '';
  const matching = matchState?.key === searchKey ? matchState.data : undefined;
  const searching = !!target && (!matchState || matchState.key !== searchKey || matchState.searching);
  const searchError = matchState?.key === searchKey ? matchState.error : null;
  const group = matching?.groups.find(value => value.id === preferredGroup) || matching?.groups[0];
  const detector = group?.detector || '';
  const pool = useMemo(() => group?.observations || [], [group]);
  const selectionKey = JSON.stringify([targetKey, from, to, group?.id || '']);
  const defaults = useMemo(() => group ? recommendedObservations(group) : [], [group]);
  const selectedIds = useMemo(() => {
    if (manualDates) return [selection.a, selection.b, selection.c, selection.d].filter((id): id is string => !!id);
    return defaults.map(observationIdentity);
  }, [manualDates, selection, defaults]);
  const selected = useMemo(() => selectedIds.map(id => pool.find(item => matchesObservation(item, id))).filter(item => !!item).sort((a, b) => a.mjd_start - b.mjd_start), [pool, selectedIds]);
  const missing = selected.length !== selectedIds.length;
  const distinctTimes = new Set(selected.map(item => item.utc_date)).size === selected.length;
  const request = useMemo<SequenceRequest | null>(() => target && selected.length >= 2 && !missing && distinctTimes ? {
    epochs: selected, ra_deg: target.coordinates.ra_deg, dec_deg: target.coordinates.dec_deg, size_px: size, stretch,
  } : null, [target, selected, missing, distinctTimes, size, stretch]);
  const key = request ? sequenceKey(request) : null;
  const data = displayedSequence(state, key);
  const loading = !!key && state?.key === key && state.status === 'loading';
  const error = state?.key === key && state.status === 'error' ? state.message : null;
  const actualMode = data && !data.blink_ready || ['side-by-side', 'grid'].includes(mode) ? 'grid' : 'blink';
  const frame = data ? Math.min(Math.max(0, activeFrame), data.frames.length - 1) : 0;
  const canPlay = !!data?.blink_ready;
  const transform = view?.key === key ? view.transform : FIT;
  const point = mark?.key === key ? mark.point : null;

  useEffect(() => {
    if (!matchRequest) return;
    const advance = searchRevision.key === searchKey && searchRevision.value > 0;
    void matchingLoader.select({ ...matchRequest, advance, retry_failed: advance }, next => {
      setMatchState(previous => ({ ...next, data: next.data || (previous?.key === next.key ? previous.data : undefined) }));
    });
    return () => matchingLoader.cancel();
    // The key includes the complete coordinate/date/size scope.
  }, [searchKey, searchRevision, matchingLoader]);
  useEffect(() => {
    if (!group) return;
    setFilters({ key: targetKey, detector, from, to });
    if (!missing) setSelection({ key: selectionKey, a: selectedIds[0] || '', b: selectedIds[1] || '', c: selectedIds[2] || '', d: selectedIds[3] || '' });
  }, [group, detector, targetKey, from, to, missing, selectionKey, selectedIds, setFilters, setSelection]);
  useEffect(() => {
    loader.cancel(); setPlaying(false); setActiveFrame(0); setMark(null); setMarkError('');
    if (request) void loader.select(request, setState);
    return () => loader.cancel();
    // Pixel work changes only when the complete sequence request changes.
  }, [key, loader]);
  useEffect(() => {
    if (!playing || !canPlay || !data) return;
    const timer = window.setInterval(() => setActiveFrame(value => (value + 1) % data.frames.length), speed);
    return () => window.clearInterval(timer);
  }, [playing, canPlay, data, speed, setActiveFrame]);

  function changeFilters(next: Partial<typeof filters>) {
    setPlaying(false); setManualDates(false); setPreferredGroup(''); setFilters({ key: targetKey, detector, from, to, ...next });
  }
  function toggleObservation(id: string) {
    setPlaying(false); setMarkError(''); setManualDates(true);
    const ids = selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : selectedIds.length < 4 ? [...selectedIds, id] : selectedIds;
    setSelection({ key: selectionKey, a: ids[0] || '', b: ids[1] || '', c: ids[2] || '', d: ids[3] || '' });
  }
  function prepare() { if (request) { setPlaying(false); void loader.select(request, setState); } }
  function continueSearch() { setSearchRevision(value => ({ key: searchKey, value: value.key === searchKey ? value.value + 1 : 1 })); }
  function updateTransform(next: CompareTransform) { if (key) setView({ key, transform: next }); }
  function markPoint(next: ImagePoint) {
    if (!data || !key) return;
    const mask = actualMode === 'blink' ? data.valid_mask : data.coverage_mask;
    if (next.x < 0 || next.y < 0 || next.x >= data.width || next.y >= data.height || !mask[next.y * data.width + next.x]) {
      setMarkError('Choose a visible pixel inside the usable sky area.'); return;
    }
    setPlaying(false); setMarkError(''); setMark({ key, point: next });
  }
  function step(delta: number) {
    if (!data) return;
    setPlaying(false); setActiveFrame((frame + delta + data.frames.length) % data.frames.length);
  }
  const emptyTitle = loading ? 'Aligning your matching dates' : error ? 'Images could not be prepared' : !target ? 'Choose a sky position' : searchError && !group ? 'Matching search unavailable' : missing ? 'Saved dates are not in this matched list' : group && selected.length < 2 ? 'Choose at least two dates' : searching ? 'Finding matching wavelengths' : matching?.complete ? 'No compatible dates found' : 'More observations need checking';
  const emptyMessage = loading ? 'Every frame is being checked on the same sky grid. Playback opens paused.' : error || searchError || (!target ? 'Enter coordinates or choose an example on Home.' : missing ? 'Use the suggested dates to build a wavelength-compatible sequence.' : group && selected.length < 2 ? 'Check another date in this wavelength group, or use suggested dates.' : searching ? 'Checking real calibration at your sky position and looking for repeat observations over time.' : matching?.message || 'Continue checking the archive for compatible dates.');
  const timeline = data ? data.frames.map(value => value.epoch) : selected;

  return <section className="comparison-root" aria-label="Compare dates">
    <header className="comparison-heading"><div><h1>Compare dates</h1><p>One patch of sky. Different moments.</p></div><span>{data ? `${data.frames.length} frames · ${timeGap(data.baseline_days)}` : 'Matching wavelengths · different dates'}</span></header>
    <div className="comparison-workspace">
      {panelOpen && <aside className="comparison-selection" aria-label="Observations and filters">
        <div className="comparison-section-heading"><h2>Matching dates</h2><button aria-label="Close observations panel" onClick={() => setPanelOpen(false)}><X size={16} /></button></div>
        <div className="comparison-wavelength-choice">
          <label htmlFor="comparison-wavelength">Wavelength at target</label>
          {matching && matching.groups.length > 1 ? <select id="comparison-wavelength" value={group?.id || ''} onChange={event => { setPlaying(false); setManualDates(false); setPreferredGroup(event.target.value); setMode('blink'); }}>
            {matching.groups.map(value => <option key={value.id} value={value.id}>{value.detector} · ≈ {value.wavelength_um.toFixed(3)} µm · {value.observations.length} dates</option>)}
          </select> : <p>{group ? `${group.detector} · ≈ ${group.wavelength_um.toFixed(3)} µm` : searching ? 'Checking calibration…' : 'No matched group yet'}</p>}
        </div>
        <details className="comparison-settings"><summary><SlidersHorizontal size={13} /> Filters & display<span>{detector || 'No detector'} · {Math.min(15, size * 6.2 / 60).toFixed(1)}′</span></summary>
          <div className="comparison-date-range"><label>From · UTC<input type="date" value={from} onChange={event => changeFilters({ from: event.target.value })} /></label><label>To · UTC<input type="date" value={to} min={from || undefined} onChange={event => changeFilters({ to: event.target.value })} /></label></div>
          <fieldset><legend>Field of view</legend><div className="comparison-sizes">{[50, 100, 200].map(value => <label key={value}><input type="radio" name="comparison-size" checked={size === value} onChange={() => { setPlaying(false); setSize(value); }} /><span>{Math.min(15, value * 6.2 / 60).toFixed(1)}′</span></label>)}</div><p className="comparison-hint">About {Math.min(15, size * 6.2 / 60).toFixed(1)}′ across</p></fieldset>
          <label className="comparison-inline-label">Stretch<select value={stretch} onChange={event => { setPlaying(false); setStretch(event.target.value); }}><option value="zscale">ZScale</option><option value="linear">Linear</option><option value="log">Log</option></select></label>
          <label className="comparison-contrast">Contrast <input type="range" min={.5} max={3} step={.1} value={contrast} onChange={event => setContrast(Number(event.target.value))} /><output>{contrast.toFixed(1)}×</output></label>
          <label className="comparison-checkbox"><input type="checkbox" checked={invert} onChange={event => setInvert(event.target.checked)} />Invert grayscale</label>
          <button className="comparison-text-action" onClick={() => { changeFilters({ detector: '', from: '', to: '' }); setSize(200); setStretch('zscale'); setContrast(1); setInvert(false); }}>Reset filters & display</button>
        </details>
        <div className="comparison-selection-summary"><span>{selectedIds.length} of 4 selected</span><span>UTC</span></div>
        <p className="comparison-list-hint">Dates below match in wavelength.</p>
        <div className="comparison-observation-list">{pool.map(observation => {
          const id = observationIdentity(observation);
          const checked = selected.some(value => observationIdentity(value) === id);
          return <label key={id} className={checked ? 'is-selected' : ''}><input type="checkbox" checked={checked} disabled={!checked && selectedIds.length >= 4} onChange={() => {
            const retainedId = selectedIds.find(value => matchesObservation(observation, value));
            toggleObservation(retainedId || id);
          }} /><span><strong>{dateLabel(observation.utc_date)}</strong><small>{observation.utc_date.slice(11, 19)}</small></span><i style={{ backgroundColor: DETECTOR_COLORS[observation.detector] }} title={observation.detector} /></label>;
        })}{missing && <p className="comparison-warning">A saved frame is unavailable. <button onClick={() => setManualDates(false)}>Use suggested dates</button></p>}
          {!pool.length && <p className="comparison-note">{searching ? 'Checking archive observations…' : 'No compatible group found in the checked observations.'}</p>}
        </div>
        <div className="comparison-prepare-area">
          {!distinctTimes && <p className="comparison-warning">Choose frames with different observation times.</p>}
          {group && <p className="comparison-hint">{selected.length} matching frames · {timeGap(group.baseline_days)} available span. {selected.length < 4 ? 'More dates may appear as the search continues.' : 'Four dates suggested across the available span.'}</p>}
          {manualDates && <button className="comparison-text-action" onClick={() => setManualDates(false)}>Use suggested dates</button>}
          {error && <button className="comparison-prepare" onClick={prepare}>Retry images</button>}
          <p className="comparison-hint" role="status">{searching ? 'Checking a bounded batch of observations…' : searchError || matching?.message || 'Ready to search.'}</p>
          {!searching && (matching?.can_continue || searchError) && <button className="comparison-text-action" onClick={continueSearch}>{searchError ? 'Retry matching search' : 'Check more dates'}</button>}
        </div>
      </aside>}
      <div className="comparison-stage">
        <div className="comparison-toolbar">
          {!panelOpen && <button className="comparison-panel-toggle" onClick={() => setPanelOpen(true)}><SlidersHorizontal size={14} />Observations</button>}
          <div className="comparison-modes" role="group" aria-label="Viewing mode"><button aria-pressed={actualMode === 'blink'} disabled={!!data && !data.blink_ready} onClick={() => { setPlaying(false); setMode('blink'); }}>Blink</button><button aria-pressed={actualMode === 'grid'} onClick={() => { setPlaying(false); setMode('grid'); }}>Grid</button></div>
          <span className="comparison-toolbar-date">{data ? utc(data.frames[frame].epoch.utc_date) : 'Same sky · shared contrast'}</span>
          <button disabled={!data} aria-label="Fit all images to view" onClick={() => updateTransform(FIT)}><Maximize2 size={15} /><span>Fit</span></button>
          <button disabled={!data} aria-pressed={marking} onClick={() => { setPlaying(false); setMarking(value => !value); }}><Crosshair size={15} /><span>Mark</span></button>
        </div>
        {!data ? <div className="comparison-empty" role={error || searchError ? 'alert' : 'status'}>{loading && <Loader2 size={23} className="animate-spin" />}<h2>{emptyTitle}</h2><p>{emptyMessage}</p>{!loading && !panelOpen && <button className="comparison-text-action" onClick={() => setPanelOpen(true)}>Open matching dates</button>}</div> : <>
          <div className={'comparison-canvases ' + (actualMode === 'grid' ? 'is-grid' : '')}>{(actualMode === 'grid' ? data.frames.map((_, index) => index) : [frame]).map(index => <section key={actualMode === 'blink' ? 'blink' : index} className="comparison-image" aria-label={'Frame ' + (index + 1)}>
            <div className="comparison-image-heading"><span>{index + 1} / {data.frames.length}</span><strong>{dateLabel(data.frames[index].epoch.utc_date)} <small>{data.frames[index].epoch.utc_date.slice(11, 19)} UTC</small></strong><span className="comparison-detector"><i style={{ backgroundColor: DETECTOR_COLORS[data.frames[index].epoch.detector] }} />{data.frames[index].wavelength_um.toFixed(4)} µm</span></div>
            <div className="comparison-canvas-wrap"><ComparisonCanvas data={data} frame={index} masked={actualMode === 'blink'} invert={invert} contrast={contrast} transform={transform} onTransform={updateTransform} marking={marking} point={point} onMark={markPoint} /></div>
          </section>)}</div>
          <div className={'comparison-status' + (!data.blink_ready ? ' is-warning' : '')} role="status">{data.message}</div>
        </>}
        <div className="comparison-timeline" aria-label="Observation timeline">{timeline.map((epoch, index) => <button key={observationIdentity(epoch)} className={data && frame === index ? 'is-active' : ''} aria-label={'Show frame ' + (index + 1) + ', ' + utc(epoch.utc_date)} aria-current={data && frame === index ? 'step' : undefined} disabled={!data} onClick={() => { setPlaying(false); setActiveFrame(index); }}><span className="comparison-step"><i /></span><strong>{dateLabel(epoch.utc_date)}</strong><small>{epoch.utc_date.slice(11, 19)}</small></button>)}{!timeline.length && <p>Select observations to build a timeline.</p>}</div>
        <footer className="comparison-playback" aria-label="Sequence playback">
          <div className="comparison-transport"><button aria-label="Previous frame" disabled={!data} onClick={() => step(-1)}><ArrowLeft size={17} /></button><button className="comparison-play" disabled={!canPlay} onClick={() => { setMode('blink'); setPlaying(value => !value); }}>{playing && canPlay ? <Pause size={17} /> : <Play size={17} />}<span>{playing && canPlay ? 'Pause' : 'Play'}</span></button><button aria-label="Next frame" disabled={!data} onClick={() => step(1)}><ArrowRight size={17} /></button></div>
          <span className="comparison-playback-note">{data ? actualMode === 'grid' ? 'Grid · linked pan & zoom' : `Frame ${frame + 1} of ${data.frames.length}` : group && selected.length < 2 ? 'Choose at least two dates' : 'Finding matching dates'}</span>
          <label>Playback<input type="range" min={250} max={2000} step={50} value={speed} onChange={event => setSpeed(Number(event.target.value))} /><output>{(speed / 1000).toFixed(2)} s/frame</output></label>
        </footer>
        <div className="comparison-bottom"><span>{marking ? 'Click to mark · Enter and arrow keys also work' : 'Drag to pan · scroll or + / − to zoom'}</span>{data && <details><summary>Image checks & details</summary><dl><dt>Alignment</dt><dd>Full WCS + SIP · frame 1 grid</dd><dt>Target wavelengths</dt><dd>{data.wavelength_match ? 'All frames match' : 'Mismatch; blink disabled'}</dd><dt>Usable for blink</dt><dd>{(data.valid_fraction * 100).toFixed(1)}%</dd><dt>Time span</dt><dd>{timeGap(data.baseline_days)}</dd></dl><p>{data.wavelength_method}</p><p>{data.provenance}</p>{data.frames.map((value, index) => <p key={index}>Frame {index + 1}: {utc(value.epoch.utc_date)} · {value.epoch.detector} · {value.epoch.obs_id}</p>)}<p>Playback uses equal frame intervals; observation dates can be unevenly spaced. Shared contrast is for visual inspection, not photometry.</p></details>}</div>
        {markError && <p className="comparison-warning" role="alert">{markError}</p>}
        {point && data && <section className="comparison-marked" aria-label="Marked area across dates"><div><h2>Marked area</h2><p>Grid pixel {point.x}, {point.y}. A mark is not a confirmed moving object.</p><button className="comparison-text-action" onClick={() => { setMark(null); setMarkError(''); }}>Clear mark</button></div><div className="comparison-patches">{data.frames.map((value, index) => <figure key={index}><ComparisonPatch data={data} frame={index} point={point} invert={invert} contrast={contrast} /><figcaption>{dateLabel(value.epoch.utc_date)}<br />{value.epoch.utc_date.slice(11, 19)} UTC</figcaption></figure>)}</div></section>}
      </div>
    </div>
  </section>;
}
