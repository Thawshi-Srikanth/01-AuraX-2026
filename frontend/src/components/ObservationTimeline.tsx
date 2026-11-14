import { DETECTOR_COLORS } from '../tokens/colors';
import type { SPHERExObservation } from '../services/api';

interface ObservationTimelineProps {
  observations: SPHERExObservation[];
  selected: SPHERExObservation | null;
  displayed: SPHERExObservation | null;
  onSelect: (observation: SPHERExObservation) => void;
}

function sameObservation(a: SPHERExObservation | null, b: SPHERExObservation) {
  return a?.obs_id === b.obs_id && a.detector === b.detector && a.access_url === b.access_url;
}

export function ObservationTimeline({ observations, selected, displayed, onSelect }: ObservationTimelineProps) {
  const selectedIndex = Math.max(0, observations.findIndex(observation => sameObservation(selected, observation)));
  const dates = observations.flatMap((observation, index) => index === 0 || observation.date_only !== observations[index - 1].date_only
    ? [{ date: observation.date_only, index }] : []);
  const dateStride = Math.max(1, Math.ceil(dates.length / 6));
  const labels = dates.filter((_, index) => index % dateStride === 0);
  const selectedLabel = selected
    ? selected.utc_date + ' UTC, detector ' + selected.detector + (sameObservation(displayed, selected) ? ', displayed' : ', selected; image not yet displayed')
    : 'No observation selected';

  return <section className="images-timeline" aria-label="Observation timeline">
    {observations.length > 0 ? <div className="images-timeline-track">
      <div className="images-timeline-dates" aria-hidden="true">
        {labels.map(({ date, index }) => <span key={date} style={{ left: (index / Math.max(1, observations.length - 1) * 100) + '%' }}>{date.slice(5)}</span>)}
      </div>
      <div className="images-timeline-ticks" aria-hidden="true">
        {observations.map((observation, index) => <span key={observation.obs_id + observation.detector + index}
          data-major={index === 0 || observation.date_only !== observations[index - 1].date_only || undefined}
          data-selected={sameObservation(selected, observation) || undefined}
          data-displayed={sameObservation(displayed, observation) || undefined}
          style={{ backgroundColor: DETECTOR_COLORS[observation.detector] || '#888E9B' }} />)}
      </div>
      <input type="range" min={0} max={Math.max(0, observations.length - 1)} step={1} value={selectedIndex}
        aria-label="Timeline frame" aria-valuetext={selectedLabel} title={selectedLabel} disabled={observations.length < 2}
        onChange={event => { const observation = observations[Number(event.target.value)]; if (observation) onSelect(observation); }} />
    </div> : <p className="images-timeline-empty">No observations in this selection.</p>}
    <div className="images-timeline-caption"><span>Observation order</span><div className="images-detector-key" aria-label="Detector color key">
      {Object.entries(DETECTOR_COLORS).map(([detector, color]) => <span key={detector}><i style={{ backgroundColor: color }} aria-hidden="true" />{detector}</span>)}
    </div></div>
  </section>;
}
