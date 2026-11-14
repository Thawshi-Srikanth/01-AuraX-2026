import { resolveTarget as checkedResolve } from './resolverClient';
export interface TargetCoordinates {
  ra_deg: number;
  dec_deg: number;
  ra_hms: string;
  dec_dms: string;
  frame: string;
  epoch: string;
}

export interface ProperMotion {
  pm_ra_mas_yr: number | null;
  pm_dec_mas_yr: number | null;
}

export interface ResolvedTarget {
  query: string;
  canonical_name: string;
  object_type: string;
  coordinates: TargetCoordinates;
  proper_motion: ProperMotion | null;
  aliases: string[];
  provenance: string;
}

export interface SPHERExObservation {
  artifact_id?: string;
  obs_id: string;
  detector: string;
  band_name: string;
  mjd_start: number;
  utc_date: string;
  date_only: string;
  wavelength_min_um: number;
  wavelength_max_um: number;
  wavelength_center_um: number | null;
  exptime_sec: number | null;
  access_url: string;
}

export interface ObservationsResponse {
  ra_deg: number;
  dec_deg: number;
  total_count: number;
  distinct_dates: string[];
  detectors_available: string[];
  observations: SPHERExObservation[];
  provenance: string;
  status: 'success' | 'partial' | 'no_coverage' | 'error';
  truncated?: boolean;
  message: string | null;
}

export interface WcsMetadata {
  crval1: number | null;
  crval2: number | null;
  crpix1: number | null;
  crpix2: number | null;
  cdelt1: number | null;
  cdelt2: number | null;
  cunit1: string | null;
  cunit2: string | null;
  north_angle_deg?: number | null;
  has_valid_wcs?: boolean;
  ra_grid?: number[];
  dec_grid?: number[];
  spatial_wcs_header?: string;
}

export interface CutoutResponse {
  width: int;
  height: int;
  pixels: number[];
  raw_flux?: number[];
  valid_pixels?: boolean[];
  display_valid_pixels?: boolean[];
  display_warning_pixel_count?: number;
  wavelength_um?: number;
  channel_width_um?: number;
  bunit?: string;
  min_flux_mjy_sr: number;
  max_flux_mjy_sr: number;
  mean_flux_mjy_sr: number;
  stretch_applied: string;
  wcs: WcsMetadata;
  source: string;
  status: 'success' | 'sample_fallback' | 'error';
  message: string | null;
  file_size_bytes?: number | null;
}

type int = number;

// API Base URL configured via environment variable (empty string for same-origin reverse-proxy in production)
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/backend').replace(/\/+$/, '');

function normalizeRa(ra: number): number {
  if (!Number.isFinite(ra) || ra < 0 || ra >= 360) throw new Error('Right ascension must be between 0 and 360 degrees.');
  return ra;
}
// Nominal SPHEREx sampling is 6.2 arcsec/pixel; the service returns its actual dimensions.
export const angularSize = (pixels = 200, maximum = .5) => Math.min(maximum, pixels * 6.2 / 3600);
async function readResponse(response: Response, label: string) {
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `${label} (${response.status})`);
  return data;
}

function legacyTarget(result: Awaited<ReturnType<typeof checkedResolve>>): ResolvedTarget {
  return {
    query: result.query ?? result.canonical_name, canonical_name: result.canonical_name, object_type: result.object_type,
    coordinates: { ...result.coordinates, ra_hms: result.coordinates.ra_hms ?? '', dec_dms: result.coordinates.dec_dms ?? '', epoch: result.coordinates.epoch ?? 'Not specified' },
    proper_motion: result.proper_motion ?? null, aliases: result.aliases ?? [], provenance: result.provenance,
  };
}
export async function resolveTarget(target: string): Promise<ResolvedTarget> {
  return legacyTarget(await checkedResolve({ kind: 'name', name: target }));
}
export async function resolveCoordinates(ra: number, dec: number): Promise<ResolvedTarget> {
  return legacyTarget(await checkedResolve({ kind: 'coordinates', ra: String(ra), dec: String(dec) }));
}

export async function fetchObservations(
  ra: number,
  dec: number,
  limit: number = 100
): Promise<ObservationsResponse> {
  const normRa = normalizeRa(ra);
  const url = `${API_BASE_URL}/api/observations?ra=${normRa}&dec=${dec}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to query SPHEREx TAP archive: ${response.statusText}`);
  }
  const data = await response.json();
  if (!Array.isArray(data.observations)) throw new Error('The archive returned an invalid observation list.');
  return data;
}

