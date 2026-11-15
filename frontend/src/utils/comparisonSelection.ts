import type { SPHERExObservation } from '../services/api';
import { detectorMatches } from './detectors';

export interface ComparisonFilters {
  detector: string;
  from: string;
  to: string;
  query: string;
  release: string;
  sort: string;
}

export function filterComparisonImages(images: SPHERExObservation[], filters: ComparisonFilters) {
  const query = filters.query.trim().toLowerCase();
  return images.filter(image =>
    detectorMatches(image.detector, filters.detector) &&
    (!filters.from || image.date_only >= filters.from) &&
    (!filters.to || image.date_only <= filters.to) &&
    (!filters.release || image.release === filters.release) &&
    (!query || [image.obs_id, image.detector, image.utc_date, image.processing_version, image.release].join(' ').toLowerCase().includes(query))
  ).sort((a, b) => {
    if (filters.sort === 'newest') return b.mjd_start - a.mjd_start || observationOrder(a, b);
    if (filters.sort === 'detector') return a.detector.localeCompare(b.detector) || a.mjd_start - b.mjd_start || observationOrder(a, b);
    return a.mjd_start - b.mjd_start || observationOrder(a, b);
  });
}

function observationOrder(a: SPHERExObservation, b: SPHERExObservation) {
  return a.access_url.localeCompare(b.access_url);
}
