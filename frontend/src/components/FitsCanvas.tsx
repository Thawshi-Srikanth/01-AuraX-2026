import React, { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus,
  Minus,
  RotateCcw,
  Compass,
  Layers,
  Maximize2,
  RefreshCw,
  AlertCircle,
  Sparkles,
  HelpCircle,
  Radio,
  ExternalLink,
  X,
} from 'lucide-react';
import { CutoutResponse, CatalogSource, fetchCatalogSources } from '../services/api';

export interface AperturePhotometryMetrics {
  targetRadiusPx: number;
  skyInnerRadiusPx: number;
  skyOuterRadiusPx: number;
  aperturePixels: number;
  skyPixels: number;
  meanFluxMjySr: number;
  skyFluxMjySr: number;
  netFluxMjySr: number;
}

interface FitsCanvasProps {
  cutout: CutoutResponse | null;
  loading: boolean;
  selectedStretch: string;
  onStretchChange: (stretch: string) => void;
  onRetry?: () => void;
  isPlaying?: boolean;
  targetId?: string;
  targetName?: string;
  targetRa?: number;
  targetDec?: number;
  accessUrl?: string;
  cutoutSize?: number;
  onCutoutSizeChange?: (size: number) => void;
  onAnalyzeSourceWavelengths?: (source: CatalogSource) => void;
  showAperture?: boolean;
  targetRadiusPx?: number;
  skyInnerRadiusPx?: number;
  skyOuterRadiusPx?: number;
  onApertureChange?: (metrics: AperturePhotometryMetrics | null) => void;
  minimal?: boolean;
  observationMode?: boolean;
  toolbarHost?: HTMLElement | null;
}

export type Colormap = 'greyscale' | 'viridis' | 'inferno';

interface HelperItem {
  tag: 'FACT' | 'HINT' | 'DEEP SPACE';
  text: string;
}

const HELPER_ITEMS: HelperItem[] = [
  {
    tag: 'DEEP SPACE',
    text: 'Patience, human! These infrared photons traveled hundreds of light-years just to get buffered at Caltech.',
  },
  {
    tag: 'FACT',
    text: 'SPHEREx captures 96 spectral bands simultaneously across 0.75 to 5.0 µm without any moving filter wheels.',
  },
  {
    tag: 'HINT',
    text: 'Hover over any pixel once loaded to inspect real-time calibrated surface brightness in MJy/sr.',
  },
  {
    tag: 'DEEP SPACE',
    text: "Caltech's archive servers are currently calculating the universe... please hold.",
  },
  {
    tag: 'FACT',
    text: 'SPHEREx maps the entire celestial sphere every 6 months from a low-Earth sun-synchronous polar orbit.',
  },
  {
    tag: 'HINT',
    text: 'Click the Celestial North compass needle in the top-right to instantly align the image North-Up.',
  },
  {
    tag: 'FACT',
    text: 'Each detector is a 2048 × 2048 Teledyne H2RG HgCdTe focal plane array operating at a frigid ~80 Kelvin.',
  },
  {
    tag: 'DEEP SPACE',
    text: 'Routing through deep space DSN antennas... watch out for orbital space debris.',
  },
  {
    tag: 'HINT',
    text: 'Toggle between ZScale, Linear, and Log contrast stretches to reveal faint diffuse nebular emissions.',
  },
  {
    tag: 'FACT',
    text: 'SPHEREx will survey over 450 million galaxies and 100 million stars across all four cosmic seasons.',
  },
  {
    tag: 'DEEP SPACE',
    text: 'Infrared light penetrates dense cosmic dust clouds that block standard optical telescopes.',
  },
];

// Precomputed 256-level RGB look-up tables for zero-cost color conversion
const COLORMAP_LUTS: Record<Colormap, Uint8ClampedArray> = {
  greyscale: (() => {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      lut[i * 3] = i;
      lut[i * 3 + 1] = i;
      lut[i * 3 + 2] = i;
    }
    return lut;
  })(),
  viridis: (() => {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const v = i / 255;
      const r = Math.round(255 * (0.28 + 0.7 * v - 0.2 * Math.sin(Math.PI * v)));
      const g = Math.round(255 * (0.15 + 0.8 * Math.sqrt(v)));
      const b = Math.round(255 * (0.47 + 0.5 * Math.cos(Math.PI * v * 0.8)));
      lut[i * 3] = Math.min(255, r);
      lut[i * 3 + 1] = Math.min(255, g);
      lut[i * 3 + 2] = Math.min(255, b);
    }
    return lut;
  })(),
  inferno: (() => {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const v = i / 255;
      const r = Math.round(255 * Math.min(1, v * 1.8));
      const g = Math.round(255 * Math.max(0, (v - 0.3) * 1.5));
      const b = Math.round(255 * Math.max(0, (v - 0.7) * 3.3));
      lut[i * 3] = Math.min(255, r);
      lut[i * 3 + 1] = Math.min(255, g);
      lut[i * 3 + 2] = Math.min(255, b);
    }
    return lut;
  })(),
};

// Convert decimal degrees into standard astronomical sexagesimal format (HMS, DMS)
function formatCelestialCoordinates(raDeg: number, decDeg: number): { raStr: string; decStr: string } {
  const normRa = ((raDeg % 360) + 360) % 360;
  const totalHours = normRa / 15;
  const h = Math.floor(totalHours);
  const remM = (totalHours - h) * 60;
  const m = Math.floor(remM);
  const s = ((remM - m) * 60).toFixed(1);
  const raStr = `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${s.padStart(4, '0')}s`;

  const sign = decDeg >= 0 ? '+' : '-';
  const absDec = Math.abs(decDeg);
  const d = Math.floor(absDec);
  const remArcmin = (absDec - d) * 60;
  const arcmin = Math.floor(remArcmin);
  const arcsec = Math.round((remArcmin - arcmin) * 60);
  const decStr = `${sign}${String(d).padStart(2, '0')}° ${String(arcmin).padStart(2, '0')}' ${String(arcsec).padStart(2, '0')}"`;

  return { raStr, decStr };
}