export async function fetchCutout(
  accessUrl?: string,
  stretch: string = 'zscale',
  ra?: number,
  dec?: number,
  size?: number,
  signal?: AbortSignal
): Promise<CutoutResponse> {
  const params = new URLSearchParams();
  if (accessUrl) params.append('access_url', accessUrl);
  if (stretch) params.append('stretch', stretch);
  if (ra !== undefined && ra !== null) params.append('ra', normalizeRa(ra).toString());
  if (dec !== undefined && dec !== null) params.append('dec', dec.toString());
  if (size !== undefined && size !== null) params.append('size_deg', angularSize(size).toString());

  const url = `${API_BASE_URL}/api/cutout?${params.toString()}`;
  const response = await fetch(url, { signal });
  const data = await readResponse(response, 'Image unavailable');
  if (data.status !== 'success') throw new Error(data.message || 'No usable image pixels.');
  const count = data.width * data.height;
  if (![data.pixels, data.raw_flux, data.valid_pixels].every(a => Array.isArray(a) && a.length === count)) throw new Error('Incomplete image arrays.');
  return {
    ...data,
    pixels: data.pixels.map((v: number | null, i: number) => (data.display_valid_pixels ?? data.valid_pixels)[i] && v !== null ? v : NaN),
    raw_flux: data.raw_flux.map((v: number | null) => v ?? NaN),
    wcs: { crval1: null, crval2: null, crpix1: null, crpix2: null, cdelt1: null, cdelt2: null,
      cunit1: 'deg', cunit2: 'deg', ...data.wcs, spatial_wcs_header: data.spatial_wcs_header },
    source: data.source_url,
  };
}

export interface EpochMetadata {
  obs_id: string;
  utc_date: string;
  detector: string;
  wavelength_center_um: number;
  access_url?: string | null;
}

export interface MotionMetrics {
  delta_ra_arcsec: number;
  delta_dec_arcsec: number;
  total_separation_arcsec: number;
  position_angle_deg: number;
  baseline_days: number;
  proper_motion_mas_yr: number | null;
}

export interface CompareRequest {
  epoch_a: EpochMetadata;
  epoch_b: EpochMetadata;
  ra_deg?: number;
  dec_deg?: number;
  stretch?: string;
  size_px?: number;
}

export interface CompareResponse {
  status: 'success' | 'incompatible_wavelength' | 'error';
  message: string | null;
  epoch_a: EpochMetadata;
  epoch_b: EpochMetadata;
  wavelength_match: boolean;
  wavelength_diff_percent: number;
  width: number;
  height: number;
  pixels_a: number[];
  pixels_b: number[];
  pixels_diff: number[];
  metrics: MotionMetrics | null;
  wcs: WcsMetadata | null;
  provenance: string;
  registered: boolean;
  blink_ready: boolean;
  valid_mask: boolean[];
  coverage_mask: boolean[];
  valid_fraction: number;
  baseline_days: number | null;
  wavelength_a_um: number | null;
  wavelength_b_um: number | null;
  bandwidth_a_um: number | null;
  bandwidth_b_um: number | null;
  registration_method: string | null;
  wavelength_method: string | null;
}

export async function compareObservations(req: CompareRequest, signal?: AbortSignal): Promise<CompareResponse> {
  if (req.ra_deg === undefined || req.dec_deg === undefined) throw new Error('Target coordinates are required.');
  const sequence = await compareSequence({ epochs: [req.epoch_a, req.epoch_b], ra_deg: req.ra_deg, dec_deg: req.dec_deg,
    size_px: req.size_px ?? 200, stretch: req.stretch ?? 'zscale' }, signal);
  return { ...sequence, epoch_a: sequence.frames[0].epoch, epoch_b: sequence.frames[1].epoch,
    pixels_a: sequence.frames[0].pixels, pixels_b: sequence.frames[1].pixels, pixels_diff: [], metrics: null, wcs: null,
    wavelength_diff_percent: Math.abs(sequence.frames[0].wavelength_um - sequence.frames[1].wavelength_um) / sequence.frames[0].wavelength_um * 100,
    wavelength_a_um: sequence.frames[0].wavelength_um, wavelength_b_um: sequence.frames[1].wavelength_um,
    bandwidth_a_um: sequence.frames[0].bandwidth_um, bandwidth_b_um: sequence.frames[1].bandwidth_um };

}

