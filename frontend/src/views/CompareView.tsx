import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Crosshair, Loader2, Maximize2, Pause, Play, SlidersHorizontal, X } from 'lucide-react';
import { compareSequence, fetchObservations, findComparisonMatches } from '../services/api';
import type { ResolvedTarget, SequenceRequest, MatchRequest, ObservationsResponse } from '../services/api';
import { DETECTOR_COLORS } from '../tokens/colors';
import { ComparisonCanvas, ComparisonPatch } from '../components/ComparisonCanvas';
import { DetectorDropdown } from '../components/DetectorDropdown';
import { CHECKED_COMPARISON, checkedComparisonAt } from '../data/checkedComparison';
import type { CompareTransform, ImagePoint } from '../components/ComparisonCanvas';
import { createSequenceLoader, defaultGeneralSequence, displayedSequence, observationIdentity, sequenceKey } from '../utils/comparisonSequence';
import { createMatchLoader, matchKey, recommendedObservations } from '../utils/comparisonMatches';
import type { MatchState } from '../utils/comparisonMatches';
import type { SequenceState } from '../utils/comparisonSequence';
import { filterComparisonImages } from '../utils/comparisonSelection';
import { matchesObservation } from '../utils/navigation';
import { useRetainedState } from '../utils/AnalysisContext';
import './compare.css';

const SIDE_TABS = ['Controls', 'Quality', 'Details'] as const;
const LEFT_TABS = ['Images', 'Filters'] as const;
const FIT: CompareTransform = { zoom: 1, pan: { x: 0, y: 0 } };
const dateLabel = (value: string) => value.slice(0, 10);
const utc = (value: string) => value.replace('T', ' ').replace(/Z$/, '') + ' UTC';
export const timeGap = (days: number) => days >= 1 ? days.toFixed(1) + ' days' : days * 24 >= 1 ? (days * 24).toFixed(1) + ' hours' : (days * 1440).toFixed(1) + ' minutes';
type Selection = { key: string; a: string; b: string; c?: string; d?: string };

