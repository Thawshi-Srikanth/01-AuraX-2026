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
  obs_id: string;
  detector: string;
  band_name: string;
  mjd_start: number;
  utc_date: string;
  date_only: string;
  wavelength_min_um: number;
  wavelength_max_um: number;
  wavelength_center_um: number;
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
  status: 'success' | 'no_coverage' | 'error';
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
}

export interface CutoutResponse {
  width: int;
  height: int;
  pixels: number[];
  raw_flux?: number[];
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

function normalizeRa(ra: number): number { return ((ra % 360) + 360) % 360; }

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
  if (!(Array.isArray(data.observations) && data.observations.every((item: { wavelength_center_um?: unknown }) => typeof item.wavelength_center_um === 'number'))) throw new Error('This view uses a different data format. Its backend connection is still being migrated.');
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
  if (size !== undefined && size !== null) params.append('size', size.toString());

  const url = `${API_BASE_URL}/api/cutout?${params.toString()}`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch FITS cutout: ${response.statusText}`);
  }
  const data = await response.json();
  if (!(Array.isArray(data.raw_flux) && data.wcs && typeof data.bunit === 'string')) throw new Error('This view uses a different data format. Its backend connection is still being migrated.');
  return data;
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
  const url = `${API_BASE_URL}/api/compare`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Temporal comparison request failed: ${response.statusText}`);
  }
  return response.json();
}

export interface MatchObservation extends SPHERExObservation {
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
  const response = await fetch(`${API_BASE_URL}/api/compare/matches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal,
  });
  if (!response.ok) throw new Error(`Matching search failed: ${response.statusText}`);
  return response.json();
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
  const response = await fetch(`${API_BASE_URL}/api/compare/sequence`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal,
  });
  if (!response.ok) throw new Error(`Comparison preparation failed: ${response.statusText}`);
  return response.json();
}

export interface SpectralFeature {
  name: str;
  wavelength_um: number;
  feature_type: 'absorption' | 'emission';
  description: string;
}

type str = string;

export interface SpectralPoint {
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
  dec?: number
): Promise<SpectrumResponse> {
  const params = new URLSearchParams({ target_name: targetName });
  if (ra !== undefined) params.append('ra', normalizeRa(ra).toString());
  if (dec !== undefined) params.append('dec', dec.toString());

  const url = `${API_BASE_URL}/api/spectrum?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to extract spectral profile: ${response.statusText}`);
  }
  const data = await response.json();
  if (!(Array.isArray(data.spectral_points) && Array.isArray(data.spectral_features) && Array.isArray(data.detector_bands))) throw new Error('This view uses a different data format. Its backend connection is still being migrated.');
  return data;
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
  const params = new URLSearchParams({
    ra: normalizeRa(ra).toString(),
    dec: dec.toString(),
    radius_arcmin: radiusArcmin.toString(),
    width: width.toString(),
    height: height.toString(),
  });
  if (targetName) params.append('target_name', targetName);
  if (accessUrl) params.append('access_url', accessUrl);
  if (wcs) {
    if (wcs.crval1 != null) params.append('crval1', wcs.crval1.toString());
    if (wcs.crval2 != null) params.append('crval2', wcs.crval2.toString());
    if (wcs.crpix1 != null) params.append('crpix1', wcs.crpix1.toString());
    if (wcs.crpix2 != null) params.append('crpix2', wcs.crpix2.toString());
    if (wcs.cdelt1 != null) params.append('cdelt1', wcs.cdelt1.toString());
    if (wcs.cdelt2 != null) params.append('cdelt2', wcs.cdelt2.toString());
  }

  const url = `${API_BASE_URL}/api/catalog/sources?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch catalog sources: ${response.statusText}`);
  }
  return response.json();
}