export interface MatchObservation extends SPHERExObservation {
  wavelength_center_um: number;
  local_wavelength_um: number;
  local_bandwidth_um: number;
}
export interface MatchGroup {
  id: string;
  detector: string;
  wavelength_um: number;
  observations: MatchObservation[];
  recommended_ids: string[];
  baseline_days: number;
}
export interface MatchResponse {
  status: 'success' | 'partial' | 'error' | 'busy';
  message: string;
  groups: MatchGroup[];
  candidates: number;
  checked: number;
  failed: number;
  pending: number;
  metadata_complete: boolean;
  complete: boolean;
  can_continue: boolean;
  auto_continue: boolean;
  limited: boolean;
  provenance: string;
}
export interface MatchRequest {
  ra_deg: number;
  dec_deg: number;
  from_date?: string;
  to_date?: string;
  size_px: number;
  advance?: boolean;
  retry_failed?: boolean;
}
export async function findComparisonMatches(req: MatchRequest, signal?: AbortSignal): Promise<MatchResponse> {
  const body = { ra: normalizeRa(req.ra_deg), dec: req.dec_deg, from_date: req.from_date || undefined,
    to_date: req.to_date || undefined, candidate_limit: 24, advance: !!req.advance || !!req.retry_failed, retry_failed: !!req.retry_failed };
  const started = await readResponse(await fetch(`${API_BASE_URL}/api/compare/matches/jobs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  }), 'Matching search unavailable');
  const jobUrl = `${API_BASE_URL}/api/compare/matches/jobs/${encodeURIComponent(started.job_id)}`;
  let complete = false;
  try {
    for (let attempt = 0; attempt < 300; attempt++) {
      signal?.throwIfAborted();
      const job = await readResponse(await fetch(jobUrl, { signal }), 'Matching search unavailable');
      if (job.status === 'completed') { complete = true; return adaptMatches(job.result); }
      if (['failed', 'cancelled', 'expired'].includes(job.status)) throw new Error(job.error === 'archive_unavailable' ? 'The archive is unavailable. Try again or narrow the date range.' : job.error === 'invalid_metadata' ? 'The archive returned unusable observation metadata.' : `Matching search ${job.status}. Please retry.`);
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal?.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 500);
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
    throw new Error('Matching search timed out. Try a smaller date range.');
  } finally {
    if (!complete) void fetch(`${jobUrl}/cancel`, { method: 'POST' }).catch(() => {});
  }
}

export interface SequenceRequest {
  epochs: EpochMetadata[];
  ra_deg: number;
  dec_deg: number;
  size_px: number;
  stretch: string;
}

export interface SequenceResponse {
  status: 'success' | 'incompatible_wavelength' | 'error';
  message: string;
  frames: { epoch: EpochMetadata; pixels: number[]; wavelength_um: number; bandwidth_um: number }[];
  width: number;
  height: number;
  registered: boolean;
  blink_ready: boolean;
  wavelength_match: boolean;
  valid_mask: boolean[];
  coverage_mask: boolean[];
  valid_fraction: number;
  baseline_days: number;
  registration_method: string;
  wavelength_method: string;
  provenance: string;
}

export async function compareSequence(req: SequenceRequest, signal?: AbortSignal): Promise<SequenceResponse> {
  const epochs = [...req.epochs].sort((a, b) => Date.parse(a.utc_date) - Date.parse(b.utc_date));
  const response = await fetch(`${API_BASE_URL}/api/compare/sequence`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_urls: epochs.map(e => e.access_url), ra: normalizeRa(req.ra_deg), dec: req.dec_deg,
      size_deg: angularSize(req.size_px, .25), stretch: req.stretch }), signal,
  });
  const data = await readResponse(response, 'Comparison preparation failed');
  if (data.status !== 'ready' || !data.blink_ready) throw new Error(data.message || 'These observations cannot be blinked safely.');
  if (data.frames.length !== epochs.length) throw new Error('Incomplete registered sequence.');
  return { ...data, status: 'success', wavelength_match: data.target_wavelength_match,
    valid_fraction: data.matched_fraction, provenance: 'NASA/IPAC IRSA; full SIP WCS registration',
    frames: data.frames.map((frame: { epoch_index: number; pixels: (number | null)[] }, i: number) => {
      const e: ArchiveEpoch = data.epochs[frame.epoch_index];
      if (frame.epoch_index !== i || e.access_url !== epochs[i].access_url || e.obs_id !== epochs[i].obs_id || e.detector !== epochs[i].detector) throw new Error('Returned image does not match the selected observation.');
      return { epoch: { ...epochs[i], utc_date: e.utc_date }, pixels: frame.pixels.map((p, k) => {
        if (p === null && data.valid_mask[k]) throw new Error('Missing usable comparison pixel.');
        return p ?? 0; // Display filler is excluded by the explicit valid mask.
      }), wavelength_um: e.target_wavelength_um, bandwidth_um: e.target_bandwidth_um };
    }) };

}

export interface SpectralFeature {
  name: str;
  wavelength_um: number;
  feature_type: 'absorption' | 'emission';
  description: string;
}

type str = string;

export interface SpectralPoint {
  source_url?: string;
  artifact_id?: string;
  obs_id?: string;
  utc_date?: string;
  channel_index: number;
  detector: string;
  wavelength_um: number;
  bandwidth_um: number;
  resolving_power: number;
  flux_mjy_sr: number;
  flux_error_mjy_sr: number;
  snr: number;
}

export interface DetectorBandInfo {
  detector: string;
  label: string;
  wavelength_min_um: number;
  wavelength_max_um: number;
  resolving_power_nominal: number;
  channel_count: number;
  primary_science: string;
}

export interface SpectrumResponse {
  message?: string;
  target_name: string;
  ra_deg: number;
  dec_deg: number;
  total_channels: number;
  spectral_points: SpectralPoint[];
  spectral_features: SpectralFeature[];
  detector_bands: DetectorBandInfo[];
  mean_flux_mjy_sr: number;
  peak_flux_mjy_sr: number;
  status: string;
  provenance: string;
}

export async function fetchTargetSpectrum(
  targetName: string,
  ra?: number,
  dec?: number,
  signal?: AbortSignal
): Promise<SpectrumResponse> {
  const params = new URLSearchParams({ target_name: targetName });
  if (ra !== undefined) params.append('ra', normalizeRa(ra).toString());
  if (dec !== undefined) params.append('dec', dec.toString());

  const url = `${API_BASE_URL}/api/spectrum?${params.toString()}`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to extract spectral profile: ${response.statusText}`);
  }
  const data = await readResponse(response, 'Spectral samples unavailable');
  if (!Array.isArray(data.spectral_points)) throw new Error('Invalid spectral samples.');
  if (!data.spectral_points.length) throw new Error(data.message || 'No usable spectral samples for this position.');
  const points = [...data.spectral_points].sort((a, b) => a.wavelength_um - b.wavelength_um)
    .map((p, channel_index) => ({ ...p, channel_index, snr: p.snr ?? NaN }));
  const detectors: string[] = [...new Set<string>(points.map(p => p.detector))];
  return { ...data, target_name: targetName, ra_deg: data.ra_deg ?? ra, dec_deg: data.dec_deg ?? dec,
    spectral_points: points, total_channels: points.length, spectral_features: [],
    detector_bands: detectors.map(detector => {
      const samples = points.filter(p => p.detector === detector);
      return { detector, label: detector, wavelength_min_um: Math.min(...samples.map(p => p.wavelength_um - p.bandwidth_um / 2)),
        wavelength_max_um: Math.max(...samples.map(p => p.wavelength_um + p.bandwidth_um / 2)),
        resolving_power_nominal: samples.reduce((n, p) => n + p.resolving_power, 0) / samples.length,
        channel_count: samples.length, primary_science: 'Measured nearest-pixel samples; not a continuous spectrum' };
    }), mean_flux_mjy_sr: points.reduce((n, p) => n + p.flux_mjy_sr, 0) / points.length,
    peak_flux_mjy_sr: Math.max(...points.map(p => p.flux_mjy_sr)),
  };
}

