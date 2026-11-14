import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bookmark, Download, Loader2, PanelRightClose, PanelRightOpen, Pause, Play } from 'lucide-react';
import { NavigationTab, DETECTOR_COLORS } from '../tokens/colors';
import { ResolvedTarget, fetchObservations, ObservationsResponse, SPHERExObservation, fetchCutout, projectCatalogPosition } from '../services/api';
import { FitsCanvas } from '../components/FitsCanvas';
import { RegionInspector } from '../components/RegionInspector';
import { ObservationTimeline } from '../components/ObservationTimeline';
import type { DateTimeRange } from '../components/DateTimeRangeFilter';
import { isTargetSaved, toggleSaveTarget, exportCutoutJson } from '../utils/collections';
import { createFrameLoader, displayedFrame, FrameRequest, FrameState, frameRequestKey } from '../utils/observationFrames';
import { matchesObservation } from '../utils/navigation';
import { useRetainedState } from '../utils/AnalysisContext';
import { catalogSelection, type ImageSelection } from '../utils/imageSelection';
import './observations.css';

interface ObservationsViewProps {
  target: ResolvedTarget;
  onNavigate: (tab: NavigationTab) => void;
  onTargetResolved?: (target: ResolvedTarget) => void;
  initialDetector?: string;
  onDetectorChange?: (det: string) => void;
}
const DEFAULT_RANGE: DateTimeRange = { fromDate: null, fromTime: '00:00', toDate: null, toTime: '23:59' };
const PANELS = ['Details', 'Provenance', 'Region'] as const;
type Panel = typeof PANELS[number];
const observationId = (observation: SPHERExObservation) => JSON.stringify([observation.obs_id, observation.detector, observation.access_url]);
const utcLabel = (value: string) => value.replace('T', ' ').replace(/Z$/, '') + ' UTC';