export function CompareView({ target }: { target: ResolvedTarget | null }) {
  const targetKey = JSON.stringify(target ? [target.coordinates.ra_deg, target.coordinates.dec_deg] : null);
  const [comparisonKind, setComparisonKind] = useRetainedState<'general' | 'matched'>('compare', targetKey, 'comparisonKind', 'general');
  const general = comparisonKind === 'general';
  const [checkedExample, setCheckedExample] = useRetainedState('compare', targetKey, 'checkedExample', '');
  const checked = !!target && checkedExample === CHECKED_COMPARISON.id && checkedComparisonAt(target.coordinates.ra_deg, target.coordinates.dec_deg);
  const [minimumGap, setMinimumGap] = useRetainedState('compare', targetKey, 'minimumGap', 30);
  const [archive, setArchive] = useState<{ key: string; loading: boolean; data?: ObservationsResponse; error?: string } | null>(null);
  const [filters, setFilters] = useRetainedState('compare', targetKey, 'filters', { key: '', detector: '', from: '', to: '' });
  const [listFilters, setListFilters] = useRetainedState('compare', targetKey, 'listFilters', { query: '', release: '', sort: 'oldest' });
  const [archiveLimit, setArchiveLimit] = useState(100);
  const [selection, setSelection] = useRetainedState<Selection>('compare', targetKey, 'selection', { key: '', a: '', b: '' });
  const [preferredGroup, setPreferredGroup] = useRetainedState('compare', targetKey, 'group', '');
  const [manualDates, setManualDates] = useRetainedState('compare', targetKey, 'manualDates', false);
  const [size, setSize] = useRetainedState('compare', targetKey, 'size', 50);
  const [stretch, setStretch] = useRetainedState('compare', targetKey, 'stretch', 'zscale');
  const [mode, setMode] = useRetainedState<string>('compare', targetKey, 'mode', 'grid');
  const [speed, setSpeed] = useRetainedState('compare', targetKey, 'speed', 1000);
  const [invert, setInvert] = useRetainedState('compare', targetKey, 'invert', false);
  const [contrast, setContrast] = useRetainedState('compare', targetKey, 'contrast', 1);
  const [activeFrame, setActiveFrame] = useRetainedState('compare', targetKey, 'frame', 0);
  const [panelOpen, setPanelOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 700);
  const [leftTab, setLeftTab] = useState<typeof LEFT_TABS[number]>('Images');
  const leftTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [sideTab, setSideTab] = useState<typeof SIDE_TABS[number]>('Controls');
  const sideTabRefs = useRef<(HTMLButtonElement | null)[]>([]);
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
  const matchRequest = useMemo<MatchRequest | null>(() => target && !general && !checked ? { ra_deg: target.coordinates.ra_deg, dec_deg: target.coordinates.dec_deg, from_date: from || undefined, to_date: to || undefined, size_px: size, min_baseline_days: minimumGap, time_sampling: 'spread' } : null, [target, general, checked, from, to, size, minimumGap]);
  const searchKey = matchRequest ? matchKey(matchRequest) : '';
  const matching = matchState?.key === searchKey ? matchState.data : undefined;
  const searching = !checked && !!target && (general ? archive?.key !== targetKey || archive.loading : !matchState || matchState.key !== searchKey || matchState.searching);
  const searchError = checked ? null : general ? archive?.key === targetKey ? archive.error : null : matchState?.key === searchKey ? matchState.error : null;
  const group = matching?.groups.find(value => value.id === preferredGroup) || matching?.groups[0];
  const detector = general ? filters.key === targetKey ? filters.detector : '' : group?.detector || '';
  const allPool = useMemo(() => checked ? CHECKED_COMPARISON.observations : general ? (archive?.key === targetKey ? archive.data?.observations || [] : []) : group?.observations || [], [checked, general, archive, targetKey, group]);
  const pool = useMemo(() => filterComparisonImages(allPool, { detector, from, to, ...listFilters, release: general ? listFilters.release : '' }), [allPool, detector, from, to, listFilters, general]);
  const selectionKey = JSON.stringify([targetKey, comparisonKind, general ? '' : from, general ? '' : to, group?.id || '', ...(checked ? [CHECKED_COMPARISON.id] : [])]);
  const defaults = useMemo(() => checked ? CHECKED_COMPARISON.observations : general ? defaultGeneralSequence(allPool) : group ? recommendedObservations(group) : [], [checked, general, allPool, group]);
  const selectedIds = useMemo(() => {
    if (manualDates && (selection.key === selectionKey || selection.key === targetKey)) return [selection.a, selection.b, selection.c, selection.d].filter((id): id is string => !!id);
    return defaults.map(observationIdentity);
  }, [manualDates, selection, selectionKey, targetKey, defaults]);
  const selected = useMemo(() => selectedIds.map(id => allPool.find(item => matchesObservation(item, id))).filter(item => !!item).sort((a, b) => a.mjd_start - b.mjd_start), [allPool, selectedIds]);
  const hiddenSelected = selected.filter(item => !pool.includes(item)).length;
  const missing = selected.length !== selectedIds.length;
  const distinctTimes = new Set(selected.map(item => item.utc_date)).size === selected.length;
  const request = useMemo<SequenceRequest | null>(() => target && selected.length >= 2 && !missing && (general || distinctTimes) ? {
    epochs: selected, ra_deg: target.coordinates.ra_deg, dec_deg: target.coordinates.dec_deg, size_px: size, stretch, comparison_kind: comparisonKind,
  } : null, [target, selected, missing, general, distinctTimes, size, stretch, comparisonKind]);
  const key = request ? sequenceKey(request) : null;
  const data = displayedSequence(state, key);
  const loading = !!key && state?.key === key && state.status === 'loading';
  const error = state?.key === key && state.status === 'error' ? state.message : null;
  const playbackReady = general ? !!data?.visual_playback_ready : !!data?.blink_ready;
  const actualMode = !playbackReady || ['side-by-side', 'grid'].includes(mode) ? 'grid' : 'blink';
  const frame = data ? Math.min(Math.max(0, activeFrame), data.frames.length - 1) : 0;
  const canPlay = playbackReady;
  const transform = view?.key === key ? view.transform : FIT;
  const point = mark?.key === key ? mark.point : null;

  useEffect(() => {
    if (!general || !target || checked) return;
    const controller = new AbortController();
    setArchive(previous => ({ key: targetKey, loading: true, data: previous?.key === targetKey ? previous.data : undefined }));
    void fetchObservations(target.coordinates.ra_deg, target.coordinates.dec_deg, archiveLimit, controller.signal).then(data => {
      if (!controller.signal.aborted) setArchive({ key: targetKey, loading: false, data });
    }).catch(error => {
      if (!controller.signal.aborted) setArchive({ key: targetKey, loading: false, error: error instanceof Error ? error.message : 'Archive unavailable.' });
    });
    return () => controller.abort();
    // Fetch once per target or explicit retry; date/detector filters use this list.
  }, [general, checked, targetKey, searchRevision, archiveLimit]);
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
    return () => loader.cancel();
    // Selection changes cancel old work; analysis starts only from the top action.
  }, [key, loader]);
  useEffect(() => {
    if (!playing || !canPlay || !data) return;
    const timer = window.setInterval(() => setActiveFrame(value => (value + 1) % data.frames.length), speed);
    return () => window.clearInterval(timer);
  }, [playing, canPlay, data, speed, setActiveFrame]);

  function changeFilters(next: Partial<typeof filters>) {
    setPlaying(false); if (!general) { setManualDates(false); setPreferredGroup(''); } setFilters({ key: targetKey, detector, from, to, ...next });
  }
  function chooseImages(ids: string[]) {
    setPlaying(false); setMarkError(''); setManualDates(true);
    setSelection({ key: selectionKey, a: ids[0] || '', b: ids[1] || '', c: ids[2] || '', d: ids[3] || '' });
  }
  function toggleObservation(id: string) {
    setPlaying(false); setMarkError(''); setManualDates(true);
    const ids = selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : selectedIds.length < 4 ? [...selectedIds, id] : selectedIds;
    chooseImages(ids);
  }
  function prepare() { if (request) { setPlaying(false); void loader.select(request, setState); } }
  function continueSearch() { setSearchRevision(value => ({ key: searchKey, value: value.key === searchKey ? value.value + 1 : 1 })); }
  function updateTransform(next: CompareTransform) { if (key) setView({ key, transform: next }); }
  function markPoint(next: ImagePoint) {
    if (!data || !key) return;
    setSideTab('Details');
    const mask = actualMode === 'blink' && !general ? data.valid_mask : data.display_mask || data.coverage_mask;
    if (next.x < 0 || next.y < 0 || next.x >= data.width || next.y >= data.height || !mask[next.y * data.width + next.x]) {
      setMarkError('Choose a visible pixel inside the usable sky area.'); return;
    }
    setPlaying(false); setMarkError(''); setMark({ key, point: next });
  }
  function step(delta: number) {
    if (!data) return;
    setPlaying(false); setActiveFrame((frame + delta + data.frames.length) % data.frames.length);
  }
  const emptyTitle = loading ? 'Aligning selected images' : error ? 'Images could not be prepared' : !target ? 'Choose a sky position' : searchError ? 'Archive search unavailable' : missing ? 'Saved images are not in this list' : request ? `Ready to analyse ${selected.length} images` : searching ? 'Finding observations' : general ? 'Choose images to compare' : matching?.complete ? 'No matching wavelengths in the checked images' : 'More observations need checking';
  const emptyMessage = loading ? 'Loading small target cutouts one at a time, then aligning them on the same sky grid.' : error || searchError || (!target ? 'Enter coordinates or choose an example on Home.' : request ? 'Review your selection, then press Analyse images at the top. Images are downloaded and aligned only when you start analysis.' : general ? 'Select up to four images. Different wavelengths, detectors, and observation times can be inspected in a linked grid. At least two images are needed to start.' : missing ? 'Use suggested observations or change the selection.' : searching ? 'Checking real calibration at your sky position.' : matching?.message || 'Continue checking observations; unchecked images may still contain wavelength matches.');
  const timeline = data ? data.frames.map(value => value.epoch) : selected;

  return <section className="comparison-root" aria-label="Compare images">
    <header className="comparison-heading"><div><h1>Compare images</h1><p>Explore the same sky across wavelengths and observations.</p></div><div className="comparison-heading-actions"><span aria-live="polite">{selectedIds.length} / 4 selected</span><button className="comparison-analyse" disabled={!request || loading} onClick={prepare}>{loading && <Loader2 size={14} className="animate-spin" />}{loading ? 'Analysing images…' : `Analyse ${selected.length || ''} images`}</button></div></header>
    <div className="comparison-selected-tray" aria-label="Selected images">
      <span>Selected images</span>{selected.map((image, index) => <button key={observationIdentity(image)} title={`Remove ${image.obs_id} · ${image.detector}`} aria-label={`Remove selected image ${index + 1}, ${image.detector}, ${image.utc_date}`} onClick={() => chooseImages(selectedIds.filter(id => !matchesObservation(image, id)))}><b>{index + 1}</b>{image.detector} · {dateLabel(image.utc_date)}<X size={12} /></button>)}
      {!selected.length && <span>Choose images from the list below.</span>}
      {hiddenSelected > 0 && <span role="status">{hiddenSelected} selected {hiddenSelected === 1 ? 'image is' : 'images are'} hidden by filters</span>}
    </div>
    <div className="comparison-workspace">
      {panelOpen && <aside className="comparison-selection" aria-label="Observations and filters">
        <div className="comparison-section-heading"><h2>Observations</h2><button aria-label="Close observations panel" onClick={() => setPanelOpen(false)}><X size={16} /></button></div>
        <div className="comparison-tabs" role="tablist" aria-label="Observation selection">
          {LEFT_TABS.map((name, index) => <button key={name} ref={element => { leftTabRefs.current[index] = element; }} id={'comparison-left-tab-' + index} type="button" role="tab" aria-selected={leftTab === name} aria-controls="comparison-left-panel" tabIndex={leftTab === name ? 0 : -1} onClick={() => setLeftTab(name)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % LEFT_TABS.length : event.key === 'ArrowLeft' ? (index + LEFT_TABS.length - 1) % LEFT_TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? LEFT_TABS.length - 1 : null;
            if (next !== null) { event.preventDefault(); setLeftTab(LEFT_TABS[next]); leftTabRefs.current[next]?.focus(); }
          }}>{name}</button>)}
        </div>
        <div className={'comparison-left-content ' + (leftTab === 'Images' ? 'is-images' : 'is-filters')} id="comparison-left-panel" role="tabpanel" aria-labelledby={'comparison-left-tab-' + LEFT_TABS.indexOf(leftTab)}>
        {leftTab === 'Filters' && <>
        <label className="comparison-inline-label">Compare<select value={comparisonKind} onChange={event => { setPlaying(false); setManualDates(false); setPreferredGroup(''); setCheckedExample(''); setComparisonKind(event.target.value as 'general' | 'matched'); setMode(event.target.value === 'general' ? 'grid' : 'blink'); }}><option value="general">General images</option><option value="matched">Matching wavelengths over time</option></select></label>
        {checked ? <p className="comparison-checked-note">Checked example: two real D3 observations, {CHECKED_COMPARISON.baseline_days.toFixed(1)} days apart. Wavelength and overlap checks run again when you press Analyse.</p> : general ? <div className="comparison-search-filters"><p className="comparison-hint">Four distinct images are suggested across the retrieved dates when available. Filters keep your selected images.</p><DetectorDropdown value={detector} onChange={value => changeFilters({ detector: value })} /><label className="comparison-inline-label">Release<select value={listFilters.release} onChange={event => setListFilters({ ...listFilters, release: event.target.value })}><option value="">All releases</option>{[...new Set(allPool.map(image => image.release).filter((release): release is string => !!release))].sort().map(release => <option key={release} value={release}>{release.toUpperCase()}</option>)}</select></label></div> : <div className="comparison-wavelength-choice">
          <label htmlFor="comparison-wavelength">Wavelength at target</label>
          {matching && matching.groups.length > 1 ? <select id="comparison-wavelength" value={group?.id || ''} onChange={event => { setPlaying(false); setManualDates(false); setPreferredGroup(event.target.value); setMode('blink'); }}>
            {matching.groups.map(value => <option key={value.id} value={value.id}>{value.detector} · ≈ {value.wavelength_um.toFixed(3)} µm · {value.observations.length} dates</option>)}
          </select> : <p>{group ? `${group.detector} · ≈ ${group.wavelength_um.toFixed(3)} µm` : searching ? 'Checking calibration…' : 'No matched group yet'}</p>}
        </div>}
        {!general && !checked && <div className="comparison-search-filters"><label className="comparison-inline-label">Minimum time gap<select value={minimumGap} onChange={event => { setPlaying(false); setManualDates(false); setMinimumGap(Number(event.target.value)); }}>{[0, 1, 30, 90, 180].map(days => <option key={days} value={days}>{days ? `${days} days` : 'Any distinct time'}</option>)}</select></label><p className="comparison-hint">Checks earlier and later date windows. A short visit is not a demonstration of stellar motion. Every candidate still requires real wavelength calibration.</p></div>}
        <div className="comparison-search-filters">
          <div className="comparison-date-range"><label>From · UTC<input type="date" value={from} max={to || undefined} onChange={event => changeFilters({ from: event.target.value })} /></label><label>To · UTC<input type="date" value={to} min={from || undefined} onChange={event => changeFilters({ to: event.target.value })} /></label></div>
          <label className="comparison-search-label">Find an image<input type="search" value={listFilters.query} placeholder="Observation ID, detector, date…" onChange={event => setListFilters({ ...listFilters, query: event.target.value })} /></label>
          <label className="comparison-inline-label">Sort<select value={listFilters.sort} onChange={event => setListFilters({ ...listFilters, sort: event.target.value })}><option value="oldest">Oldest first</option><option value="newest">Newest first</option><option value="detector">Detector</option></select></label>
          <button className="comparison-text-action" onClick={() => { changeFilters({ detector: '', from: '', to: '' }); setListFilters({ query: '', release: '', sort: 'oldest' }); }}>Clear filters</button>
        </div>
        <p className="comparison-list-hint">{general ? 'Available archive images; filters apply to this retrieved list.' : 'These checked observations match in wavelength.'}</p>
        <div className="comparison-prepare-area">
          {!general && !distinctTimes && <p className="comparison-warning">Time comparisons require different observation times.</p>}
          {general && archive?.key === targetKey && <p className="comparison-hint">{archive.data?.message}</p>}
          {group && <p className="comparison-hint">{selected.length} matching frames · {timeGap(group.baseline_days)} available span. {selected.length < 4 ? 'More dates may appear as the search continues.' : 'Four dates suggested across the available span.'}</p>}
          {checked && <button className="comparison-text-action" onClick={() => { setPlaying(false); setCheckedExample(''); setComparisonKind('general'); setManualDates(false); }}>Browse archive images</button>}
          {manualDates && <button className="comparison-text-action" onClick={() => setManualDates(false)}>Use suggested images</button>}
          <p className="comparison-hint" role="status">{searching ? 'Checking a bounded batch of observations…' : searchError || (general ? archive?.data?.provenance : matching?.message) || 'Ready to search.'}</p>
          {!searching && ((!general && matching?.can_continue) || searchError) && <button className="comparison-text-action" onClick={continueSearch}>{searchError ? 'Retry archive search' : 'Check more observations'}</button>}
        </div>
        </>}
        {leftTab === 'Images' && <>
        <div className="comparison-selection-summary"><span>{pool.length} of {allPool.length} images shown</span><span>UTC</span></div>
        <div className="comparison-selection-actions"><button disabled={!pool.length} onClick={() => chooseImages(defaultGeneralSequence(pool).map(observationIdentity))}>{checked ? 'Select both' : 'Select four'}</button><button disabled={!selectedIds.length} onClick={() => chooseImages([])}>Clear selection</button>{general && archive?.data?.truncated && archiveLimit < 500 && <button disabled={searching} onClick={() => setArchiveLimit(value => Math.min(500, value + 100))}>Load more images</button>}</div>
        <div className="comparison-observation-list">{pool.map(observation => {
          const id = observationIdentity(observation);
          const checked = selected.some(value => observationIdentity(value) === id);
          return <label key={id} title={observation.obs_id} className={checked ? 'is-selected' : ''}><input type="checkbox" checked={checked} disabled={!checked && selectedIds.length >= 4} onChange={() => {
            const retainedId = selectedIds.find(value => matchesObservation(observation, value));
            toggleObservation(retainedId || id);
          }} /><span><strong>{dateLabel(observation.utc_date)} · {observation.detector}</strong><small>{observation.utc_date.slice(11, 19)}</small></span><i style={{ backgroundColor: DETECTOR_COLORS[observation.detector] }} title={observation.detector} /></label>;
        })}{missing && <p className="comparison-warning">A saved frame is unavailable. <button onClick={() => setManualDates(false)}>Use suggested images</button></p>}
          {!pool.length && <p className="comparison-note">{searching ? 'Checking archive observations…' : general ? 'No images in the retrieved list match these filters.' : 'No compatible group found in the checked observations.'}</p>}
        </div>
        {(checked || manualDates || searchError || (!general && matching?.can_continue)) && <div className="comparison-selection-footer">
          {checked && <button className="comparison-text-action" onClick={() => { setPlaying(false); setCheckedExample(''); setComparisonKind('general'); setManualDates(false); }}>Browse archive images</button>}
          {manualDates && <button className="comparison-text-action" onClick={() => setManualDates(false)}>Use suggested images</button>}
          {searchError && <p className="comparison-hint" role="alert">{searchError}</p>}
          {!searching && ((!general && matching?.can_continue) || searchError) && <button className="comparison-text-action" onClick={continueSearch}>{searchError ? 'Retry archive search' : 'Check more observations'}</button>}
        </div>}
        </>}
        </div>
      </aside>}
      <div className="comparison-stage">
        <div className="comparison-toolbar">
          {!panelOpen && <button className="comparison-panel-toggle" onClick={() => setPanelOpen(true)}><SlidersHorizontal size={14} />Observations</button>}
          <div className="comparison-modes" role="group" aria-label="Viewing mode"><button aria-pressed={actualMode === 'blink'} disabled={!canPlay} onClick={() => { setPlaying(false); setMode('blink'); }}>{general ? 'Sequence' : 'Blink'}</button><button aria-pressed={actualMode === 'grid'} onClick={() => { setPlaying(false); setMode('grid'); }}>Grid</button></div>
          <span className="comparison-toolbar-date">{data ? utc(data.frames[frame].epoch.utc_date) : 'Same sky · shared contrast'}</span>
        </div>
        {!data ? <div className="comparison-empty" role={error || searchError ? 'alert' : 'status'}>{loading && <Loader2 size={23} className="animate-spin" />}<h2>{emptyTitle}</h2><p>{emptyMessage}</p>{!loading && !panelOpen && <button className="comparison-text-action" onClick={() => setPanelOpen(true)}>Open observations</button>}</div> : <>
          <div className={'comparison-canvases ' + (actualMode === 'grid' ? 'is-grid' : '')}>{(actualMode === 'grid' ? data.frames.map((_, index) => index) : [frame]).map(index => <section key={actualMode === 'blink' ? 'blink' : index} className="comparison-image" aria-label={'Frame ' + (index + 1)}>
            <div className="comparison-image-heading"><span>{index + 1} / {data.frames.length}</span><strong>{dateLabel(data.frames[index].epoch.utc_date)} <small>{data.frames[index].epoch.utc_date.slice(11, 19)} UTC</small></strong><span className="comparison-detector"><i style={{ backgroundColor: DETECTOR_COLORS[data.frames[index].epoch.detector] }} />{data.frames[index].wavelength_um.toFixed(4)} µm</span></div>
            <div className="comparison-canvas-wrap"><ComparisonCanvas data={data} frame={index} masked={actualMode === 'blink' && !general} invert={invert} contrast={contrast} transform={transform} onTransform={updateTransform} marking={marking} point={point} onMark={markPoint} /></div>
          </section>)}</div>
        </>}
        <div className="comparison-stage-note">
          {data ? <button onClick={() => setSideTab('Quality')}>{(data.coverage_mask.filter(Boolean).length / (data.width * data.height) * 100).toFixed(1)}% usable sky{data.requested_position_usable === false ? ' · Requested position masked' : ''} · Image quality ↗</button> : <span>Real SPHEREx observations</span>}
        </div>
        <div className="comparison-timeline" aria-label="Observation timeline">{timeline.map((epoch, index) => <button key={observationIdentity(epoch)} className={data && frame === index ? 'is-active' : ''} aria-label={'Show frame ' + (index + 1) + ', ' + utc(epoch.utc_date)} aria-current={data && frame === index ? 'step' : undefined} disabled={!data} onClick={() => { setPlaying(false); setActiveFrame(index); }}><span className="comparison-step"><i /></span><strong>{dateLabel(epoch.utc_date)}</strong><small>{epoch.utc_date.slice(11, 19)}</small></button>)}{!timeline.length && <p>Select observations to build a timeline.</p>}</div>
      </div>
      <aside className="comparison-information" aria-label="Comparison controls and details">
        <div className="comparison-tabs" role="tablist" aria-label="Comparison information">
          {SIDE_TABS.map((name, index) => <button key={name} ref={element => { sideTabRefs.current[index] = element; }} id={'comparison-tab-' + index} type="button" role="tab" aria-selected={sideTab === name} aria-controls="comparison-side-panel" tabIndex={sideTab === name ? 0 : -1} onClick={() => setSideTab(name)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % SIDE_TABS.length : event.key === 'ArrowLeft' ? (index + SIDE_TABS.length - 1) % SIDE_TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? SIDE_TABS.length - 1 : null;
            if (next !== null) { event.preventDefault(); setSideTab(SIDE_TABS[next]); sideTabRefs.current[next]?.focus(); }
          }}>{name}</button>)}
        </div>
        <div className="comparison-panel-content" id="comparison-side-panel" role="tabpanel" aria-labelledby={'comparison-tab-' + SIDE_TABS.indexOf(sideTab)}>
        {sideTab === 'Controls' && <div className="comparison-playback" aria-label="Sequence playback">
        <h2>Playback</h2>
        {checked && <p className="comparison-checked-note">Epsilon Indi B · checked time example. Press Analyse images, then Play. Look for a small shift near the cyan cross while nearby stars stay aligned. This is an illustration, not a precision motion measurement.</p>}
        <div className="comparison-transport"><button aria-label="Previous frame" title="Previous frame" disabled={!data} onClick={() => step(-1)}><ArrowLeft size={17} /></button><button className="comparison-play" disabled={!canPlay} onClick={() => { setMode('blink'); setPlaying(value => !value); }}>{playing && canPlay ? <Pause size={17} /> : <Play size={17} />}<span>{playing && canPlay ? 'Pause' : 'Play'}</span></button><button aria-label="Next frame" title="Next frame" disabled={!data} onClick={() => step(1)}><ArrowRight size={17} /></button></div>
        <span className="comparison-playback-note">{data ? actualMode === 'grid' ? 'Grid · linked pan & zoom' : `Frame ${frame + 1} of ${data.frames.length}` : 'Choose images to compare'}</span>
        <label>Frame interval<input aria-label="Frame interval" type="range" min={250} max={2000} step={50} value={speed} onChange={event => setSpeed(Number(event.target.value))} /><output>{(speed / 1000).toFixed(2)} s/frame</output></label>
        <div className="comparison-view-tools" role="group" aria-label="Image controls">
          <button disabled={!data} aria-label="Fit all images to view" onClick={() => updateTransform(FIT)}><Maximize2 size={15} /><span>Fit images</span></button>
          <button disabled={!data} aria-pressed={marking} onClick={() => { setPlaying(false); setMarking(value => !value); }}><Crosshair size={15} /><span>Mark area</span></button>
        </div>
        <details className="comparison-settings"><summary><SlidersHorizontal size={13} /> Display settings<span>{Math.min(15, size * 6.2 / 60).toFixed(1)}′</span></summary>
          <fieldset><legend>Field of view</legend><div className="comparison-sizes">{[16, 50, 100, 200].map(value => <label key={value}><input type="radio" name="comparison-size" checked={size === value} onChange={() => { setPlaying(false); setSize(value); }} /><span>{Math.min(15, value * 6.2 / 60).toFixed(1)}′</span></label>)}</div><p className="comparison-hint">About {Math.min(15, size * 6.2 / 60).toFixed(1)}′ across</p></fieldset>
          <label className="comparison-inline-label">Stretch<select value={stretch} onChange={event => { setPlaying(false); setStretch(event.target.value); }}><option value="zscale">ZScale</option><option value="linear">Linear</option><option value="log">Log</option></select></label>
          <label className="comparison-contrast">Contrast <input type="range" min={.5} max={3} step={.1} value={contrast} onChange={event => setContrast(Number(event.target.value))} /><output>{contrast.toFixed(1)}×</output></label>
          <label className="comparison-checkbox"><input type="checkbox" checked={invert} onChange={event => setInvert(event.target.checked)} />Invert grayscale</label>
          <button className="comparison-text-action" onClick={() => { setSize(50); setStretch('zscale'); setContrast(1); setInvert(false); }}>Reset display</button>
        </details>
        <p className="comparison-hint">{marking ? 'Click to mark · Enter and arrow keys also work' : 'Drag to pan · scroll or + / − to zoom'}</p>
        </div>}
        {sideTab === 'Quality' && (data ? <>
          <div className={'comparison-status' + (!data.blink_ready ? ' is-warning' : '')} role="status">{data.message}</div>
          {!!data.frame_quality?.length && <section className="comparison-quality" aria-label="Image quality">
            {data.target_pixel && <p>Cyan cross: requested coordinates, not a detected source.</p>}
            <h2>{(data.coverage_mask.filter(Boolean).length / (data.width * data.height) * 100).toFixed(1)}% shared usable sky</h2>
            <ul>{data.frame_quality.map((check, index) => <li key={check.epoch_index} className={check.usable_fraction < .5 ? 'is-warning' : ''}>
              <span>Image {index + 1} · {(check.usable_fraction * 100).toFixed(1)}% usable on this field · {check.requested_position_usable ? 'requested position usable' : 'requested position masked'}</span>
              {!check.requested_position_usable && !!check.native_target_flag_names?.length && <small>Native position flags: {check.native_target_flag_names.join(', ')}</small>}
              {general && <button className="comparison-text-action" onClick={() => { chooseImages(selectedIds.filter(id => !matchesObservation(data.frames[index].epoch, id))); setPanelOpen(true); setLeftTab('Images'); }}>Choose replacement for image {index + 1}</button>}
            </li>)}</ul>
            {!data.requested_position_usable && <p>The requested position is masked in one or more images. A moving source may lie elsewhere; inspect its expected track and nearby reference stars before identifying it.</p>}
          </section>}
        </> : <p className="comparison-hint">Prepare images to inspect coverage and quality.</p>)}
        {sideTab === 'Details' && <>
        <section className="comparison-detail-content">{data && <><h2>Image checks & details</h2><dl><dt>Alignment</dt><dd>Full WCS + SIP · frame 1 grid</dd><dt>Target wavelengths</dt><dd>{data.wavelength_match ? 'Target passbands match' : 'Different passbands; exploratory playback only'}</dd><dt>Usable for blink</dt><dd>{(data.valid_fraction * 100).toFixed(1)}%</dd><dt>Time span</dt><dd>{timeGap(data.baseline_days)}</dd></dl><p>{data.wavelength_method}</p><p>{data.provenance}</p>{data.frames.map((value, index) => <p key={index}>Frame {index + 1}: {utc(value.epoch.utc_date)} · {value.epoch.detector} · {value.epoch.obs_id}</p>)}<p>Playback uses equal frame intervals; observation dates can be unevenly spaced. Shared contrast is for visual inspection, not photometry.</p></>}</section>
        {markError && <p className="comparison-warning" role="alert">{markError}</p>}
        {point && data && <section className="comparison-marked" aria-label="Marked area across images"><div><h2>Marked area</h2><p>Grid pixel {point.x}, {point.y}. A mark is not a confirmed moving object.</p><button className="comparison-text-action" onClick={() => { setMark(null); setMarkError(''); }}>Clear mark</button></div><div className="comparison-patches">{data.frames.map((value, index) => <figure key={index}><ComparisonPatch data={data} frame={index} point={point} invert={invert} contrast={contrast} /><figcaption>{dateLabel(value.epoch.utc_date)}<br />{value.epoch.utc_date.slice(11, 19)} UTC</figcaption></figure>)}</div></section>}
          {!data && <p className="comparison-hint">Image details appear after analysis.</p>}
        </>}
        </div>
      </aside>
    </div>
  </section>;
}