export interface CatalogSource {
  id: string;
  name: string;
  object_type: string;
  ra_deg: number;
  dec_deg: number;
  pixel_x: number;
  pixel_y: number;
  distance_arcsec: number;
  mag_v: number | null;
  mag_g: number | null;
  mag_k: number | null;
  brightness_rank: number;
}

export interface CatalogSourcesResponse {
  target_ra: number;
  target_dec: number;
  radius_arcmin: number;
  sources_count: number;
  sources: CatalogSource[];
  provenance: string;
  status: 'success' | 'no_sources' | 'error';
  message: string | null;
}

export async function fetchCatalogSources(
  ra: number,
  dec: number,
  radiusArcmin: number = 11.0,
  width: number = 200,
  height: number = 200,
  targetName?: string,
  accessUrl?: string,
  wcs?: WcsMetadata
): Promise<CatalogSourcesResponse> {
  // Images use the full SIP header returned with their exact cutout, not approximate CDELT math.
  void width; void height; void targetName; void accessUrl;
  const params = new URLSearchParams({ ra: String(normalizeRa(ra)), dec: String(dec), radius_arcmin: String(radiusArcmin), limit: '200' });
  const data = await readResponse(await fetch(`${API_BASE_URL}/api/catalog/sources?${params}`), 'Catalog unavailable');
  if (!wcs?.spatial_wcs_header) throw new Error('This image has no full WCS for catalog projection.');
  const projection = await readResponse(await fetch(`${API_BASE_URL}/api/catalog/project`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spatial_wcs_header: wcs.spatial_wcs_header,
      positions: data.sources.map((s: CatalogSource) => ({ ra: s.ra_deg, dec: s.dec_deg })) }),
  }), 'Catalog projection unavailable');
  return { ...data, status: data.status === 'partial' ? 'success' : data.status,
    sources: data.sources.flatMap((s: CatalogSource, i: number) => projection.pixels[i] ? [{ ...s,
      pixel_x: projection.pixels[i][0], pixel_y: projection.pixels[i][1],
      mag_v: null, mag_g: null, mag_k: null, brightness_rank: 0 }] : []) };

}

