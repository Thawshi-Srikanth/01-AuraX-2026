import { useEffect, useMemo, useRef } from 'react';
import type { SequenceResponse } from '../services/api';

export interface ImagePoint { x: number; y: number }
export interface CompareTransform { zoom: number; pan: ImagePoint }


function bitmap(data: SequenceResponse, frame: number, masked: boolean, invert = false, contrast = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = data.width; canvas.height = data.height;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(data.width, data.height);
  const values = data.frames[frame].pixels;
  const mask = masked ? data.valid_mask : data.display_mask || data.coverage_mask;
  for (let i = 0; i < values.length; i++) {
    const adjusted = Math.max(0, Math.min(1, (values[i] - .5) * contrast + .5));
    const value = Math.round((invert ? 1 - adjusted : adjusted) * 255);
    image.data[i * 4] = value; image.data[i * 4 + 1] = value; image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = mask[i] ? 255 : 0;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

interface Props {
  data: SequenceResponse;
  frame: number;
  masked: boolean;
  invert: boolean;
  contrast: number;
  transform: CompareTransform;
  onTransform: (transform: CompareTransform) => void;
  marking: boolean;
  point: ImagePoint | null;
  onMark: (point: ImagePoint) => void;
}

export function ComparisonCanvas({ data, frame, masked, invert, contrast, transform, onTransform, marking, point, onMark }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; pan: ImagePoint; scale: number } | null>(null);
  const geometry = useRef({ scale: 1, cx: 0, cy: 0 });
  const image = useMemo(() => bitmap(data, frame, masked, invert, contrast), [data, frame, masked, invert, contrast]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !canvas.parentElement) return;
    const draw = () => {
      const width = canvas.parentElement!.clientWidth, height = canvas.parentElement!.clientHeight;
      canvas.width = width; canvas.height = height;
      const scale = Math.max(.01, Math.min((width - 24) / data.width, (height - 24) / data.height)) * transform.zoom;
      const cx = width / 2 + transform.pan.x * scale, cy = height / 2 + transform.pan.y * scale;
      geometry.current = { scale, cx, cy };
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#050507'; ctx.fillRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = scale < 1;
      ctx.drawImage(image, cx - data.width * scale / 2, cy - data.height * scale / 2, data.width * scale, data.height * scale);
      if (data.target_pixel) {
        const x = cx + (data.target_pixel.x + .5 - data.width / 2) * scale;
        const y = cy + (data.target_pixel.y + .5 - data.height / 2) * scale;
        ctx.strokeStyle = '#67E8F9'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 12, y); ctx.lineTo(x - 5, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 12, y);
        ctx.moveTo(x, y - 12); ctx.lineTo(x, y - 5); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 12);
        ctx.stroke();
      }
      if (point) {
        const x = cx + (point.x + .5 - data.width / 2) * scale;
        const y = cy + (point.y + .5 - data.height / 2) * scale;
        ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.moveTo(x - 19, y); ctx.lineTo(x - 13, y); ctx.moveTo(x + 13, y); ctx.lineTo(x + 19, y);
        ctx.moveTo(x, y - 19); ctx.lineTo(x, y - 13); ctx.moveTo(x, y + 13); ctx.lineTo(x, y + 19); ctx.stroke();
      }
    };
    draw();
    const observer = new ResizeObserver(draw); observer.observe(canvas.parentElement);
    const preventScroll = (event: WheelEvent) => event.preventDefault();
    canvas.addEventListener('wheel', preventScroll, { passive: false });
    return () => { observer.disconnect(); canvas.removeEventListener('wheel', preventScroll); };
  }, [data, image, point, transform]);
  return <canvas ref={ref} tabIndex={0} className={marking ? 'comparison-canvas is-marking' : 'comparison-canvas'}
    aria-label={'Frame ' + (frame + 1) + '; ' + data.frames[frame].epoch.utc_date + ' UTC. ' + (marking ? 'Press Enter to mark the center; arrow keys adjust a mark.' : 'Drag to pan; use display controls to zoom.')}
    onPointerDown={event => {
      const { scale, cx, cy } = geometry.current;
      if (marking) {
        const rect = event.currentTarget.getBoundingClientRect();
        onMark({ x: Math.floor((event.clientX - rect.left - cx) / scale + data.width / 2), y: Math.floor((event.clientY - rect.top - cy) / scale + data.height / 2) });
      } else { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, pan: transform.pan, scale }; }
    }}
    onPointerMove={event => { const start = drag.current; if (start) onTransform({ ...transform, pan: { x: start.pan.x + (event.clientX - start.x) / start.scale, y: start.pan.y + (event.clientY - start.y) / start.scale } }); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onWheel={event => onTransform({ ...transform, zoom: Math.max(.5, Math.min(12, transform.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12))) })}
    onKeyDown={event => {
      if (!marking) {
        if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); onTransform({ ...transform, zoom: Math.max(.5, Math.min(12, transform.zoom * (event.key === '-' ? 1 / 1.25 : 1.25))) }); }
        return;
      }
      const base = point || { x: Math.floor(data.width / 2), y: Math.floor(data.height / 2) };
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (event.key === 'Enter' || delta) { event.preventDefault(); onMark({ x: base.x + (delta?.[0] || 0), y: base.y + (delta?.[1] || 0) }); }
    }} />;
}

export function ComparisonPatch({ data, frame, point, invert, contrast }: { data: SequenceResponse; frame: number; point: ImagePoint; invert: boolean; contrast: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#0B0D11'; ctx.fillRect(0, 0, 112, 112); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap(data, frame, false, invert, contrast), point.x - 15.5, point.y - 15.5, 32, 32, 0, 0, 112, 112);
    ctx.strokeStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(56, 56, 10, 0, Math.PI * 2); ctx.stroke();
  }, [data, frame, point, invert, contrast]);
  return <canvas ref={ref} width={112} height={112} aria-label={'Marked area in Frame ' + (frame + 1)} />;
}