export const FitsCanvas: React.FC<FitsCanvasProps> = ({
  cutout,
  loading,
  selectedStretch,
  onStretchChange,
  onRetry,
  isPlaying = false,
  targetId,
  targetName,
  targetRa,
  targetDec,
  accessUrl,
  cutoutSize,
  onCutoutSizeChange,
  onAnalyzeSourceWavelengths,
  showAperture = false,
  targetRadiusPx = 4,
  skyInnerRadiusPx = 7,
  skyOuterRadiusPx = 11,
  onApertureChange,
  minimal = false,
  observationMode = false,
  toolbarHost = null,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cachedOffscreenRef = useRef<HTMLCanvasElement | null>(null);
  const rafDrawRef = useRef<number | null>(null);

  // Dynamic rotating helper text (Fun facts, humor, hints)
  const [helperIdx, setHelperIdx] = useState(0);
  const [helperFade, setHelperFade] = useState(true);

  useEffect(() => {
    if (!loading || observationMode) return;
    const interval = setInterval(() => {
      setHelperFade(false);
      setTimeout(() => {
        setHelperIdx((prev) => (prev + 1) % HELPER_ITEMS.length);
        setHelperFade(true);
      }, 200);
    }, 3800);

    return () => clearInterval(interval);
  }, [loading, observationMode]);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    setElapsedSeconds(0);
    if (!loading) return;
    const timer = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [loading]);

  const [colormap, setColormap] = useState<Colormap>(observationMode ? 'greyscale' : 'viridis');
  const [transform, setTransform] = useState<{ zoom: number; panX: number; panY: number }>({
    zoom: 4,
    panX: 0,
    panY: 0,
  });
  const transformRef = useRef(transform);
  transformRef.current = transform;

  const [rotation, setRotation] = useState<number>(0);
  const rotationRef = useRef(0);
  rotationRef.current = rotation;

  const northAngle = cutout?.wcs?.north_angle_deg ?? null;
  const hasValidWcs = Boolean(cutout?.wcs?.has_valid_wcs && northAngle !== null);

  const handleAlignNorth = () => {
    if (!hasValidWcs || northAngle === null) return;
    const targetRotation = -northAngle;
    if (Math.abs(rotation - targetRotation) < 0.5) {
      setRotation(0);
    } else {
      setRotation(targetRotation);
    }
  };

  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hasDraggedRef = useRef<boolean>(false);

  // Known Celestial Catalog Sources Overlay State (On by default in full Observations view so stars are immediately clickable)
  const [showCatalog, setShowCatalog] = useState<boolean>(!minimal && !observationMode);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogSources, setCatalogSources] = useState<CatalogSource[]>([]);
  const [catalogLimit, setCatalogLimit] = useState<number>(25);
  const [loadingCatalog, setLoadingCatalog] = useState<boolean>(false);
  const [hoveredSource, setHoveredSource] = useState<CatalogSource | null>(null);
  const [selectedSource, setSelectedSource] = useState<CatalogSource | null>(null);

  // Fetch catalog sources when toggle is activated or celestial target/cutout changes
  // Clear stale sources immediately while FITS cutout or source detection is loading
  useEffect(() => {
    setCatalogSources([]);
    setCatalogError(null);
    setHoveredSource(null);
    setSelectedSource(null);

    if (!showCatalog || loading || !cutout || cutout.width === 0 || cutout.status === 'error') {
      setLoadingCatalog(false);
      return;
    }
    const ra = targetRa ?? cutout.wcs?.crval1;
    const dec = targetDec ?? cutout.wcs?.crval2;
    if (ra == null || dec == null) return;

    let cancelled = false;
    setLoadingCatalog(true);
    fetchCatalogSources(
      ra,
      dec,
      11.0,
      cutout.width,
      cutout.height,
      targetName || targetId,
      accessUrl,
      cutout.wcs
    )
      .then((res) => {
        if (!cancelled && res.status === 'success') {
          // Double guard: Ensure all sources are strictly bounded within canvas extents
          const bounded = res.sources.filter(
            (s) => s.pixel_x >= 0 && s.pixel_x <= cutout.width && s.pixel_y >= 0 && s.pixel_y <= cutout.height
          );
          setCatalogSources(bounded);
        }
      })
      .catch((err) => {
        if (!cancelled) setCatalogError(err instanceof Error ? err.message : 'Catalog unavailable.');
      })
      .finally(() => {
        if (!cancelled) setLoadingCatalog(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showCatalog, loading, cutout, targetRa, targetDec, targetName, targetId, accessUrl]);

  // Direct DOM refs for zero-overhead, 60fps cursor HUD readout (eliminating React component re-renders)
  const hudCardRef = useRef<HTMLDivElement | null>(null);
  const hudFluxRef = useRef<HTMLSpanElement | null>(null);
  const hudPixelRef = useRef<HTMLSpanElement | null>(null);
  const hudWcsRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (observationMode && hudCardRef.current) hudCardRef.current.style.opacity = '0';
  }, [cutout, loading, observationMode]);

  // Floating cursor flux tooltip refs & rest timer
  const floatingBadgeRef = useRef<HTMLDivElement | null>(null);
  const cursorRestTimerRef = useRef<number | null>(null);

  // Clear rest timer on unmount
  useEffect(() => {
    return () => {
      if (cursorRestTimerRef.current) window.clearTimeout(cursorRestTimerRef.current);
    };
  }, []);

  // Fast GPU draw of cached offscreen buffer to display canvas with celestial orientation
  const drawToScreen = useCallback(() => {
    const canvas = canvasRef.current;
    const offscreen = cachedOffscreenRef.current;
    if (!canvas || !offscreen || !cutout) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false; // Nearest neighbor for crisp astronomical pixels

    const { zoom, panX, panY } = transform;
    const destW = cutout.width * zoom;
    const destH = cutout.height * zoom;
    const centerX = canvas.width / 2 + panX;
    const centerY = canvas.height / 2 + panY;

    ctx.save();
    ctx.translate(centerX, centerY);
    if (rotation !== 0) {
      ctx.rotate((rotation * Math.PI) / 180);
    }
    ctx.drawImage(offscreen, -destW / 2, -destH / 2, destW, destH);

    // Interactive Aperture Photometry Overlay (Zero Overhead Canvas Rendering)
    if (showAperture) {
      const rAperCanvas = targetRadiusPx * zoom;
      const rSkyInCanvas = skyInnerRadiusPx * zoom;
      const rSkyOutCanvas = skyOuterRadiusPx * zoom;

      // Target circular aperture
      ctx.beginPath();
      ctx.arc(0, 0, rAperCanvas, 0, 2 * Math.PI);
      ctx.strokeStyle = '#34D399'; // Emerald
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.stroke();

      // Sky background annulus
      ctx.beginPath();
      ctx.arc(0, 0, rSkyInCanvas, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)'; // Cyan
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, rSkyOutCanvas, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();

      // Subtle center target crosshair
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(-4, 0); ctx.lineTo(4, 0);
      ctx.moveTo(0, -4); ctx.lineTo(0, 4);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Astrometric Celestial Catalog Overlay (Red Circles Only; Labels Shown Only on Hover & After Fetch Completes)
    if (showCatalog && !loading && !loadingCatalog && catalogSources.length > 0) {
      const visibleSources = catalogSources.slice(0, catalogLimit);

      for (let i = 0; i < visibleSources.length; i++) {
        const s = visibleSources[i];
        const relX = (s.pixel_x - cutout.width / 2) * zoom;
        const relY = (s.pixel_y - cutout.height / 2) * zoom;

        const isHovered = hoveredSource?.id === s.id;
        const isSelected = selectedSource?.id === s.id;
        const isPrimary = s.brightness_rank === 1;

        ctx.save();
        ctx.translate(relX, relY);
        // Counter-rotate markers so labels stay horizontally upright regardless of celestial rotation
        if (rotation !== 0) {
          ctx.rotate((-rotation * Math.PI) / 180);
        }

        const rCirc = isSelected ? 10.5 : isHovered ? 9 : isPrimary ? 7.5 : 6;
        ctx.beginPath();
        ctx.arc(0, 0, rCirc, 0, 2 * Math.PI);
        ctx.strokeStyle = isSelected ? '#FCA5A5' : isHovered ? '#F87171' : '#EF4444';
        ctx.lineWidth = isSelected ? 2.2 : isHovered ? 2 : isPrimary ? 1.5 : 1.25;
        if (isSelected) {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
          ctx.fill();
        }
        ctx.setLineDash([]);
        ctx.stroke();

        if (isSelected) {
          ctx.beginPath();
          ctx.arc(0, 0, 2, 0, 2 * Math.PI);
          ctx.fillStyle = '#FCA5A5';
          ctx.fill();
        }

        // Only render the label pill when hovering or when selected
        if (isHovered || isSelected) {
          const labelText = s.name.length > 22 ? s.name.slice(0, 20) + '…' : s.name;
          const magVal = s.mag_v ?? s.mag_g ?? s.mag_k;
          const magLabel = magVal !== null && magVal !== undefined
            ? s.mag_v !== null ? `V=${magVal.toFixed(1)}` : s.mag_g !== null ? `G=${magVal.toFixed(1)}` : `K=${magVal.toFixed(1)}`
            : '';

          ctx.font = 'bold 11px monospace';
          const nameWidth = ctx.measureText(labelText).width;
          let pillW = nameWidth;

          if (magLabel) {
            ctx.font = '9px monospace';
            const magWidth = ctx.measureText(magLabel).width;
            pillW = Math.max(nameWidth, magWidth);
          }

          const pillX = rCirc + 6;
          const pillY = magLabel ? -14 : -10;
          const pillH = magLabel ? 26 : 18;
          const padX = 6;

          ctx.fillStyle = '#050507';
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 1.25;

          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(pillX, pillY, pillW + padX * 2, pillH, 4);
          } else {
            ctx.rect(pillX, pillY, pillW + padX * 2, pillH);
          }
          ctx.fill();
          ctx.stroke();

          ctx.font = 'bold 11px monospace';
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(labelText, pillX + padX, magLabel ? -2 : 3);

          if (magLabel) {
            ctx.font = '9px monospace';
            ctx.fillStyle = '#FCA5A5';
            ctx.fillText(magLabel, pillX + padX, 9);
          }
        }

        ctx.restore();
      }
    }

    ctx.restore();
  }, [cutout, loading, loadingCatalog, transform, rotation, showAperture, targetRadiusPx, skyInnerRadiusPx, skyOuterRadiusPx, showCatalog, catalogSources, catalogLimit, hoveredSource, selectedSource]);

  // Fit without changing the image aspect ratio; hosted controls occupy separate space.
  const fitToViewport = useCallback(() => {
    const container = containerRef.current;
    if (!container || !cutout || cutout.width === 0 || cutout.height === 0) return;

    const availableWidth = container.clientWidth || 800;
    const availableHeight = container.clientHeight || 600;

    const scaleX = (observationMode ? Math.max(1, availableWidth - 24) : availableWidth * 0.85) / cutout.width;
    const toolbarSpace = availableWidth < 450 ? 152 : 112;
    const scaleY = (observationMode ? Math.max(1, availableHeight - (toolbarHost ? 24 : toolbarSpace)) : availableHeight * 0.85) / cutout.height;
    const optimalZoom = Math.max(0.15, Math.min(32, Math.min(scaleX, scaleY)));

    setTransform({ zoom: optimalZoom, panX: 0, panY: observationMode && !toolbarHost ? (availableWidth < 450 ? 28 : 20) : 0 });
    setRotation(0);
  }, [cutout, observationMode, toolbarHost]);

  // Zoom centered on the viewport for button clicks
  const zoomAtCenter = useCallback((factor: number) => {
    setTransform((prev) => {
      const nextZoom = Math.max(0.15, Math.min(64, prev.zoom * factor));
      const k = nextZoom / prev.zoom;
      return {
        zoom: nextZoom,
        panX: prev.panX * k,
        panY: prev.panY * k,
      };
    });
  }, []);

  // Colorize FITS pixel array into cached offscreen canvas ONLY on cutout or colormap change
  useEffect(() => {
    if (!cutout || cutout.status === 'error' || cutout.width === 0 || cutout.height === 0) {
      cachedOffscreenRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const { width, height, pixels } = cutout;
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    const imgData = offCtx.createImageData(width, height);
    const data = imgData.data;
    const lut = COLORMAP_LUTS[colormap];

    for (let i = 0; i < pixels.length; i++) {
      const byte = Math.round(Math.max(0, Math.min(1, pixels[i])) * 255);
      const lutIdx = byte * 3;
      const idx = i * 4;
      data[idx] = lut[lutIdx];
      data[idx + 1] = lut[lutIdx + 1];
      data[idx + 2] = lut[lutIdx + 2];
      data[idx + 3] = 255;
    }

    offCtx.putImageData(imgData, 0, 0);
    cachedOffscreenRef.current = offscreen;
    drawToScreen();
  }, [cutout, colormap, drawToScreen]);

  // Auto-fit observation on initial mount, when astronomical target changes, or when cutout FOV size changes
  // Preserves user's custom zoom level, pan coordinates, and celestial rotation across timeline & spectral transitions
  const lastTargetIdRef = useRef<string | null>(null);
  const lastDimsRef = useRef<string | null>(null);
  const isInitialFitDoneRef = useRef<boolean>(false);

  useEffect(() => {
    if (!cutout || cutout.width === 0 || cutout.height === 0) return;

    const dimsKey = `${cutout.width}x${cutout.height}`;
    const targetChanged = targetId !== undefined && lastTargetIdRef.current !== targetId;
    const dimsChanged = lastDimsRef.current !== null && lastDimsRef.current !== dimsKey;

    if (targetChanged || dimsChanged) {
      lastTargetIdRef.current = targetId || null;
      lastDimsRef.current = dimsKey;
      isInitialFitDoneRef.current = false;
    }

    if (!isInitialFitDoneRef.current) {
      isInitialFitDoneRef.current = true;
      lastDimsRef.current = dimsKey;
      fitToViewport();
    }
  }, [cutout, targetId, fitToViewport]);

  // Immediate redraw on pan or zoom change
  useEffect(() => {
    drawToScreen();
  }, [drawToScreen]);

  // Scientific Aperture Photometry Calculation (Real-time Flux Integration & Sky Subtraction)
  useEffect(() => {
    if (!showAperture || !cutout || cutout.width === 0 || cutout.height === 0 || !onApertureChange) {
      if (onApertureChange) onApertureChange(null);
      return;
    }

    const { width, height, pixels, raw_flux, min_flux_mjy_sr, max_flux_mjy_sr } = cutout;
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);

    let aperSum = 0;
    let aperCount = 0;
    const skyValues: number[] = [];

    const maxR = Math.ceil(skyOuterRadiusPx);
    for (let dy = -maxR; dy <= maxR; dy++) {
      const py = cy + dy;
      if (py < 0 || py >= height) continue;
      for (let dx = -maxR; dx <= maxR; dx++) {
        const px = cx + dx;
        if (px < 0 || px >= width) continue;
        const dist = Math.hypot(dx, dy);
        const idx = py * width + px;
        const flux = raw_flux && raw_flux.length > idx
          ? raw_flux[idx]
          : min_flux_mjy_sr + pixels[idx] * (max_flux_mjy_sr - min_flux_mjy_sr);

        if (!Number.isFinite(flux) || cutout.valid_pixels?.[idx] === false) continue;

        if (dist <= targetRadiusPx) {
          aperSum += flux;
          aperCount++;
        } else if (dist >= skyInnerRadiusPx && dist <= skyOuterRadiusPx) {
          skyValues.push(flux);
        }
      }
    }

    if (!aperCount || !skyValues.length) { onApertureChange(null); return; }
    const meanFlux = aperSum / aperCount;
    let skyFlux = 0;
    if (skyValues.length > 0) {
      skyValues.sort((a, b) => a - b);
      skyFlux = skyValues[Math.floor(skyValues.length / 2)];
    }
    const netFlux = meanFlux - skyFlux;

    onApertureChange({
      targetRadiusPx,
      skyInnerRadiusPx,
      skyOuterRadiusPx,
      aperturePixels: aperCount,
      skyPixels: skyValues.length,
      meanFluxMjySr: meanFlux,
      skyFluxMjySr: skyFlux,
      netFluxMjySr: netFlux,
    });
  }, [cutout, showAperture, targetRadiusPx, skyInnerRadiusPx, skyOuterRadiusPx, onApertureChange]);

  // Resize canvas to container
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const updateSize = () => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      drawToScreen();
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);
    window.addEventListener('resize', updateSize);
    return () => { resizeObserver.disconnect(); window.removeEventListener('resize', updateSize); };
  }, [drawToScreen]);

  // Pan interaction
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    hasDraggedRef.current = false;
    dragOriginRef.current = { x: e.clientX, y: e.clientY };
    setDragStart({
      x: e.clientX - transformRef.current.panX,
      y: e.clientY - transformRef.current.panY,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      if (Math.hypot(e.clientX - dragOriginRef.current.x, e.clientY - dragOriginRef.current.y) > 4) {
        hasDraggedRef.current = true;
      }
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      if (rafDrawRef.current) cancelAnimationFrame(rafDrawRef.current);
      rafDrawRef.current = requestAnimationFrame(() => {
        setTransform((prev) => ({ ...prev, panX: newX, panY: newY }));
      });
    }

    // Compute scientific pixel value & celestial coordinates under cursor (Zero React Re-renders)
    const container = containerRef.current;
    if (container && cutout && cutout.width > 0) {
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const { zoom, panX, panY } = transformRef.current;
      const currentRotation = rotationRef.current;
      const destW = cutout.width * zoom;
      const destH = cutout.height * zoom;
      const centerX = rect.width / 2 + panX;
      const centerY = rect.height / 2 + panY;

      let unrotX = mouseX - centerX;
      let unrotY = mouseY - centerY;

      if (currentRotation !== 0) {
        const rad = (-currentRotation * Math.PI) / 180;
        const cosR = Math.cos(rad);
        const sinR = Math.sin(rad);
        const rx = unrotX * cosR - unrotY * sinR;
        const ry = unrotX * sinR + unrotY * cosR;
        unrotX = rx;
        unrotY = ry;
      }

      const imgX = Math.floor((unrotX + destW / 2) / zoom);
      const imgY = Math.floor((unrotY + destH / 2) / zoom);

      if (imgX >= 0 && imgX < cutout.width && imgY >= 0 && imgY < cutout.height) {
        const idx = imgY * cutout.width + imgX;
        const rawFluxVal = cutout.raw_flux && cutout.raw_flux.length > idx
          ? cutout.raw_flux[idx]
          : cutout.min_flux_mjy_sr + cutout.pixels[idx] * (cutout.max_flux_mjy_sr - cutout.min_flux_mjy_sr);

        const unit = cutout.bunit || 'MJy/sr';
        const hasCalibratedPixel = !!cutout.raw_flux && cutout.raw_flux.length > idx;
        const formattedFlux = observationMode && !hasCalibratedPixel
          ? 'Unavailable at this image size'
          : !Number.isFinite(rawFluxVal) || cutout.valid_pixels?.[idx] === false
          ? 'NaN (Masked)'
          : Math.abs(rawFluxVal) < 0.001 && rawFluxVal !== 0
          ? `${rawFluxVal.toExponential(3)} ${unit}`
          : `${rawFluxVal.toFixed(4)} ${unit}`;

        if (hudFluxRef.current) {
          hudFluxRef.current.textContent = formattedFlux;
        }

        if (hudPixelRef.current) {
          hudPixelRef.current.textContent = `[${imgX}, ${imgY}]`;
        }

        if (hudWcsRef.current) {
          const wcs = cutout.wcs;
          if (wcs?.ra_grid && wcs.dec_grid && Number.isFinite(wcs.ra_grid[idx]) && Number.isFinite(wcs.dec_grid[idx])) {
            const raDeg = wcs.ra_grid[idx];
            const decDeg = wcs.dec_grid[idx];
            const { raStr, decStr } = formatCelestialCoordinates(raDeg, decDeg);
            hudWcsRef.current.textContent = `${raStr} · ${decStr}`;
          } else {
            hudWcsRef.current.textContent = 'No WCS';
          }
        }

        // Update dynamic cursor-following flux badge
        if (floatingBadgeRef.current) {
          const badgeX = mouseX + 16 + 120 > rect.width ? mouseX - 125 : mouseX + 16;
          const badgeY = mouseY - 14 < 10 ? mouseY + 20 : mouseY - 14;
          floatingBadgeRef.current.style.transform = `translate3d(${badgeX}px, ${badgeY}px, 0)`;
          floatingBadgeRef.current.textContent = formattedFlux;
          floatingBadgeRef.current.style.opacity = '1';

          // Reset rest timer: Auto-hide floating tooltip when cursor rests for 750ms
          if (cursorRestTimerRef.current) window.clearTimeout(cursorRestTimerRef.current);
          cursorRestTimerRef.current = window.setTimeout(() => {
            if (floatingBadgeRef.current) {
              floatingBadgeRef.current.style.opacity = '0';
            }
          }, 750);
        }

        // Astrometric Catalog Source Hover Detection (only active after both FITS and sources finish loading)
        if (showCatalog && !loading && !loadingCatalog && catalogSources.length > 0) {
          const visible = catalogSources.slice(0, catalogLimit);
          let found: CatalogSource | null = null;
          for (const s of visible) {
            const dPx = Math.hypot(imgX + 0.5 - s.pixel_x, imgY + 0.5 - s.pixel_y);
            if (dPx * zoom < 14) {
              found = s;
              break;
            }
          }
          if (found && floatingBadgeRef.current) {
            const magVal = found.mag_v ?? found.mag_g ?? found.mag_k;
            const magStr = magVal != null ? ` · mag=${magVal.toFixed(1)}` : '';
            floatingBadgeRef.current.textContent = `★ ${found.name}${magStr} · ${formattedFlux}`;
          }
          setHoveredSource((prev) => (prev?.id !== found?.id ? found : prev));
        } else if (hoveredSource) {
          setHoveredSource(null);
        }

        if (hudCardRef.current) {
          hudCardRef.current.style.opacity = '1';
        }
      } else {
        if (hudCardRef.current) {
          hudCardRef.current.style.opacity = '0';
        }
        if (floatingBadgeRef.current) {
          floatingBadgeRef.current.style.opacity = '0';
        }
        if (cursorRestTimerRef.current) window.clearTimeout(cursorRestTimerRef.current);
      }
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  // Click on a red-circled star in the FITS image to select it for Wavelengths analysis
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (minimal || hasDraggedRef.current) return;
    if (!showCatalog || loading || loadingCatalog || catalogSources.length === 0 || !cutout || cutout.width === 0) {
      return;
    }

    if (hoveredSource) {
      setSelectedSource(hoveredSource);
      return;
    }

    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const { zoom, panX, panY } = transformRef.current;
    const currentRotation = rotationRef.current;
    const destW = cutout.width * zoom;
    const destH = cutout.height * zoom;
    const centerX = rect.width / 2 + panX;
    const centerY = rect.height / 2 + panY;

    let unrotX = mouseX - centerX;
    let unrotY = mouseY - centerY;
    if (currentRotation !== 0) {
      const rad = (-currentRotation * Math.PI) / 180;
      const cosR = Math.cos(rad);
      const sinR = Math.sin(rad);
      const rx = unrotX * cosR - unrotY * sinR;
      const ry = unrotX * sinR + unrotY * cosR;
      unrotX = rx;
      unrotY = ry;
    }

    const imgX = (unrotX + destW / 2) / zoom;
    const imgY = (unrotY + destH / 2) / zoom;

    const visible = catalogSources.slice(0, catalogLimit);
    let found: CatalogSource | null = null;
    for (const s of visible) {
      const dPx = Math.hypot(imgX - s.pixel_x, imgY - s.pixel_y);
      if (dPx * zoom < 16) {
        found = s;
        break;
      }
    }
    setSelectedSource(found);
  };

  // Exact cursor-anchored wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;

    setTransform((prev) => {
      const nextZoom = Math.max(0.15, Math.min(64, prev.zoom * factor));
      const k = nextZoom / prev.zoom;
      if (k === 1) return prev;

      // Exact cursor anchor: The image point directly under (mouseX, mouseY) stays at (mouseX, mouseY)
      const nextPanX = (mouseX - cx) * (1 - k) + prev.panX * k;
      const nextPanY = (mouseY - cy) * (1 - k) + prev.panY * k;

      return {
        zoom: nextZoom,
        panX: nextPanX,
        panY: nextPanY,
      };
    });
  };

  const displayControls = (
        <div
          role="toolbar" aria-label="Image display controls"
          onMouseDown={(e) => e.stopPropagation()}
          className={`absolute top-3 left-3 z-20 flex items-center bg-[#0B0D11]/95 border border-[#1C2029] rounded-lg px-2 py-1 shadow-xl backdrop-blur-md space-x-2 text-[11px] ${observationMode ? 'images-canvas-toolbar' : ''}`}
        >
          {/* Stretch Dropdown */}
          <div className="flex items-center space-x-1">
            <span className="text-[10px] uppercase tracking-wider text-[#888E9B]">Stretch</span>
            <select
              aria-label="Stretch scaling mode"
              value={selectedStretch}
              onChange={(e) => onStretchChange(e.target.value)}
              className="bg-[#12151C] border border-[#1C2029] hover:border-[#2E3646] rounded px-1.5 py-0.5 text-[11px] font-mono text-white focus:outline-none cursor-pointer"
            >
              <option value="zscale">ZScale</option>
              <option value="linear">Linear</option>
              <option value="log">Log</option>
            </select>
          </div>

          <div className="w-px h-3.5 bg-[#1C2029]" />

          {/* Colormap Dropdown */}
          <div className="flex items-center space-x-1">
            <Layers size={11} className="text-[#888E9B]" />
            <span className="text-[10px] uppercase tracking-wider text-[#888E9B]">Color</span>
            <select
              aria-label="Colormap palette"
              value={colormap}
              onChange={(e) => setColormap(e.target.value as Colormap)}
              className="bg-[#12151C] border border-[#1C2029] hover:border-[#2E3646] rounded px-1.5 py-0.5 text-[11px] text-white focus:outline-none cursor-pointer"
            >
              <option value="viridis">Viridis</option>
              <option value="inferno">Inferno</option>
              <option value="greyscale">Greyscale</option>
            </select>
          </div>

          {/* FOV Resolution Dropdown */}
          {onCutoutSizeChange && (
            <>
              <div className="w-px h-3.5 bg-[#1C2029]" />
              <div className="flex items-center space-x-1">
                <span className="text-[10px] uppercase tracking-wider text-[#888E9B]">FOV</span>
                <select
                  aria-label="Field of View Cutout Resolution"
                  value={
                    Math.min(290, cutoutSize ?? 200)
                  }
                  onChange={(e) => onCutoutSizeChange(Number(e.target.value))}
                  className="bg-[#12151C] border border-[#1C2029] hover:border-[#2E3646] rounded px-1.5 py-0.5 text-[11px] font-mono text-white focus:outline-none cursor-pointer"
                >
                  <option value={200}>20.7 arcmin (nominal 200px)</option>
                  <option value={100}>10.3 arcmin (nominal 100px)</option>
                  <option value={50}>5.2 arcmin (nominal 50px)</option>
                  <option value={290}>30 arcmin (maximum)</option>
                </select>
              </div>
            </>
          )}

          <div className="w-px h-3.5 bg-[#1C2029]" />

          {/* Sources Compact Toggle & Limit Dropdown */}
          <div className="flex items-center space-x-1.5">
            {observationMode ? <span className="text-[10px] uppercase tracking-wider text-text-secondary">Sources</span> : <button
              type="button"
              onClick={() => setShowCatalog((prev) => !prev)}
              aria-label="Toggle SIMBAD Known Celestial Sources"
              title="SIMBAD reference positions; epoch unspecified, motion not applied, image matches unverified"
              className="flex items-center space-x-1 text-[10px] uppercase tracking-wider text-[#888E9B] hover:text-white cursor-pointer"
            >
              <span
                className={`w-2 h-2 rounded-full transition-colors ${
                  showCatalog ? 'bg-red-500' : 'bg-[#2E3646]'
                }`}
              />
              <span className={showCatalog ? 'text-white font-medium' : 'text-[#888E9B]'}>
                Sources
              </span>
            </button>}

            <select
              aria-label="Catalog reference limit"
              value={showCatalog ? String(catalogLimit) : 'off'}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'off') {
                  setShowCatalog(false);
                } else {
                  setShowCatalog(true);
                  setCatalogLimit(Number(val) as 10 | 25 | 50);
                }
              }}
              className={`bg-[#12151C] border rounded px-1.5 py-0.5 text-[11px] font-mono focus:outline-none cursor-pointer transition-colors ${
                showCatalog
                  ? 'border-red-500/40 text-red-300 hover:border-red-500/70'
                  : 'border-[#1C2029] text-[#888E9B] hover:border-[#2E3646]'
              }`}
            >
              <option value="off">Hidden</option>
              <option value="10">First 10</option>
              <option value="25">First 25</option>
              <option value="50">First 50</option>
            </select>

            {showCatalog && (loading || loadingCatalog) && (
              <RefreshCw size={10} className="animate-spin text-red-400" />
            )}
            {showCatalog && !loading && !loadingCatalog && catalogSources.length > 0 && (
              <span className="text-[10px] font-mono text-red-400 tabular-nums">
                ({Math.min(catalogLimit, catalogSources.length)})
              </span>
            )}
          </div>
        </div>
  );

  // Scale bar calculation: SPHEREx is ~6.2 arcsec / pixel
  const pixelScaleArcsec = 6.2;
  const barPixels = (2 * 60) / pixelScaleArcsec; // pixels for 2 arcmin
  const barCanvasWidth = Math.round(barPixels * transform.zoom);

  return (
    <div
      ref={containerRef}
      className={`flex-1 w-full h-full relative overflow-hidden bg-black select-none ${
        hoveredSource ? 'cursor-pointer' : 'cursor-crosshair'
      }`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleCanvasClick}
      onMouseLeave={() => {
        setIsDragging(false);
        if (cursorRestTimerRef.current) window.clearTimeout(cursorRestTimerRef.current);
        if (hudCardRef.current) {
          hudCardRef.current.style.opacity = '0';
        }
        if (floatingBadgeRef.current) {
          floatingBadgeRef.current.style.opacity = '0';
        }
      }}
      onWheel={handleWheel}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />

      {/* Floating Cursor Flux Tooltip (tracks cursor, auto-hides when stationary) */}
      {!observationMode && <div
        ref={floatingBadgeRef}
        className="absolute top-0 left-0 z-30 pointer-events-none px-2 py-0.5 rounded bg-bg-surface/95 border border-border-strong text-[11px] font-semibold text-text-primary tabular-nums shadow-lg backdrop-blur-[2px] transition-opacity duration-200 opacity-0 will-change-transform"
      >
        —
      </div>}

      {/* Center Subtle Reticle */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
        <div className="w-24 h-[1px] bg-border-strong opacity-30 absolute" />
        <div className="h-24 w-[1px] bg-border-strong opacity-30 absolute" />
        <div className="w-6 h-6 rounded-full border border-border-strong opacity-40 absolute" />
      </div>

      {/* Minimal Stamp Controls when minimal={true} */}
      {minimal && (
        <div className="absolute top-2 right-2 z-20 flex items-center bg-[#0B0D11] border border-[#1C2029] rounded text-[10px] font-mono overflow-hidden">
          <button
            type="button"
            onClick={() => zoomAtCenter(1.3)}
            title="Zoom in"
            className="px-2 py-0.5 text-[#888E9B] hover:text-white border-r border-[#1C2029] cursor-pointer"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoomAtCenter(1 / 1.3)}
            title="Zoom out"
            className="px-2 py-0.5 text-[#888E9B] hover:text-white border-r border-[#1C2029] cursor-pointer"
          >
            −
          </button>
          <button
            type="button"
            onClick={fitToViewport}
            title="Fit cutout to stamp"
            className="px-2 py-0.5 text-[#888E9B] hover:text-white cursor-pointer"
          >
            Fit
          </button>
        </div>
      )}

      {minimal && loading && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-30 select-none">
          <span className="bg-[#0B0D11] border border-[#1C2029] px-3 py-1.5 rounded text-[11px] font-mono text-[#888E9B]">
            Loading FITS stamp…
          </span>
        </div>
      )}

      {!minimal && (toolbarHost ? createPortal(displayControls, toolbarHost) : displayControls)}

      {/* Fallback Reference or Error Indicator */}
      {!minimal && cutout?.status === 'sample_fallback' && (
        <div className="absolute top-16 left-4 z-20 text-[10px] text-science-warning bg-bg-surface/90 border border-border-subtle px-2 py-1 rounded backdrop-blur">
          Reference sample — not a selected observation
        </div>
      )}
      {!observationMode && cutout?.status === 'error' && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-30 p-4">
          <div className="max-w-md text-center space-y-2">
            <div className="text-science-error text-[12px] uppercase tracking-wide">
              Cutout Processing Unavailable
            </div>
            <div className="text-text-secondary text-[11px]">
              {cutout.message || 'Could not load FITS cutout from NASA IRSA archive.'}
            </div>
          </div>
        </div>
      )}

      {/* Top-Right HUD Navigation Buttons (Hidden in Minimal Mode) */}
      {!minimal && (
      <div className="absolute top-4 right-4 z-20 flex flex-col items-center space-y-2">
        {/* Interactive Celestial North Compass Rose */}
        <button
          type="button"
          disabled={!hasValidWcs}
          onClick={handleAlignNorth}
          aria-label="Align Celestial North Up"
          title={
            hasValidWcs
              ? Math.abs(rotation - (-northAngle!)) < 0.5
                ? `Celestial North is Up (PA: ${northAngle}°). Click to restore original detector orientation.`
                : `Align Celestial North Up (current PA: ${northAngle}°)`
              : 'Spatial WCS unavailable; celestial north cannot be determined'
          }
          className={`relative w-8 h-8 rounded-full border bg-bg-surface/90 backdrop-blur flex items-center justify-center transition-all ${
            hasValidWcs
              ? Math.abs(rotation - (-northAngle!)) < 0.5
                ? 'border-white text-text-primary bg-bg-raised shadow-md cursor-pointer'
                : 'border-border-subtle hover:border-border-strong text-text-secondary hover:text-text-primary hover:bg-bg-hover cursor-pointer'
              : 'border-border-subtle text-text-tertiary opacity-35 cursor-not-allowed'
          }`}
        >
          {/* Rotating Compass Needle */}
          <div
            className="transition-transform duration-300 flex items-center justify-center w-full h-full"
            style={{
              transform: `rotate(${(northAngle ?? 0) + rotation}deg)`,
            }}
          >
            <Compass size={16} className={hasValidWcs && Math.abs(rotation - (-northAngle!)) < 0.5 ? 'text-white' : 'text-text-secondary'} />
          </div>

          {/* North 'N' Badge at Tip of Needle */}
          {hasValidWcs && (
            <span
              className="absolute text-[8px] font-bold text-white transition-transform duration-300 pointer-events-none select-none"
              style={{
                transform: `rotate(${(northAngle ?? 0) + rotation}deg) translateY(-8px)`,
              }}
            >
              N
            </span>
          )}
        </button>
        <div className="flex flex-col border border-border-subtle bg-bg-surface/90 backdrop-blur rounded overflow-hidden">
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => zoomAtCenter(1.25)}
            className="p-1.5 hover:bg-bg-hover text-text-secondary hover:text-text-primary border-b border-border-subtle"
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => zoomAtCenter(1 / 1.25)}
            className="p-1.5 hover:bg-bg-hover text-text-secondary hover:text-text-primary border-b border-border-subtle"
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            aria-label="Fit observation to view"
            title="Fit observation to view (100% visible)"
            onClick={fitToViewport}
            className="p-1.5 hover:bg-bg-hover text-text-secondary hover:text-text-primary border-b border-border-subtle"
          >
            <Maximize2 size={13} />
          </button>
          {!observationMode && <button
            type="button"
            aria-label="Reset pan and zoom"
            title="Reset pan and zoom"
            onClick={fitToViewport}
            className="p-1.5 hover:bg-bg-hover text-text-secondary hover:text-text-primary"
          >
            <RotateCcw size={13} />
          </button>}
        </div>
      </div>
      )}

      {/* Bottom-Left Angular Scale Bar & Scientific Pixel Readout (Hidden in Minimal Mode) */}
      {!minimal && (
      <div className="absolute bottom-4 left-4 z-20 text-[11px] text-text-secondary space-y-2 pointer-events-none">
        {/* Real-time Scientific Cursor Readout HUD (Zero React Re-renders) */}
        <div
          ref={hudCardRef}
          className="bg-bg-surface/95 border border-border-strong rounded px-2.5 py-1.5 backdrop-blur shadow-lg space-y-1 transition-opacity duration-150 opacity-0 tabular-nums text-[11px]"
        >
          {/* Surface Brightness Value */}
          <div className="flex items-center space-x-1.5">
            <span className="text-[10px] text-text-tertiary uppercase tracking-wider font-semibold">
              Surface Brightness:
            </span>
            <span ref={hudFluxRef} className="font-bold text-text-primary text-[12px]">
              —
            </span>
          </div>

          {/* Pixel and Celestial WCS Coordinates */}
          <div className="flex items-center space-x-3 text-[10px] text-text-secondary">
            <div>
              <span className="text-text-tertiary mr-1">Pixel:</span>
              <span ref={hudPixelRef} className="text-text-primary font-medium">
                —
              </span>
            </div>
            {!observationMode && <div className="border-l border-border-subtle pl-2">
              <span className="text-text-tertiary mr-1">WCS:</span>
              <span ref={hudWcsRef} className="text-text-primary font-medium">
                —
              </span>
            </div>}
          </div>
        </div>

        {/* Physical Scale Bar */}
        {!observationMode && <div className="space-y-0.5">
          <div className="text-[10px] text-text-secondary">2 arcmin (120")</div>
          <div
            className="h-[2px] bg-white transition-all duration-75"
            style={{ width: `${Math.min(180, Math.max(20, barCanvasWidth))}px` }}
          />
        </div>}
      </div>
      )}

      {/* Selected Star Inspector Pill (Click any red circle in FITS image -> Analyze Wavelengths) */}
      {showCatalog && catalogError && <p role="alert" className="absolute top-14 left-3 text-xs text-text-secondary">{catalogError}</p>}
      {!minimal && !loading && !loadingCatalog && selectedSource && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 bg-[#0B0D11]/95 border border-[#1C2029] rounded-xl px-3.5 py-2 shadow-2xl backdrop-blur-md flex items-center space-x-3 text-[11px] select-none"
        >
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-red-500/30 shrink-0" />
            <div className="flex flex-col">
              <div className="flex items-center space-x-1.5">
                <span className="text-white font-semibold truncate max-w-[180px]">
                  {selectedSource.name}
                </span>
                <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#12151C] border border-[#1C2029] text-[#888E9B]">
                  {selectedSource.object_type}
                </span>
              </div>
              <div className="text-[10px] text-[#888E9B]">Catalog position · epoch unspecified · image match unverified</div>
              <div className="text-[10px] font-mono text-[#888E9B] tabular-nums">
                {(() => {
                  const { raStr, decStr } = formatCelestialCoordinates(selectedSource.ra_deg, selectedSource.dec_deg);
                  const magVal = selectedSource.mag_v ?? selectedSource.mag_g ?? selectedSource.mag_k;
                  const magStr = magVal != null ? ` · mag ${magVal.toFixed(1)}` : '';
                  return `${raStr} ${decStr} · px [${Math.round(selectedSource.pixel_x)}, ${Math.round(selectedSource.pixel_y)}]${magStr}`;
                })()}
              </div>
            </div>
          </div>

          {onAnalyzeSourceWavelengths && (
            <>
              <div className="w-px h-6 bg-[#1C2029]" />
              <button
                type="button"
                onClick={() => onAnalyzeSourceWavelengths(selectedSource)}
                className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/50 rounded-lg text-[11px] font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer shrink-0"
                title="Open measured wavelength samples for this catalog position"
              >
                <ExternalLink size={12} />
                <span>Analyze Wavelengths</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setSelectedSource(null)}
            className="p-1 text-[#888E9B] hover:text-white rounded transition-colors cursor-pointer"
            title="Clear selection"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Bottom-Right Scientific Range Readout & Optimization HUD (Hidden in Minimal Mode) */}
      {!minimal && !observationMode && cutout && cutout.width > 0 && (
        <div className="absolute bottom-4 right-4 z-20 text-[10px] text-text-secondary text-right bg-bg-surface/85 px-2.5 py-1.5 rounded border border-border-subtle backdrop-blur pointer-events-none tabular-nums shadow-sm select-none">
          <div className="flex items-center justify-end space-x-1.5 font-semibold text-text-primary">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            <span>CUTOUT {cutout.width} × {cutout.height} px</span>
            <span className="text-text-tertiary font-normal">({((cutout.width * 6.2) / 60).toFixed(1)}' FOV)</span>
          </div>
          <div className="text-[9px] text-text-tertiary mt-0.5">
            SURFACE: {cutout.min_flux_mjy_sr} – {cutout.max_flux_mjy_sr} {cutout.bunit || 'MJy/sr'} • 6.2"/px
          </div>
        </div>
      )}

      {/* Non-intrusive timeline buffering indicator during playback */}
      {!minimal && loading && isPlaying && (
        <div className="absolute top-4 left-4 z-30 bg-bg-surface/90 border border-border-subtle rounded px-2.5 py-1 text-[11px] text-text-secondary flex items-center space-x-2 backdrop-blur shadow select-none">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping inline-block" />
          <span>Buffering next frame...</span>
        </div>
      )}

      {/* Streamlined Minimalist Circular Download Indicator with Rock-Solid Fixed Dimensions */}
      {observationMode && loading && <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-30" role="status">
        <div className="flex items-center gap-3 text-sm text-text-secondary"><RefreshCw size={18} className="animate-spin" aria-hidden="true" /><span>Loading selected image…</span></div>
      </div>}
      {!minimal && !observationMode && loading && !isPlaying && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-6 z-30 select-none">
          <div className="w-[380px] h-[300px] bg-bg-surface border border-border-subtle rounded-xl p-6 shadow-2xl flex flex-col items-center justify-between text-center select-none">
            {/* Top: Circular Progress Ring */}
            <div className="relative w-20 h-20 flex items-center justify-center shrink-0">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                <circle
                  cx="40"
                  cy="40"
                  r="34"
                  stroke="#1C2029"
                  strokeWidth="4"
                  fill="transparent"
                />
                <circle
                  cx="40"
                  cy="40"
                  r="34"
                  stroke="#FFFFFF"
                  strokeWidth="4"
                  strokeLinecap="round"
                  fill="transparent"
                  strokeDasharray="213.63"
                  strokeDashoffset={160}
                  className="transition-[stroke-dashoffset] duration-300 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center font-mono text-[15px] font-bold text-white tabular-nums">
                …
              </div>
            </div>

            {/* Middle: Rotating Helper Title Badge (Solid) & Text Below with Fixed Height */}
            <div className="w-full h-[76px] flex flex-col items-center justify-center space-y-1.5 shrink-0 overflow-hidden">
              <div
                className={`flex flex-col items-center space-y-1.5 transition-opacity duration-300 ${
                  helperFade ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <span
                  className={`text-[9px] uppercase tracking-wider font-extrabold px-2.5 py-0.5 rounded shadow-sm inline-flex items-center space-x-1 select-none ${
                    HELPER_ITEMS[helperIdx].tag === 'DEEP SPACE'
                      ? 'bg-amber-400 text-black'
                      : HELPER_ITEMS[helperIdx].tag === 'HINT'
                      ? 'bg-emerald-400 text-black'
                      : 'bg-sky-400 text-black'
                  }`}
                >
                  {HELPER_ITEMS[helperIdx].tag === 'DEEP SPACE' && <Radio size={10} className="stroke-[2.5]" />}
                  {HELPER_ITEMS[helperIdx].tag === 'HINT' && <HelpCircle size={10} className="stroke-[2.5]" />}
                  {HELPER_ITEMS[helperIdx].tag === 'FACT' && <Sparkles size={10} className="stroke-[2.5]" />}
                  <span>{HELPER_ITEMS[helperIdx].tag}</span>
                </span>

                <p className="text-[12px] text-text-secondary leading-snug max-w-[320px] text-center font-normal line-clamp-2">
                  {HELPER_ITEMS[helperIdx].text}
                </p>
              </div>
            </div>

            {/* Bottom: Active Progress & Status Bar with Elapsed Time */}
            <div className="w-full pt-2 border-t border-border-subtle/60 flex items-center justify-between text-[10px] text-text-tertiary tabular-nums shrink-0">
              <span className="truncate pr-2">
                Loading selected archive image…
              </span>
              <span className="shrink-0 text-text-secondary font-mono">{elapsedSeconds}s</span>
            </div>
          </div>
        </div>
      )}

      {/* Honest Archive Error Overlay with Matching Fixed Dimensions */}
      {!observationMode && !loading && cutout?.status === 'error' && (
        <div className="absolute inset-0 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-6 z-30 select-none">
          <div className="w-[380px] h-[300px] bg-bg-surface border border-red-500/30 rounded-xl p-6 shadow-2xl flex flex-col items-center justify-between text-center select-none">
            <div className="flex flex-col items-center space-y-3 pt-2">
              <span className="bg-red-500 text-black font-extrabold text-[9px] uppercase tracking-wider px-2.5 py-0.5 rounded shadow-sm inline-flex items-center space-x-1">
                <AlertCircle size={10} className="stroke-[2.5]" />
                <span>ARCHIVE TIMEOUT</span>
              </span>

              <h3 className="font-semibold text-[13px] text-text-primary tracking-wide">
                Cutout Stream Interrupted
              </h3>

              <p className="text-[11px] text-text-secondary leading-relaxed max-w-[300px]">
                {cutout.message || 'NASA/IPAC IRSA archive timed out. Remote servers may be experiencing latency.'}
              </p>
            </div>

            <div className="w-full pt-2 border-t border-border-subtle/60 flex items-center justify-center">
              <button
                type="button"
                onClick={onRetry}
                className="px-4 py-2 bg-bg-raised hover:bg-bg-hover border border-border-subtle hover:border-border-strong text-text-primary text-[12px] font-medium rounded flex items-center space-x-2 transition-colors cursor-pointer shadow"
              >
                <RefreshCw size={13} />
                <span>Retry Download</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