interface ArchiveEpoch { obs_id: string; detector: string; utc_date: string; mjd_start: number; access_url: string; target_wavelength_um: number; target_bandwidth_um: number }
interface ArchiveMatches {
  status: string; message: string; candidate_count: number; checked_count: number; failed_count: number; pending_count: number;
  metadata_truncated: boolean; metadata_rejected_count: number; pairs_truncated: boolean; search_complete: boolean; can_continue: boolean;
  checks: { artifact_id: string; status: string; epoch: ArchiveEpoch | null }[];
  pairs: { artifact_id_a: string; artifact_id_b: string; detector: string; baseline_days: number }[];
}
export function adaptMatches(data: ArchiveMatches): MatchResponse {
  const verified = new Map(data.checks.filter(c => c.status === 'verified' && c.epoch).map(c => [c.artifact_id, c.epoch!]));
  const edge = (a: string, b: string) => data.pairs.some(p => (p.artifact_id_a === a && p.artifact_id_b === b) || (p.artifact_id_b === a && p.artifact_id_a === b));
  const seen = new Set<string>();
  const groups: MatchGroup[] = data.pairs.flatMap(pair => {
    const ids = [pair.artifact_id_a, pair.artifact_id_b];
    // Every pair must be explicitly verified; transitive wavelength chains are unsafe.
    for (const [id, e] of verified) {
      if (ids.length >= 4) break;
      if (!ids.includes(id) && e.detector === pair.detector && ids.every(other => edge(id, other))) ids.push(id);
    }
    const identity = [...ids].sort().join('|');
    if (seen.has(identity)) return [];
    seen.add(identity);
    const epochs = ids.map(id => verified.get(id));
    if (epochs.some(e => !e)) throw new Error('Missing verified matching epochs.');
    const observations: MatchObservation[] = epochs.map(value => {
      const e = value!;
      return { ...e, date_only: e.utc_date.slice(0, 10), band_name: e.detector,
        wavelength_min_um: e.target_wavelength_um - e.target_bandwidth_um / 2,
        wavelength_max_um: e.target_wavelength_um + e.target_bandwidth_um / 2,
        wavelength_center_um: e.target_wavelength_um, local_wavelength_um: e.target_wavelength_um,
        local_bandwidth_um: e.target_bandwidth_um, exptime_sec: null };
    }).sort((a, b) => a.mjd_start - b.mjd_start);
    // URL-safe stable identity from the actual pair, never from the array index.
    let h = 2166136261, j = 5381;
    for (const c of identity) { h = Math.imul(h ^ c.charCodeAt(0), 16777619); j = Math.imul(j, 33) ^ c.charCodeAt(0); }
    const id = `${pair.detector}-${(h >>> 0).toString(16).padStart(8, '0')}${(j >>> 0).toString(16).padStart(8, '0')}`;
    return [{ id, detector: pair.detector, wavelength_um: observations[0].local_wavelength_um,
      observations, recommended_ids: observations.map(o => o.obs_id), baseline_days: observations[observations.length - 1].mjd_start - observations[0].mjd_start }];
  }).slice(0, 24);
  const limited = data.metadata_truncated || data.metadata_rejected_count > 0 || data.pairs_truncated || data.pairs.length > 24;
  return { status: data.status === 'partial' ? 'partial' : 'success', message: data.message, groups,
    candidates: data.candidate_count, checked: data.checked_count,
    failed: data.failed_count, pending: data.pending_count, metadata_complete: !data.metadata_truncated && !data.metadata_rejected_count,
    complete: data.search_complete && !limited && !data.failed_count && !data.pending_count,
    can_continue: data.can_continue || data.failed_count > 0, auto_continue: data.can_continue && data.status !== 'partial', limited,
    provenance: 'NASA/IPAC IRSA; target-position wavelength checks only' };
}


