export const DETECTORS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];

export function selectedDetectors(value: string) {
  if (!value || value === 'All') return [...DETECTORS];
  return DETECTORS.filter(detector => value.split(',').includes(detector));
}

export function detectorMatches(detector: string, selection: string) {
  return selectedDetectors(selection).includes(detector);
}

export function toggleDetector(selection: string, detector: string) {
  const current = selectedDetectors(selection);
  const next = DETECTORS.filter(value => value === detector ? !current.includes(value) : current.includes(value));
  return next.length === DETECTORS.length ? 'All' : next.join(',') || 'None';
}

export function validDetectorSelection(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value === 'All' || value === 'None') return true;
  const values = value.split(',');
  return values.length <= 6 && new Set(values).size === values.length && values.every(value => DETECTORS.includes(value));
}