export function ObservationsView({ target, onNavigate, initialDetector, onDetectorChange }: ObservationsViewProps) {
  const targetKey = JSON.stringify([target.coordinates.ra_deg, target.coordinates.dec_deg]);
  const [catalog, setCatalog] = useState<{ key: string; response: ObservationsResponse } | null>(null);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [reference, setReference] = useRetainedState('shared', targetKey, 'observation', { id: '', detector: '' });
  const [selectedDetector, setSelectedDetector] = useRetainedState('images', targetKey, 'detector', initialDetector || reference.detector || 'All');
  const [dates, setDates] = useRetainedState('images', targetKey, 'dates', { key: targetKey, range: DEFAULT_RANGE });
  const [selection, setSelection] = useRetainedState('images', targetKey, 'selection', { key: targetKey, id: reference.id });
  const [stretch, setStretch] = useRetainedState('images', targetKey, 'stretch', 'zscale');
  const [size, setSize] = useRetainedState('images', targetKey, 'size', 200);
  const [frameState, setFrameState] = useState<FrameState | null>(null);
  const [retry, setRetry] = useState(0);
  const [inspection, setInspection] = useState<{ key: string; position: ImageSelection } | null>(null);
  const [playbackContext, setPlaybackContext] = useState<string | null>(null);
  const [loader] = useState(() => createFrameLoader(fetchCutout));
  const [panel, setPanel] = useRetainedState<Panel>('images', targetKey, 'panel', 'Details');
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [panelOpen, setPanelOpen] = useRetainedState('images', targetKey, 'panelOpen', true);
  const [saved, setSaved] = useState(() => isTargetSaved(target));
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const informationRef = useRef<HTMLElement>(null);
  const data = catalog?.key === targetKey ? catalog.response : null;
  const loadingCatalog = data === null;
  const range = dates.key === targetKey ? dates.range : DEFAULT_RANGE;

  useEffect(() => { setSaved(isTargetSaved(target)); }, [target]);
  useEffect(() => { if (initialDetector) setSelectedDetector(initialDetector); }, [initialDetector, setSelectedDetector]);
  useEffect(() => { onDetectorChange?.(selectedDetector); }, [selectedDetector, onDetectorChange]);

  useEffect(() => {
    let cancelled = false;
    setCatalog(null);
    fetchObservations(target.coordinates.ra_deg, target.coordinates.dec_deg).then(response => {
      if (!cancelled) setCatalog({ key: targetKey, response });
    }).catch(error => {
      if (!cancelled) setCatalog({ key: targetKey, response: {
        ra_deg: target.coordinates.ra_deg, dec_deg: target.coordinates.dec_deg,
        total_count: 0, distinct_dates: [], detectors_available: [], observations: [],
        provenance: 'NASA/IPAC IRSA TAP', status: 'error', message: error instanceof Error ? error.message : 'The observation archive could not be reached.',
      } });
    });
    return () => { cancelled = true; };
  }, [targetKey, target.coordinates.ra_deg, target.coordinates.dec_deg, catalogRetry]);

  const observations = useMemo(() => (data?.status === 'success' || data?.status === 'partial')
    ? [...data.observations].sort((a, b) => a.mjd_start - b.mjd_start) : [], [data]);
  const timeFiltered = useMemo(() => {
    if (!range.fromDate && !range.toDate && range.fromTime === '00:00' && range.toTime === '23:59') return observations;
    const from = (range.fromDate || data?.distinct_dates[0] || '1970-01-01') + ' ' + range.fromTime + ':00';
    const to = (range.toDate || data?.distinct_dates[data.distinct_dates.length - 1] || '2099-12-31') + ' ' + range.toTime + ':59.999';
    return observations.filter(observation => Date.parse(observation.utc_date) >= Date.parse(from.replace(' ', 'T') + 'Z') && Date.parse(observation.utc_date) <= Date.parse(to.replace(' ', 'T') + 'Z'));
  }, [observations, range, data]);
  const active = useMemo(() => selectedDetector === 'All' ? timeFiltered
    : timeFiltered.filter(observation => observation.detector === selectedDetector), [timeFiltered, selectedDetector]);
  const matchingSelection = selection.key === targetKey ? active.find(observation => matchesObservation(observation, selection.id)) : undefined;
  const selectionUnavailable = (data?.status === 'success' || data?.status === 'partial') && selection.key === targetKey && !!selection.id && !matchingSelection;
  const selected = selectionUnavailable ? null : matchingSelection || active[0] || null;
  useEffect(() => {
    if (!selected) return;
    setSelection({ key: targetKey, id: observationId(selected) });
    setReference({ id: selected.obs_id, detector: selected.detector });
  }, [selected, targetKey, setSelection, setReference]);
  const request = useMemo<FrameRequest | null>(() => selected ? {
    observation: selected, ra: target.coordinates.ra_deg, dec: target.coordinates.dec_deg, stretch, size,
  } : null, [selected, target.coordinates.ra_deg, target.coordinates.dec_deg, stretch, size]);
  const requestKey = request ? frameRequestKey(request) : null;
  const frame = displayedFrame(frameState, requestKey);
  const inspected = frame && inspection?.key === requestKey ? inspection.position : null;
  useEffect(() => { setInspection(null); }, [requestKey]);
  useEffect(() => {
    if (!inspected || !panelOpen || panel !== 'Region' || !window.matchMedia('(max-width: 699px)').matches) return;
    const timer = window.requestAnimationFrame(() => {
      const workspace = workspaceRef.current, information = informationRef.current;
      if (workspace && information) workspace.scrollTop += information.getBoundingClientRect().top - workspace.getBoundingClientRect().top;
    });
    return () => window.cancelAnimationFrame(timer);
  }, [inspected, panelOpen, panel]);
  const imageError = frameState?.key === requestKey && frameState.status === 'error' ? frameState.message : null;
  const loadingImage = !!request && !frame && !imageError;
  const displayedIndex = frame ? active.findIndex(observation => observationId(observation) === observationId(frame.observation)) : -1;
  const playbackKey = JSON.stringify([targetKey, active.map(observationId), stretch, size, catalogRetry]);
  const isPlaying = playbackContext === playbackKey && !imageError && !!selected && active.length > 1;
  useEffect(() => {
    if (playbackContext && !isPlaying) setPlaybackContext(null);
  }, [playbackContext, isPlaying]);
  useEffect(() => {
    // Give each successfully displayed exposure its full dwell time. No timer runs
    // while buffering, and no new image is requested after pause or unmount.
    if (!isPlaying || !frame || displayedIndex < 0) return;
    const next = active[(displayedIndex + 1) % active.length];
    const timer = window.setTimeout(() => setSelection({ key: targetKey, id: observationId(next) }), 1000);
    return () => window.clearTimeout(timer);
  }, [isPlaying, frame, displayedIndex, active, targetKey, setSelection]);
  const resetFilters = () => { setDates({ key: targetKey, range: DEFAULT_RANGE }); setSelectedDetector('All'); };

  useEffect(() => {
    if (request) void loader.select(request, setFrameState);
    return () => loader.cancel();
  }, [request, retry, loader]);

  function selectObservation(observation: SPHERExObservation) {
    setPlaybackContext(null);
    setSelection({ key: targetKey, id: observationId(observation) });
  }
  function step(delta: number) {
    if (!frame || displayedIndex < 0 || active.length < 2) return;
    selectObservation(active[(displayedIndex + delta + active.length) % active.length]);
  }
  function retryImage() {
    if (requestKey) loader.invalidate(requestKey);
    setFrameState(null);
    setRetry(value => value + 1);
  }
  function retryCatalog() {
    setCatalog(null);
    setCatalogRetry(value => value + 1);
  }
  const isFilteredEmpty = (data?.status === 'success' || data?.status === 'partial') && observations.length > 0 && active.length === 0;
  const playbackReason = 'Browse individual observations. Wavelengths and alignment may differ; brightness changes alone do not establish variability.';
  const emptyTitle = loadingCatalog ? 'Finding observations'
    : data?.status === 'error' ? 'Archive unavailable'
    : selectionUnavailable ? 'Selected observation unavailable' : isFilteredEmpty ? 'No observations match these filters' : 'No observations available';
  const emptyMessage = loadingCatalog ? 'Checking archive coverage for this sky position.'
    : data?.status === 'error' ? data.message || 'Try the archive request again.'
    : selectionUnavailable ? 'The retained observation is not in these archive results or filters. Choose an observation from the list or widen the filters.' : isFilteredEmpty ? 'Widen the date range or choose another detector.'
    : 'The archive returned no observations for this position. No reference image has been substituted.';

  return (
    <section className="images-root" aria-label="Images">
      <header className="images-heading">
        <div><h1>Images</h1><p role="status">{frame ? utcLabel(frame.observation.utc_date) : loadingImage ? 'Loading selected observation…' : 'No image displayed'}</p>{frame && <span className="images-current-detector"><i style={{ backgroundColor: DETECTOR_COLORS[frame.observation.detector] }} aria-hidden="true" />{frame.observation.detector}</span>}{frame && <span className="images-current-wavelength">{Number.isFinite(frame.cutout.wavelength_um) ? frame.cutout.wavelength_um!.toFixed(4) + ' µm at target' : 'Target wavelength unavailable'}</span>}</div>
        <button type="button" className="images-panel-toggle" aria-label={panelOpen ? 'Hide details' : 'Show details'} onClick={() => setPanelOpen(open => !open)} aria-expanded={panelOpen} aria-controls="image-information">{panelOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}<span>{panelOpen ? 'Hide details' : 'Show details'}</span></button>
      </header>
      <div ref={workspaceRef} className="images-workspace">
        <aside className="images-selection" aria-label="Filters and observations">
          <section className="images-filters" aria-labelledby="image-filters-heading">
            <div className="images-filter-heading"><h2 id="image-filters-heading">Filters</h2><button type="button" className="images-reset-filters" onClick={resetFilters}>Reset</button></div>
            <label htmlFor="image-detector">Detector</label>
            <select id="image-detector" value={selectedDetector} onChange={event => setSelectedDetector(event.target.value)}>
              <option value="All">All detectors</option>
              {['D1','D2','D3','D4','D5','D6'].map(detector => <option key={detector} value={detector}>{detector}</option>)}
            </select>
            <div className="images-date-inputs">{(['from', 'to'] as const).map(bound => {
              const date = range[bound === 'from' ? 'fromDate' : 'toDate'] || (bound === 'from' ? data?.distinct_dates[0] : data?.distinct_dates[data.distinct_dates.length - 1]);
              return <label key={bound}>
                <span>{bound === 'from' ? 'From' : 'To'} <small>UTC</small></span>
                <input type="datetime-local" aria-label={(bound === 'from' ? 'From' : 'To') + ' date and time (UTC)'}
                  value={date ? date + 'T' + range[bound === 'from' ? 'fromTime' : 'toTime'] : ''}
                  onChange={event => { const [nextDate, time] = event.target.value.split('T'); setDates({ key: targetKey, range: { ...range, [bound + 'Date']: nextDate || null, [bound + 'Time']: time || (bound === 'from' ? '00:00' : '23:59') } }); }} />
              </label>;
            })}</div>
          </section>
          <section className="images-observations" aria-labelledby="image-observations-heading">
            <div className="images-list-heading"><h2 id="image-observations-heading">Observations</h2><span>{active.length} / {observations.length}</span></div>
            <div className="images-observation-list" aria-label="Choose an observation">
              {active.map(observation => {
                const isSelected = selected && observationId(selected) === observationId(observation);
                const isDisplayed = frame && observationId(frame.observation) === observationId(observation);
                return <button type="button" key={observationId(observation)} aria-current={isSelected ? 'true' : undefined} onClick={() => selectObservation(observation)}>
                  <span>{observation.utc_date.split(/[ T]/)[0]}<small className="images-row-detector"><i style={{ backgroundColor: DETECTOR_COLORS[observation.detector] }} aria-hidden="true" />{observation.detector}</small></span>
                  <span>{observation.utc_date.split(/[ T]/)[1]?.slice(0, 8)} UTC<small>{isDisplayed ? 'Displayed' : isSelected ? loadingImage ? 'Loading' : 'Unavailable' : ''}</small></span>
                </button>;
              })}
              {active.length === 0 && <p className="images-panel-note">{loadingCatalog ? 'Checking archive coverage…' : 'No observations in this selection.'}</p>}
            </div>
          </section>
          {(data?.status === 'success' || data?.status === 'partial') && data.truncated && <p className="images-archive-limit">Archive results are limited. More observations may exist.</p>}
        </aside>
        <div className="images-stage">
          <div ref={setToolbarHost} className="images-toolbar-host" />
          <div className="images-viewer" aria-busy={loadingCatalog || loadingImage}>
            {!selected ? <div className="images-empty" role="status">
              {loadingCatalog && <Loader2 size={22} className="animate-spin" aria-hidden="true" />}
              <h2>{emptyTitle}</h2><p>{emptyMessage}</p>
              {data?.status === 'error' && <button type="button" onClick={retryCatalog}>Try again</button>}
              {isFilteredEmpty && <button type="button" onClick={resetFilters}>Reset filters</button>}
              {data?.status === 'no_coverage' && <button type="button" onClick={() => onNavigate('Home')}>Choose another position</button>}
            </div> : imageError ? <div className="images-empty" role="alert"><h2>Selected image unavailable</h2><p>{imageError}</p><button type="button" onClick={retryImage}>Retry image</button><p>Or choose another observation from the list.</p></div>
              : <FitsCanvas cutout={frame?.cutout || null} loading={loadingImage} isPlaying={isPlaying} selectedStretch={stretch} onStretchChange={setStretch} onRetry={retryImage} targetId={targetKey} targetName={target.canonical_name || target.query} targetRa={target.coordinates.ra_deg} targetDec={target.coordinates.dec_deg} accessUrl={frame?.observation.access_url} cutoutSize={size} onCutoutSizeChange={setSize} observationMode toolbarHost={toolbarHost} inspectedRegion={inspected} onInspectRegion={position => { setPlaybackContext(null); setPanelOpen(true); setPanel('Region'); if (requestKey) setInspection({ key: requestKey, position }); }} />}

          </div>
        </div>
        {panelOpen && <aside ref={informationRef} id="image-information" className="images-information" aria-label="Observation details">
          <div className="images-tabs" role="tablist" aria-label="Image information">
            {PANELS.map((name, index) => <button ref={element => { tabRefs.current[index] = element; }} id={'image-tab-' + index} key={name} type="button" role="tab" aria-selected={panel === name} aria-controls="image-panel" tabIndex={panel === name ? 0 : -1} onClick={() => setPanel(name)} onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? (index + 1) % PANELS.length : event.key === 'ArrowLeft' ? (index + PANELS.length - 1) % PANELS.length : event.key === 'Home' ? 0 : event.key === 'End' ? PANELS.length - 1 : null;
              if (next !== null) { event.preventDefault(); setPanel(PANELS[next]); tabRefs.current[next]?.focus(); }
            }}>{name}</button>)}
          </div>
          <div id="image-panel" role="tabpanel" aria-labelledby={'image-tab-' + PANELS.indexOf(panel)} className="images-panel-content">
            {panel === 'Details' && <>
              <h2>Sky position</h2>
              <dl><dt>Right ascension</dt><dd>{target.coordinates.ra_deg.toFixed(6)}°</dd><dt>Declination</dt><dd>{target.coordinates.dec_deg.toFixed(6)}°</dd><dt>Frame</dt><dd>{target.coordinates.frame}</dd></dl>
              {frame ? <><h2>Displayed image</h2><dl><dt>Detector</dt><dd><span className="images-current-detector"><i style={{ backgroundColor: DETECTOR_COLORS[frame.observation.detector] }} aria-hidden="true" />{frame.observation.detector}</span></dd><dt>Detector wavelength range</dt><dd>{frame.observation.wavelength_min_um}–{frame.observation.wavelength_max_um} µm</dd><dt>Wavelength at target</dt><dd>{frame.cutout.wavelength_um?.toFixed(4) ?? 'Unavailable'} µm (WCS-WAVE)</dd><dt>Exposure</dt><dd>{frame.observation.exptime_sec != null ? frame.observation.exptime_sec + ' s' : 'Not provided'}</dd><dt>Image dimensions</dt><dd>{frame.cutout.width} × {frame.cutout.height} px</dd><dt>Brightness unit</dt><dd>{frame.cutout.bunit}</dd></dl></> : <p className="images-panel-note">Image details appear only after the selected image loads.</p>}
              <div className="images-detail-actions">
                <button type="button" onClick={() => setSaved(toggleSaveTarget(target, undefined, frame?.observation.detector).saved)}><Bookmark size={14} aria-hidden="true" />{saved ? 'Saved target' : 'Save target'}</button>
                <button type="button" disabled={!frame} onClick={() => { if (frame) exportCutoutJson(target, frame.cutout, frame.observation); }}><Download size={14} aria-hidden="true" />Export JSON</button>
              </div>
            </>}
            {panel === 'Provenance' && <>
              <h2>Archive</h2><p>{data?.provenance || 'No archive result loaded.'}</p>
              <p className="images-panel-note">Archive results and images may be cached. The retrieved list is not a guarantee of all available observations.</p>
              {data?.truncated && <p className="images-panel-note">The query returns up to 100 exposures, ordered oldest first. Later observations may not be included.</p>}
              {frame ? <><h2>Displayed observation</h2><p className="images-observation-id">{frame.observation.obs_id}</p><p>{frame.cutout.source}</p>{frame.observation.access_url.startsWith('https://') && <a href={frame.observation.access_url} target="_blank" rel="noreferrer">Open archive image link ↗</a>}</> : <p className="images-panel-note">No image provenance is shown until an observation loads.</p>}
            </>}
            <div hidden={panel !== 'Region'}>
            {inspected && frame ? <RegionInspector key={JSON.stringify([requestKey, inspected.x, inspected.y, inspected.sourceId, inspected.ra, inspected.dec])} position={inspected} frame={frame} centerRa={target.coordinates.ra_deg} centerDec={target.coordinates.dec_deg} size={size} onSelectSource={async (source, signal) => {
              const pixel = await projectCatalogPosition(frame.cutout.wcs, source, signal);
              if (signal.aborted) return;
              const position = catalogSelection(frame.cutout, source, pixel);
              if (!position) throw new Error('This catalog position is outside the current image. No other position was selected.');
              setPlaybackContext(null); setPanelOpen(true); setPanel('Region');
              if (requestKey) setInspection({ key: requestKey, position });
            }} onClear={() => { setInspection(null); tabRefs.current[2]?.focus(); }} /> : <p className="images-panel-note" role="status">Select a region or source in the image.</p>}
            </div>
          </div>
        </aside>}
      </div>
      <footer className="images-playback">
        <div className="images-transport">
          <div className="images-step-controls">
            <button type="button" aria-label="Previous observation" disabled={!frame || active.length < 2} onClick={() => step(-1)}><ArrowLeft size={17} aria-hidden="true" /><span>Previous</span></button>
            <button type="button" aria-label={isPlaying ? 'Pause observations' : 'Play observations'} aria-pressed={isPlaying} disabled={!isPlaying && (!frame || active.length < 2)} title={active.length < 2 ? 'At least two available observations are needed.' : playbackReason} aria-describedby="images-playback-status" onClick={() => setPlaybackContext(isPlaying ? null : playbackKey)}>{isPlaying ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}<span>{isPlaying ? 'Pause' : 'Play'}</span></button>
            <button type="button" aria-label="Next observation" disabled={!frame || active.length < 2} onClick={() => step(1)}><span>Next</span><ArrowRight size={17} aria-hidden="true" /></button>
          </div>
          <span className="images-frame-count">{frame ? 'Frame ' + (displayedIndex + 1) + ' of ' + active.length : loadingImage ? isPlaying ? 'Buffering next observation…' : 'Loading image…' : 'No image displayed'}</span>
        </div>
        <ObservationTimeline observations={active} selected={selected} displayed={frame?.observation || null} onSelect={selectObservation} />
        <p id="images-playback-status">Individual observations. Wavelengths and alignment may differ; changes alone do not establish variability.</p>
      </footer>
    </section>
  );
}
