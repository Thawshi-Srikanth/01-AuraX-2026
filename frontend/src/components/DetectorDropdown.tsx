import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { DETECTOR_COLORS } from '../tokens/colors';
import { DETECTORS, selectedDetectors, toggleDetector } from '../utils/detectors';
import './detectorDropdown.css';

export function DetectorDropdown({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const selected = selectedDetectors(value);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="detector-dropdown" ref={root}>
    <span className="detector-dropdown-label" id={id + '-label'}>Detectors</span>
    <button ref={trigger} type="button" aria-labelledby={id + '-label ' + id + '-value'} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><span id={id + '-value'}>{selected.length === 6 ? 'All detectors' : selected.length ? selected.join(', ') : 'No detectors selected'}</span><ChevronDown size={14} /></button>
    {open && <div className="detector-dropdown-menu" id={id} role="group" aria-label="Detector checkboxes">
      <div className="detector-dropdown-actions"><button type="button" onClick={() => onChange('All')}>Select all</button><button type="button" onClick={() => onChange('None')}>Clear</button></div>
      {DETECTORS.map(detector => <label key={detector}><input type="checkbox" checked={selected.includes(detector)} onChange={() => onChange(toggleDetector(value, detector))} /><i style={{ backgroundColor: DETECTOR_COLORS[detector] }} />{detector}</label>)}
    </div>}
  </div>;
}