export interface RegionAnalysis {
  status: 'success' | 'partial' | 'insufficient_data'; summary: string;
  ra_deg: number; dec_deg: number; pixel_x: number; pixel_y: number;
  radius_px: number; background_inner_px: number; background_outer_px: number;
  usable_pixels: number; masked_pixels: number; aperture_coverage: number;
  background_coverage: number; background_clipped_pixels: number; wavelength_rejected_pixels: number;
  wavelength_um: number; bandwidth_um: number; source_url: string;
  method: string; uncertainty: string; caveats: string[];
  measurements: { mean_brightness_mjy_sr: number; background_mjy_sr: number;
    excess_mjy_sr: number; excess_error_mjy_sr: number; usable_aperture_flux_mjy: number;
    flux_error_mjy: number; snr: number | null; solid_angle_sr: number } | null;
}
export interface RegionCatalogRecord { id: string; name: string; object_type: string; object_type_label: string | null; ra_deg: number; dec_deg: number; distance_arcsec: number; coordinate_reference: string | null }
export interface RegionCatalog { sources: RegionCatalogRecord[]; truncated: boolean; provenance: string; source_url: string; retrieved_at: string; caveat: string; coordinate_epoch: string | null }
export async function fetchRegionAnalysis(accessUrl: string, centerRa: number, centerDec: number, size: number, ra: number, dec: number, signal: AbortSignal): Promise<RegionAnalysis> {
  return readResponse(await fetch(`${API_BASE_URL}/api/region`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_url: accessUrl, center_ra: centerRa, center_dec: centerDec, size_deg: angularSize(size), ra, dec }),
  }), 'Region measurement unavailable');
}
export async function fetchRegionCatalog(ra: number, dec: number, signal: AbortSignal): Promise<RegionCatalog> {
  const params = new URLSearchParams({ ra: String(normalizeRa(ra)), dec: String(dec), radius_arcmin: '1', limit: '20' });
  return readResponse(await fetch(`${API_BASE_URL}/api/catalog/sources?${params}`, { signal }), 'Catalog context unavailable');
}


export async function projectCatalogPosition(wcs: WcsMetadata, source: Pick<RegionCatalogRecord, 'ra_deg' | 'dec_deg'>, signal: AbortSignal): Promise<number[] | null> {
  if (!wcs.spatial_wcs_header) throw new Error('This image has no full WCS for source selection.');
  const data = await readResponse(await fetch(`${API_BASE_URL}/api/catalog/project`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spatial_wcs_header: wcs.spatial_wcs_header, positions: [{ ra: source.ra_deg, dec: source.dec_deg }] }),
  }), 'Source projection unavailable');
  if (!Array.isArray(data.pixels) || data.pixels.length !== 1) throw new Error('Invalid source projection.');
  return data.pixels[0];
}
