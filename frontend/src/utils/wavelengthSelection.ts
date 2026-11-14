import type { SPHERExObservation, SpectralPoint } from '../services/api';

export function sameSpectralObservation(point: SpectralPoint, observation: SPHERExObservation) {
  return point.obs_id === observation.obs_id && point.detector === observation.detector
    && (!point.artifact_id || !observation.artifact_id || point.artifact_id === observation.artifact_id);
}
export const sampleForObservation = (points: SpectralPoint[], observation: SPHERExObservation | null) =>
  observation ? points.find(point => sameSpectralObservation(point, observation)) ?? null : null;
export const observationForSample = (observations: SPHERExObservation[], point: SpectralPoint) =>
  observations.find(observation => sameSpectralObservation(point, observation)) ?? null;
export const filterSpectralSamples = (points: SpectralPoint[], detector: string, date: string) =>
  points.filter(point => (detector === 'ALL' || point.detector === detector)
    && (date === 'ALL' || point.utc_date?.slice(0, 10) === date));
export function nearestSpectralSample(points: SpectralPoint[], wavelength: number) {
  return points.reduce<SpectralPoint | null>((best, point) => !best ||
    Math.abs(point.wavelength_um - wavelength) < Math.abs(best.wavelength_um - wavelength) ? point : best, null);
}
