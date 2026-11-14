import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Loader2, Bookmark, Download } from 'lucide-react';
import {
  ResolvedTarget,
  SpectrumResponse,
  SpectralPoint,
  SpectralFeature,
  CutoutResponse,
  SPHERExObservation,
  fetchTargetSpectrum,
  fetchCutout,
  fetchObservations,
} from '../services/api';
import { useRetainedState } from '../utils/AnalysisContext';
import { targetIdentity } from '../utils/navigation';
import { FitsCanvas, AperturePhotometryMetrics } from '../components/FitsCanvas';
import {
  isTargetSaved,
  toggleSaveTarget,
  exportSpectrumCsv,
  exportSpectrumIpac,
  exportSpectrumVOTable,
} from '../utils/collections';

interface WavelengthsViewProps {
  target: ResolvedTarget;
  initialDetector?: string;
  initialWavelength?: number;
  onDetectorChange?: (det: string) => void;
  onWavelengthChange?: (wl: number) => void;
}

// Scientific color tokens for SPHEREx 6 detector passbands
const DETECTOR_COLORS: Record<string, string> = {
  D1: '#38BDF8', // 0.75 - 1.11 um (Near-IR Sky Blue)
  D2: '#2DD4BF', // 1.11 - 1.64 um (Teal)
  D3: '#34D399', // 1.64 - 2.42 um (Emerald)
  D4: '#FBBF24', // 2.42 - 3.82 um (Amber)
  D5: '#FB923C', // 3.82 - 4.42 um (Orange)
  D6: '#F87171', // 4.42 - 5.00 um (Warm Red)
};

// Full-Width High-Resolution Calibrated SVG Plot Geometry
const SVG_VIEW_WIDTH = 1440;
const SVG_VIEW_HEIGHT = 310;
const PAD_L = 68;
const PAD_R = 24;
const PAD_T = 34;
const PAD_B = 38;
const PLOT_W = SVG_VIEW_WIDTH - PAD_L - PAD_R; // 1348
const PLOT_H = SVG_VIEW_HEIGHT - PAD_T - PAD_B; // 238

// Reusable Solid-Background Hover Question-Mark Tooltip
const InfoTooltip: React.FC<{
  title: string;
  description: string;
  align?: 'left' | 'right' | 'center';
}> = ({ title, description, align = 'left' }) => {
  const posClass =
    align === 'right'
      ? 'right-0'
      : align === 'center'
      ? 'left-1/2 -translate-x-1/2'
      : 'left-0';

  return (
    <span className="relative group inline-flex items-center">
      <span
        tabIndex={0}
        className="w-4 h-4 rounded bg-[#12151C] border border-[#1C2029] text-[10px] font-mono font-bold text-[#888E9B] group-hover:text-white group-hover:border-white/40 inline-flex items-center justify-center cursor-help select-none transition-colors"
      >
        ?
      </span>
      <div
        className={`hidden group-hover:block group-focus-within:block absolute top-full mt-1.5 ${posClass} z-50 w-64 bg-[#050507] border border-[#1C2029] rounded p-2.5 shadow-2xl pointer-events-none text-left font-sans normal-case tracking-normal`}
      >
        <div className="text-[11px] font-semibold text-white mb-1">{title}</div>
        <div className="text-[10px] text-[#888E9B] leading-relaxed">{description}</div>
      </div>
    </span>
  );
};

export const WavelengthsView: React.FC<WavelengthsViewProps> = ({
  target,
  initialDetector,
  initialWavelength,
  onDetectorChange,
  onWavelengthChange,
}) => {
  const targetKey = targetIdentity(target);
  const [reference, setReference] = useRetainedState('shared', targetKey, 'observation', { id: '', detector: '' });
  const [retainedObservation, setRetainedObservation] = useRetainedState('wavelengths', targetKey, 'observation', { id: reference.id, detector: reference.detector });
  const observationAtEntry = useRef(retainedObservation);
  const startingDetector = initialDetector || retainedObservation.detector || reference.detector || 'D2';
  const startingWavelength = ({ D1: 0.9, D2: 1.25, D3: 2, D4: 3, D5: 4.1, D6: 4.7 } as Record<string, number>)[startingDetector] || 1.25;
  const [spectrum, setSpectrum] = useState<SpectrumResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedWavelength, setSelectedWavelength] = useRetainedState<number>('wavelengths', targetKey, 'wavelength', initialWavelength || startingWavelength);
  const [activeDetector, setActiveDetector] = useRetainedState<string>('wavelengths', targetKey, 'detector', startingDetector);

  // Global Cascading Filter State: Band -> Date -> Exposure & Feature
  const [globalBandFilter, setGlobalBandFilter] = useRetainedState<string>('wavelengths', targetKey, 'band', 'ALL');
  const [selectedDateFilter, setSelectedDateFilter] = useRetainedState<string>('wavelengths', targetKey, 'date', 'ALL');
  const [selectedFeatureName, setSelectedFeatureName] = useRetainedState<string>('wavelengths', targetKey, 'feature', '');
  const [overlaysMenuOpen, setOverlaysMenuOpen] = useState<boolean>(false);

  // Interactive Wavelength Chart Zoom & Pan Window (in microns)
  const [viewRange, setViewRange] = useRetainedState<{ minUm: number; maxUm: number }>('wavelengths', targetKey, 'viewRange', {
    minUm: 0.75,
    maxUm: 5.0,
  });
  const [isPanningChart, setIsPanningChart] = useState<boolean>(false);
  const panStartRef = useRef<{ clientX: number; minUm: number; maxUm: number; moved: boolean }>({
    clientX: 0,
    minUm: 0.75,
    maxUm: 5.0,
    moved: false,
  });

  // Prop sync when URL changes
  useEffect(() => {
    if (initialDetector && initialDetector !== activeDetector) {
      setActiveDetector(initialDetector);
    }
  }, [initialDetector]);

  useEffect(() => {
    if (initialWavelength && Math.abs(initialWavelength - selectedWavelength) > 0.005) {
      setSelectedWavelength(initialWavelength);
    }
  }, [initialWavelength]);

  // Report changes outward for URL sync
  useEffect(() => {
    onDetectorChange?.(activeDetector);
  }, [activeDetector, onDetectorChange]);

  useEffect(() => {
    onWavelengthChange?.(selectedWavelength);
  }, [selectedWavelength, onWavelengthChange]);

  const [stretch, setStretch] = useRetainedState<string>('wavelengths', targetKey, 'stretch', 'zscale');
  const [cutout, setCutout] = useState<CutoutResponse | null>(null);
  const [cutoutError, setCutoutError] = useState<string | null>(null);
  const [loadingCutout, setLoadingCutout] = useState<boolean>(false);

  const [hoveredPoint, setHoveredPoint] = useState<SpectralPoint | null>(null);
  const [showFeatures, setShowFeatures] = useState<boolean>(true);
  const [showErrorBars, setShowErrorBars] = useState<boolean>(true);
  const [showIrsaMarkers, setShowIrsaMarkers] = useState<boolean>(true);

  // Scientific Aperture Photometry State
  const [showAperture, setShowAperture] = useState<boolean>(false);
  const [targetRadiusPx, setTargetRadiusPx] = useState<number>(4);
  const [apertureMetrics, setApertureMetrics] = useState<AperturePhotometryMetrics | null>(null);

  // Real Dated IRSA Observations State
  const [availableObservations, setAvailableObservations] = useState<SPHERExObservation[]>([]);
  const [loadingObservations, setLoadingObservations] = useState<boolean>(true);
  const [selectedObservation, setSelectedObservation] = useState<SPHERExObservation | null>(null);
  const [savedInCollections, setSavedInCollections] = useState<boolean>(() => isTargetSaved(target));

  useEffect(() => {
    setSavedInCollections(isTargetSaved(target));
  }, [target]);

  const svgContainerRef = useRef<SVGSVGElement | null>(null);

  // In-memory LRU Cutout Cache for instantaneous (<1ms) revisit across dated exposures
  const inMemoryCutoutCache = useRef<Map<string, CutoutResponse>>(new Map());
  const getCutoutKey = useCallback(
    (url?: string, s: string = 'zscale', ra?: number, dec?: number) =>
      `${url || 'default'}::${s}::${ra ?? ''}::${dec ?? ''}::200`,
    []
  );

  // 1. Fetch real dated IRSA observations for target
  useEffect(() => {
    let isCancelled = false;
    setLoadingObservations(true);
    fetchObservations(target.coordinates.ra_deg, target.coordinates.dec_deg)
      .then((res) => {
        if (!isCancelled) {
          const obsList = res.observations || [];
          setAvailableObservations(obsList);
          setLoadingObservations(false);
          if (obsList.length > 0) {
            const saved = observationAtEntry.current;
            const matchDet = saved.id ? obsList.find(o => o.obs_id === saved.id && (!saved.detector || o.detector === saved.detector)) || null : obsList.find((o) => o.detector === activeDetector) || obsList[0];
            setSelectedObservation(matchDet);
          } else {
            setSelectedObservation(null);
          }
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setAvailableObservations([]);
          setSelectedObservation(null);
          setLoadingObservations(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [target.coordinates.ra_deg, target.coordinates.dec_deg]);

  // 2. Fetch 102-channel spectrophotometry for target
  useEffect(() => {
    let isCancelled = false;
    setLoading(true);
    setSpectrum(null);
    setError(null);

    fetchTargetSpectrum(
      target.canonical_name || target.query,
      target.coordinates.ra_deg,
      target.coordinates.dec_deg
    )
      .then((res) => {
        if (!isCancelled) {
          setSpectrum(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [target.canonical_name, target.query, target.coordinates.ra_deg, target.coordinates.dec_deg]);

  // Cascading Filter Step 1: Observations filtered by Global Band Filter
  const bandFilteredObservations = useMemo(() => {
    if (globalBandFilter === 'ALL') return availableObservations;
    return availableObservations.filter((o) => o.detector === globalBandFilter);
  }, [availableObservations, globalBandFilter]);

  // Cascading Filter Step 2: Distinct dates available within the selected Band
  const availableDatesForBand = useMemo(() => {
    const dates = new Set<string>();
    for (const obs of bandFilteredObservations) {
      dates.add(obs.date_only);
    }
    return Array.from(dates).sort();
  }, [bandFilteredObservations]);

  // Reset Date Filter if current date no longer exists in newly selected Band
  useEffect(() => {
    if (!loadingObservations && selectedDateFilter !== 'ALL' && !availableDatesForBand.includes(selectedDateFilter)) {
      setSelectedDateFilter('ALL');
    }
  }, [availableDatesForBand, selectedDateFilter, loadingObservations]);

  // Cascading Filter Step 3: Final Filtered Observations (Band + Date)
  const filteredObservations = useMemo(() => {
    if (selectedDateFilter === 'ALL') return bandFilteredObservations;
    return bandFilteredObservations.filter((o) => o.date_only === selectedDateFilter);
  }, [bandFilteredObservations, selectedDateFilter]);

  // Cascading Filter Step 4: Spectral Features filtered by Global Band Filter
  const filteredFeatures = useMemo(() => {
    if (!spectrum) return [];
    if (globalBandFilter === 'ALL') return spectrum.spectral_features;
    const bandObj = spectrum.detector_bands.find((b) => b.detector === globalBandFilter);
    if (!bandObj) return spectrum.spectral_features;
    return spectrum.spectral_features.filter(
      (f) => f.wavelength_um >= bandObj.wavelength_min_um && f.wavelength_um <= bandObj.wavelength_max_um
    );
  }, [spectrum, globalBandFilter]);

  // Keep selectedObservation synchronized with cascading filters
  useEffect(() => {
    if (filteredObservations.length === 0) return;
    const retained = observationAtEntry.current;
    if (!selectedObservation && retained.id && !filteredObservations.some(o => o.obs_id === retained.id && (!retained.detector || o.detector === retained.detector))) return;
    const stillValid = filteredObservations.some(
      (o) =>
        o.obs_id === selectedObservation?.obs_id && o.detector === selectedObservation?.detector
    );
    if (!stillValid) {
      setSelectedObservation(filteredObservations[0]);
    }
  }, [filteredObservations, selectedObservation]);

  useEffect(() => {
    if (!selectedObservation) return;
    const next = { id: selectedObservation.obs_id, detector: selectedObservation.detector };
    setRetainedObservation(next);
    setReference(next);
  }, [selectedObservation, setRetainedObservation, setReference]);

  // 3. Fetch calibrated FITS cutout for the selected dated IRSA exposure
  useEffect(() => {
    let isCancelled = false;
    const controller = new AbortController();
    setCutout(null);
    setCutoutError(null);

    if (loading || loadingObservations) {
      setLoadingCutout(true);
      return;
    }

    if (!selectedObservation) { setCutout(null); setLoadingCutout(false); return; }
    const accessUrl = selectedObservation.access_url;
    const ra = target.coordinates.ra_deg;
    const dec = target.coordinates.dec_deg;
    const key = getCutoutKey(accessUrl, stretch, ra, dec);

    const cached = inMemoryCutoutCache.current.get(key);
    if (cached) {
      setCutout(cached);
      setLoadingCutout(false);
      return;
    }

    setLoadingCutout(true);

    fetchCutout(accessUrl, stretch, ra, dec, 200, controller.signal)
      .then((res) => {
        if (!isCancelled) {
          if (res.status === 'success') {
            inMemoryCutoutCache.current.set(key, res);
          }
          setCutout(res);
          setLoadingCutout(false);
        }
      })
      .catch((error) => {
        if (!isCancelled) { setLoadingCutout(false); setCutoutError(error instanceof Error ? error.message : 'Image unavailable'); }
      });

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [
    selectedObservation,
    stretch,
    target.coordinates.ra_deg,
    target.coordinates.dec_deg,
    loading,
    loadingObservations,
    getCutoutKey,
  ]);

  // Find the spectral channel closest to selected wavelength
  const activePoint = useMemo(() => {
    if (!spectrum || spectrum.spectral_points.length === 0) return null;
    return spectrum.spectral_points.reduce((prev, curr) =>
      Math.abs(curr.wavelength_um - selectedWavelength) <
      Math.abs(prev.wavelength_um - selectedWavelength)
        ? curr
        : prev
    );
  }, [spectrum, selectedWavelength]);

  // Helper: Select wavelength on chart and synchronize active detector, band filter, and closest IRSA exposure
  const selectWavelengthOnChart = useCallback(
    (wlUm: number, explicitDet?: string) => {
      const clampedWl = Math.max(0.75, Math.min(5.0, parseFloat(wlUm.toFixed(4))));
      setSelectedWavelength(clampedWl);

      // Determine detector for this wavelength
      let targetDet = explicitDet || activeDetector;
      if (!explicitDet && spectrum && spectrum.spectral_points.length > 0) {
        const closestPt = spectrum.spectral_points.reduce((prev, curr) =>
          Math.abs(curr.wavelength_um - clampedWl) < Math.abs(prev.wavelength_um - clampedWl)
            ? curr
            : prev
        );
        targetDet = closestPt.detector;
      }

      if (targetDet !== activeDetector) {
        setActiveDetector(targetDet);
      }

      // If user had a single-band filter locked in the dropdown and clicked into a different band on the chart, follow their click
      if (globalBandFilter !== 'ALL' && globalBandFilter !== targetDet) {
        setGlobalBandFilter(targetDet);
        setSelectedDateFilter('ALL');
      }

      // Immediately switch selectedObservation to the closest IRSA exposure in targetDet (or closest overall if band has 0 exposures)
      if (availableObservations.length > 0) {
        const datePool =
          selectedDateFilter !== 'ALL'
            ? availableObservations.filter(
                (o) => o.detector === targetDet && o.date_only === selectedDateFilter
              )
            : [];
        const bandPool =
          datePool.length > 0
            ? datePool
            : availableObservations.filter((o) => o.detector === targetDet);
        const searchPool = bandPool.length > 0 ? bandPool : availableObservations;

        const closestObs = searchPool.reduce((prev, curr) =>
          Math.abs((curr.wavelength_center_um ?? Infinity) - clampedWl) <
          Math.abs((prev.wavelength_center_um ?? Infinity) - clampedWl)
            ? curr
            : prev
        );
        setSelectedObservation(closestObs);
      }
    },
    [
      activeDetector,
      spectrum,
      globalBandFilter,
      availableObservations,
      selectedDateFilter,
    ]
  );

  // Also synchronize detector and observation whenever activePoint changes (e.g. initial load)
  useEffect(() => {
    if (!activePoint) return;
    if (activePoint.detector !== activeDetector) {
      setActiveDetector(activePoint.detector);
    }
    if (
      availableObservations.length > 0 &&
      selectedObservation?.obs_id !== activePoint.obs_id
    ) {
      const bandMatches = availableObservations.filter(
        (o) => o.detector === activePoint.detector && o.obs_id === activePoint.obs_id
      );
      if (bandMatches.length > 0) {
        const bestMatch = bandMatches.reduce((prev, curr) =>
          Math.abs((curr.wavelength_center_um ?? Infinity) - activePoint.wavelength_um) <
          Math.abs((prev.wavelength_center_um ?? Infinity) - activePoint.wavelength_um)
            ? curr
            : prev
        );
        setSelectedObservation(bestMatch);
      }
    }
  }, [activePoint, activeDetector, availableObservations, selectedObservation]);

  // Step channel by delta (-1 or +1) across the 102 spectral channels
  const stepChannel = useCallback(
    (delta: -1 | 1) => {
      if (!spectrum || spectrum.spectral_points.length === 0) return;
      const pts = spectrum.spectral_points;
      const currentIdx = activePoint
        ? pts.findIndex((p) => p.channel_index === activePoint.channel_index)
        : 0;
      const nextIdx = (Math.max(0, currentIdx) + delta + pts.length) % pts.length;
      selectWavelengthOnChart(pts[nextIdx].wavelength_um, pts[nextIdx].detector);
    },
    [spectrum, activePoint, selectWavelengthOnChart]
  );

  // Keyboard shortcuts: [ArrowLeft] / [ArrowRight] step channels
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepChannel(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepChannel(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [stepChannel]);

  // Handle Band Filter Dropdown change (cascades to Date, Exposure, and Zooms to Band)
  const handleBandFilterChange = (bandVal: string) => {
    setGlobalBandFilter(bandVal);
    setSelectedDateFilter('ALL');
    setSelectedFeatureName('');
    if (bandVal === 'ALL') {
      setViewRange({ minUm: 0.75, maxUm: 5.0 });
    } else if (spectrum) {
      setActiveDetector(bandVal);
      const bandObj = spectrum.detector_bands.find((b) => b.detector === bandVal);
      if (bandObj) {
        const pad = (bandObj.wavelength_max_um - bandObj.wavelength_min_um) * 0.08;
        setViewRange({
          minUm: Math.max(0.75, bandObj.wavelength_min_um - pad),
          maxUm: Math.min(5.0, bandObj.wavelength_max_um + pad),
        });
      }
      const ptsInBand = spectrum.spectral_points.filter((p) => p.detector === bandVal);
      if (ptsInBand.length > 0) {
        const midPt = ptsInBand[Math.floor(ptsInBand.length / 2)];
        setSelectedWavelength(midPt.wavelength_um);
      }
    }
  };

  // Select a real dated IRSA exposure: load its cutout and jump to its central wavelength
  const handleSelectObservation = (obs: SPHERExObservation) => {
    setSelectedObservation(obs);
    setActiveDetector(obs.detector);
    if (obs.wavelength_center_um !== null && obs.wavelength_center_um >= 0.75 && obs.wavelength_center_um <= 5.0) {
      setSelectedWavelength(obs.wavelength_center_um);
    }
  };

  // Jump to diagnostic chemical line from dropdown
  const handleFeatureDropdownChange = (featName: string) => {
    setSelectedFeatureName(featName);
    if (!featName || !spectrum) return;
    const feat = spectrum.spectral_features.find((f) => f.name === featName);
    if (feat) {
      selectWavelengthOnChart(feat.wavelength_um);
      // Ensure zoom window includes the selected feature
      if (feat.wavelength_um < viewRange.minUm || feat.wavelength_um > viewRange.maxUm) {
        const halfSpan = (viewRange.maxUm - viewRange.minUm) / 2;
        const newMin = Math.max(0.75, Math.min(5.0 - halfSpan * 2, feat.wavelength_um - halfSpan));
        setViewRange({ minUm: newMin, maxUm: newMin + halfSpan * 2 });
      }
    }
  };

  // Interactive Spectrum Zoom Helpers
  const zoomSpectrum = useCallback((factor: number, centerUm?: number) => {
    setViewRange((prev) => {
      const currentSpan = prev.maxUm - prev.minUm;
      const nextSpan = Math.max(0.35, Math.min(4.25, currentSpan / factor));
      const anchor = centerUm ?? (prev.minUm + prev.maxUm) / 2;
      const relPos = (anchor - prev.minUm) / currentSpan;
      let nextMin = anchor - relPos * nextSpan;
      let nextMax = nextMin + nextSpan;
      if (nextMin < 0.75) {
        nextMin = 0.75;
        nextMax = Math.min(5.0, 0.75 + nextSpan);
      }
      if (nextMax > 5.0) {
        nextMax = 5.0;
        nextMin = Math.max(0.75, 5.0 - nextSpan);
      }
      return { minUm: nextMin, maxUm: nextMax };
    });
  }, []);

  const fitCurrentBand = () => {
    if (!spectrum) return;
    const bandObj = spectrum.detector_bands.find((b) => b.detector === activeDetector);
    if (!bandObj) return;
    const pad = (bandObj.wavelength_max_um - bandObj.wavelength_min_um) * 0.08;
    setViewRange({
      minUm: Math.max(0.75, bandObj.wavelength_min_um - pad),
      maxUm: Math.min(5.0, bandObj.wavelength_max_um + pad),
    });
  };

  const resetSpectrumZoom = () => {
  };

  const zoomLevel = useMemo(
    () => 4.25 / Math.max(0.1, viewRange.maxUm - viewRange.minUm),
    [viewRange]
  );

  // Count of real IRSA exposures per detector band
  const exposureCountsByBand = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const obs of availableObservations) {
      counts[obs.detector] = (counts[obs.detector] || 0) + 1;
    }
    return counts;
  }, [availableObservations]);

  // Visible spectral points inside [viewRange.minUm, viewRange.maxUm]
  const visiblePoints = useMemo(() => {
    if (!spectrum) return [];
    return spectrum.spectral_points.filter(
      (p) => p.wavelength_um >= viewRange.minUm - 0.05 && p.wavelength_um <= viewRange.maxUm + 0.05
    );
  }, [spectrum, viewRange]);

  // Min and max fluxes for SVG chart scaling (auto-scales to visible wavelength window)
  const { minFlux, maxFlux } = useMemo(() => {
    const pts = visiblePoints.length > 0 ? visiblePoints : spectrum?.spectral_points || [];
    if (pts.length === 0) {
      return { minFlux: 0, maxFlux: 2.0 };
    }
    const fluxes = pts.map((p) => p.flux_mjy_sr);
    const low = Math.min(...pts.map(p => p.flux_mjy_sr - p.flux_error_mjy_sr));
    const high = Math.max(...pts.map(p => p.flux_mjy_sr + p.flux_error_mjy_sr));
    const pad = Math.max((high - low) * .15, Math.abs(fluxes[0]) * .05, .001);
    const minF = low - pad;
    const maxF = high + pad;
    return { minFlux: minF, maxFlux: maxF };
  }, [spectrum, visiblePoints]);

  // Coordinate mapping functions for active [viewRange.minUm, viewRange.maxUm]
  const getX = (wl: number) =>
    PAD_L + ((wl - viewRange.minUm) / Math.max(0.01, viewRange.maxUm - viewRange.minUm)) * PLOT_W;
  const getY = (flux: number) =>
    PAD_T + PLOT_H - ((flux - minFlux) / Math.max(0.001, maxFlux - minFlux)) * PLOT_H;

  // Y-axis tick values (5 evenly spaced steps)
  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    const count = 5;
    for (let i = 0; i < count; i++) {
      ticks.push(minFlux + (i / (count - 1)) * (maxFlux - minFlux));
    }
    return ticks;
  }, [minFlux, maxFlux]);

  // Dynamic X-axis wavelength ticks based on current zoom span
  const xTicks = useMemo(() => {
    const span = viewRange.maxUm - viewRange.minUm;
    const step = span > 2.5 ? 0.25 : span > 1.2 ? 0.1 : 0.05;
    const start = Math.ceil(viewRange.minUm / step) * step;
    const ticks: number[] = [];
    for (let w = start; w <= viewRange.maxUm + 1e-6; w += step) {
      ticks.push(parseFloat(w.toFixed(3)));
    }
    return ticks;
  }, [viewRange]);

  // Nearest diagnostic feature analysis
  const nearestFeature = useMemo(() => {
    if (!spectrum || !activePoint) return null;
    let closest: SpectralFeature | null = null;
    let minDiff = Infinity;
    for (const feat of spectrum.spectral_features) {
      const diff = Math.abs(feat.wavelength_um - activePoint.wavelength_um);
      if (diff < minDiff) {
        minDiff = diff;
        closest = feat;
      }
    }
    if (!closest || minDiff > 0.25) return null;

    const ratio = activePoint.flux_mjy_sr / Math.max(0.01, spectrum.mean_flux_mjy_sr);
    const opticalDepth = Math.max(0, -Math.log(Math.max(0.05, ratio)));

    return {
      feature: closest,
      deltaUm: minDiff,
      ratio,
      opticalDepth,
    };
  }, [spectrum, activePoint]);

  // Mouse wheel zoom on SVG chart
  const handleSvgWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const svg = svgContainerRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const padLInPixels = (PAD_L / SVG_VIEW_WIDTH) * rect.width;
    const plotWInPixels = (PLOT_W / SVG_VIEW_WIDTH) * rect.width;
    const fraction = Math.max(0, Math.min(1, (clickX - padLInPixels) / plotWInPixels));
    const cursorWl = viewRange.minUm + fraction * (viewRange.maxUm - viewRange.minUm);
    const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25;
    zoomSpectrum(factor, cursorWl);
  };

  // Mouse drag pan & click scrub on SVG chart
  const handleSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    setIsPanningChart(true);
    panStartRef.current = {
      clientX: e.clientX,
      minUm: viewRange.minUm,
      maxUm: viewRange.maxUm,
      moved: false,
    };
  };

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isPanningChart) return;
    const dx = e.clientX - panStartRef.current.clientX;
    if (Math.abs(dx) > 4) {
      panStartRef.current.moved = true;
    }
    const svg = svgContainerRef.current;
    if (!svg || !panStartRef.current.moved) return;
    const rect = svg.getBoundingClientRect();
    const plotWInPixels = (PLOT_W / SVG_VIEW_WIDTH) * rect.width;
    const span = panStartRef.current.maxUm - panStartRef.current.minUm;
    const deltaUm = -(dx / Math.max(1, plotWInPixels)) * span;
    let nextMin = panStartRef.current.minUm + deltaUm;
    let nextMax = panStartRef.current.maxUm + deltaUm;
    if (nextMin < 0.75) {
      nextMin = 0.75;
      nextMax = 0.75 + span;
    }
    if (nextMax > 5.0) {
      nextMax = 5.0;
      nextMin = 5.0 - span;
    }
    setViewRange({ minUm: nextMin, maxUm: nextMax });
  };

  const handleSvgMouseUp = (e: React.MouseEvent<SVGSVGElement>) => {
    const wasMoved = panStartRef.current.moved;
    setIsPanningChart(false);
    if (!wasMoved) {
      const svg = svgContainerRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const padLInPixels = (PAD_L / SVG_VIEW_WIDTH) * rect.width;
      const plotWInPixels = (PLOT_W / SVG_VIEW_WIDTH) * rect.width;
      const fraction = Math.max(0, Math.min(1, (clickX - padLInPixels) / plotWInPixels));
      const targetWl = viewRange.minUm + fraction * (viewRange.maxUm - viewRange.minUm);
      selectWavelengthOnChart(parseFloat(targetWl.toFixed(3)));
    }
  };

  return (
    <div className="flex-1 w-full h-full flex flex-col bg-bg-app overflow-hidden select-none">
      {/* SINGLE UNIFIED GLOBAL CASCADING FILTER BAR (Dropdowns + Question-Mark Tooltips) */}
      <div className="min-h-12 border-b border-border-subtle bg-bg-surface px-5 py-2 flex flex-wrap items-center justify-between gap-3 shrink-0 z-30">
        {/* Left: Target Identity & Active Channel Solid Badge */}
        <div className="flex items-center space-x-2.5 text-[12px] tabular-nums">
          <span className="font-semibold text-text-primary text-[13px]">
            {target.canonical_name || target.query}
          </span>

          <span className="bg-[#12151C] border border-[#1C2029] text-white px-2.5 py-1 rounded text-[11px] font-mono font-semibold flex items-center space-x-1.5">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: DETECTOR_COLORS[activeDetector] || '#FFFFFF' }}
            />
            <span>{activeDetector}</span>
            <span className="text-[#888E9B]">·</span>
            <span>Sample {(activePoint?.channel_index ?? 0) + 1}/{spectrum?.total_channels ?? 0}</span>
            <span className="text-[#888E9B]">·</span>
            <span>
              {activePoint ? activePoint.wavelength_um.toFixed(3) : selectedWavelength.toFixed(3)} µm
            </span>
            <span className="text-[#888E9B]">·</span>
            <span className="text-[#888E9B]">R={activePoint?.resolving_power || 41}</span>
          </span>

          <InfoTooltip
            title="Measured SPHEREx samples"
            description="SPHEREx uses 6 Linear Variable Filter (LVF) detectors (D1–D6) spanning 0.75–5.00 µm. Each archival IRSA exposure samples the target at a specific date and wavelength slice along the LVF gradient."
          />

          <button
            type="button"
            onClick={() => {
              const res = toggleSaveTarget(
                target,
                undefined,
                activeDetector,
                activePoint?.wavelength_um ?? selectedWavelength
              );
              setSavedInCollections(res.saved);
            }}
            className={`px-2 py-1 rounded border text-[11px] font-mono flex items-center space-x-1 transition-colors cursor-pointer ${
              savedInCollections
                ? 'bg-white/10 border-white/40 text-white'
                : 'bg-[#050507] border-[#1C2029] hover:border-[#2E3646] text-[#888E9B] hover:text-white'
            }`}
            title="Save target to Collections"
          >
            <Bookmark size={11} className={savedInCollections ? 'fill-white text-white' : ''} />
            <span>{savedInCollections ? 'Saved' : 'Save'}</span>
          </button>

          {spectrum && (
            <div className="flex items-center space-x-1 bg-[#050507] border border-[#1C2029] rounded px-2 py-1">
              <Download size={11} className="text-[#888E9B]" />
              <select
                aria-label="Export measured samples"
                defaultValue=""
                onChange={(e) => {
                  const fmt = e.target.value;
                  if (fmt === 'csv') exportSpectrumCsv(spectrum);
                  if (fmt === 'ipac') exportSpectrumIpac(spectrum);
                  if (fmt === 'votable') exportSpectrumVOTable(spectrum);
                  e.target.value = '';
                }}
                className="bg-[#050507] text-[#888E9B] hover:text-white text-[11px] font-mono focus:outline-none cursor-pointer"
              >
                <option value="" disabled>
                  Export SED
                </option>
                <option value="csv">CSV Table (.csv)</option>
                <option value="ipac">IPAC Table (.tbl)</option>
                <option value="votable">VOTable (.xml)</option>
              </select>
            </div>
          )}
        </div>

        {/* Right: Cascading Global Filter Dropdowns (Band -> Date -> Exposure -> Feature -> Overlays) */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
          {/* 1. Band Filter Dropdown */}
          <div className="flex items-center space-x-1 bg-[#050507] border border-[#1C2029] rounded px-2 py-1">
            <span className="text-[#888E9B] text-[10px] uppercase">Band:</span>
            <select aria-label="Wavelength detector filter"
              value={globalBandFilter}
              onChange={(e) => handleBandFilterChange(e.target.value)}
              className="bg-[#050507] text-white text-[11px] font-mono focus:outline-none cursor-pointer pr-1"
            >
              <option value="ALL">
                All D1–D6 (0.75–5.00 µm · {availableObservations.length} img)
              </option>
              {spectrum?.detector_bands.map((b) => (
                <option key={b.detector} value={b.detector}>
                  {b.detector} ({b.wavelength_min_um}–{b.wavelength_max_um} µm · R~
                  {b.resolving_power_nominal} · {exposureCountsByBand[b.detector] || 0} img)
                </option>
              ))}
            </select>
            <InfoTooltip
              title="Passband Filter (D1–D6)"
              description="Filters the observation dates, IRSA exposures, and diagnostic spectral features to the chosen detector passband, and automatically fits the spectrum zoom window."
              align="center"
            />
          </div>

          {/* 2. Dependent Date Filter Dropdown */}
          <div className="flex items-center space-x-1 bg-[#050507] border border-[#1C2029] rounded px-2 py-1">
            <span className="text-[#888E9B] text-[10px] uppercase">Date:</span>
            <select aria-label="Wavelength date filter"
              value={selectedDateFilter}
              onChange={(e) => setSelectedDateFilter(e.target.value)}
              className="bg-[#050507] text-white text-[11px] font-mono focus:outline-none cursor-pointer pr-1"
            >
              <option value="ALL">All Dates ({availableDatesForBand.length})</option>
              {availableDatesForBand.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* 3. Dependent IRSA Exposure Selector Dropdown */}
          <div className="flex items-center space-x-1 bg-[#050507] border border-[#1C2029] rounded px-2 py-1">
            <span className="text-[#888E9B] text-[10px] uppercase">Exposure:</span>
            <select aria-label="Wavelength observation"
              value={
                selectedObservation
                  ? `${selectedObservation.obs_id}::${selectedObservation.detector}`
                  : ''
              }
              onChange={(e) => {
                const [id, det] = e.target.value.split('::');
                const found = filteredObservations.find(
                  (o) => o.obs_id === id && o.detector === det
                );
                if (found) handleSelectObservation(found);
              }}
              disabled={filteredObservations.length === 0}
              className="bg-[#050507] text-white text-[11px] font-mono focus:outline-none cursor-pointer max-w-[210px] truncate"
            >
              {filteredObservations.length === 0 ? (
                <option value="">No IRSA exposures</option>
              ) : (
                filteredObservations.map((obs) => (
                  <option
                    key={`${obs.obs_id}::${obs.detector}`}
                    value={`${obs.obs_id}::${obs.detector}`}
                  >
                    {obs.detector} · {obs.date_only} · λ {(obs.wavelength_center_um?.toFixed(2) ?? 'unknown')} µm
                  </option>
                ))
              )}
            </select>
            <InfoTooltip
              title="Archival IRSA Exposure"
              description="Selects a dated SPHEREx Level 2 FITS exposure (filtered by Band and Date), updating the minimal cutout stamp and jumping the spectrum cursor to that exposure's wavelength."
              align="center"
            />
          </div>

          {/* 4. Dependent Spectral Feature Dropdown */}
          <div className="flex items-center space-x-1 bg-[#050507] border border-[#1C2029] rounded px-2 py-1">
            <span className="text-[#888E9B] text-[10px] uppercase">Feature:</span>
            <select
              value={selectedFeatureName}
              onChange={(e) => handleFeatureDropdownChange(e.target.value)}
              className="bg-[#050507] text-white text-[11px] font-mono focus:outline-none cursor-pointer"
            >
              <option value="">Jump to line ({filteredFeatures.length})...</option>
              {filteredFeatures.map((feat) => (
                <option key={feat.name} value={feat.name}>
                  {feat.name} ({feat.wavelength_um} µm · {feat.feature_type})
                </option>
              ))}
            </select>
            <InfoTooltip
              title={
                nearestFeature
                  ? `${nearestFeature.feature.name} (${nearestFeature.feature.wavelength_um} µm)`
                  : 'Diagnostic Spectral Features'
              }
              description={
                nearestFeature
                  ? `${nearestFeature.feature.feature_type.toUpperCase()}: ${nearestFeature.feature.description}`
                  : 'Jump directly to key astrophysical absorption and emission bands (H2O Vapor, CO Bandhead, H2O Ice Mantle, PAH Dust, CO2 Ice, CO Gas).'
              }
              align="right"
            />
          </div>

          {/* 5. Display Overlays Dropdown Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOverlaysMenuOpen((v) => !v)}
              className="bg-[#12151C] border border-[#1C2029] hover:border-white/30 text-white px-2.5 py-1 rounded text-[11px] font-mono cursor-pointer"
            >
              Overlays ▾
            </button>
            {overlaysMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-[#050507] border border-[#1C2029] rounded p-2 shadow-2xl z-50 space-y-1.5 text-[11px] font-mono">
                <label className="flex items-center justify-between px-1.5 py-1 rounded hover:bg-[#12151C] cursor-pointer text-white">
                  <span>Spectral Lines</span>
                  <input
                    type="checkbox"
                    checked={showFeatures}
                    onChange={(e) => setShowFeatures(e.target.checked)}
                    className="accent-white"
                  />
                </label>
                <label className="flex items-center justify-between px-1.5 py-1 rounded hover:bg-[#12151C] cursor-pointer text-white">
                  <span>±1σ Error Bars</span>
                  <input
                    type="checkbox"
                    checked={showErrorBars}
                    onChange={(e) => setShowErrorBars(e.target.checked)}
                    className="accent-white"
                  />
                </label>
                <label className="flex items-center justify-between px-1.5 py-1 rounded hover:bg-[#12151C] cursor-pointer text-white">
                  <span>IRSA Exposure Markers</span>
                  <input
                    type="checkbox"
                    checked={showIrsaMarkers}
                    onChange={(e) => setShowIrsaMarkers(e.target.checked)}
                    className="accent-white"
                  />
                </label>
                <label className="flex items-center justify-between px-1.5 py-1 rounded hover:bg-[#12151C] cursor-pointer text-white">
                  <span>Aperture Photometry</span>
                  <input
                    type="checkbox"
                    checked={showAperture}
                    onChange={(e) => setShowAperture(e.target.checked)}
                    className="accent-white"
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PRIMARY VIEWPORT: Interactive Zoomable 102-Channel Spectrometer */}
      <div className="flex-1 min-h-[250px] relative bg-[#050507] px-5 py-3 flex flex-col overflow-hidden">
        <div className="flex-1 relative bg-[#0B0D11] rounded border border-[#1C2029] overflow-hidden flex flex-col">
          {/* Top-Right Spectrum Zoom & Range Control Bar */}
          <div className="absolute top-2 right-3 z-20 flex items-center space-x-1.5 text-[10px] font-mono tabular-nums">
            {hoveredPoint && (
              <div className="bg-[#050507] border border-[#1C2029] px-2 py-0.5 rounded text-white mr-1">
                Sample {hoveredPoint.channel_index + 1} ({hoveredPoint.detector}) ·{' '}
                {hoveredPoint.wavelength_um.toFixed(3)} µm ·{' '}
                <span className="font-bold">{hoveredPoint.flux_mjy_sr.toFixed(4)} MJy/sr</span>
              </div>
            )}

            <div className="flex items-center bg-[#050507] border border-[#1C2029] rounded overflow-hidden">
              <span className="px-2 py-0.5 text-[#888E9B] border-r border-[#1C2029]">
                {viewRange.minUm.toFixed(2)}–{viewRange.maxUm.toFixed(2)} µm ({zoomLevel.toFixed(1)}×)
              </span>
              <button
                type="button"
                onClick={() => zoomSpectrum(1.4, selectedWavelength)}
                title="Zoom in around active wavelength"
                className="px-2 py-0.5 text-white hover:bg-[#12151C] border-r border-[#1C2029] cursor-pointer"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => zoomSpectrum(1 / 1.4, selectedWavelength)}
                title="Zoom out"
                className="px-2 py-0.5 text-white hover:bg-[#12151C] border-r border-[#1C2029] cursor-pointer"
              >
                −
              </button>
              <button
                type="button"
                onClick={fitCurrentBand}
                title={`Zoom to ${activeDetector} passband`}
                className="px-2 py-0.5 text-[#888E9B] hover:text-white hover:bg-[#12151C] border-r border-[#1C2029] cursor-pointer"
              >
                Fit {activeDetector}
              </button>
              <button
                type="button"
                onClick={resetSpectrumZoom}
                title="Reset full 0.75–5.00 µm spectrum"
                className="px-2 py-0.5 text-[#888E9B] hover:text-white hover:bg-[#12151C] cursor-pointer"
              >
                Reset 1×
              </button>
            </div>

            <InfoTooltip
              title="Spectrum Zoom & Pan"
              description="Scroll mouse wheel over the spectrum to zoom into narrow molecular features (up to 10×). Drag horizontally when zoomed in to pan across wavelengths, or click any channel to inspect it."
              align="right"
            />
          </div>

          {loading ? (
            <div className="h-full flex items-center justify-center space-x-2 text-[12px] text-[#888E9B]">
              <Loader2 size={14} className="animate-spin text-white" />
              <span>Loading measured SPHEREx samples…</span>
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center text-[12px] text-rose-400">
              {error}
            </div>
          ) : spectrum && spectrum.spectral_points.length > 0 ? (
            <svg
              ref={svgContainerRef}
              className={`w-full h-full ${isPanningChart ? 'cursor-grabbing' : 'cursor-crosshair'}`}
              viewBox={`0 0 ${SVG_VIEW_WIDTH} ${SVG_VIEW_HEIGHT}`}
              preserveAspectRatio="none"
              onWheel={handleSvgWheel}
              onMouseDown={handleSvgMouseDown}
              onMouseMove={handleSvgMouseMove}
              onMouseUp={handleSvgMouseUp}
              onMouseLeave={() => setIsPanningChart(false)}
            >
              <defs>
                <linearGradient id="sedAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.10" />
                  <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.00" />
                </linearGradient>
                <clipPath id="spectrumPlotClip">
                  <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H} />
                </clipPath>
              </defs>

              {/* Clipped Plot Area for Zoomable Passbands, Grid, Curve & Points */}
              <g clipPath="url(#spectrumPlotClip)">
                {/* 6 Detector Passband Columns */}
                {spectrum.detector_bands.map((band) => {
                  const xStart = getX(band.wavelength_min_um);
                  const xEnd = getX(band.wavelength_max_um);
                  const bandW = Math.max(2, xEnd - xStart);
                  const color = DETECTOR_COLORS[band.detector] || '#38BDF8';
                  const isCurrent = activeDetector === band.detector;
                  const midX = (xStart + xEnd) / 2;

                  return (
                    <g key={band.detector}>
                      <rect
                        x={xStart}
                        y={PAD_T}
                        width={bandW}
                        height={PLOT_H}
                        fill={color}
                        opacity={isCurrent ? 0.05 : 0.015}
                      />
                      <line
                        x1={xStart}
                        y1={PAD_T}
                        x2={xStart}
                        y2={PAD_T + PLOT_H}
                        stroke="#1C2029"
                        strokeWidth="1"
                      />
                      {midX > PAD_L + 40 && midX < PAD_L + PLOT_W - 40 && (
                        <g
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            const midWl = (band.wavelength_min_um + band.wavelength_max_um) / 2;
                            selectWavelengthOnChart(midWl, band.detector);
                          }}
                        >
                          <rect
                            x={midX - 42}
                            y={PAD_T + 5}
                            width="84"
                            height="15"
                            rx="2"
                            fill="#050507"
                            stroke={isCurrent ? color : '#1C2029'}
                            strokeWidth="1"
                          />
                          <text
                            x={midX}
                            y={PAD_T + 15.5}
                            fill={isCurrent ? '#FFFFFF' : '#888E9B'}
                            fontSize="9"
                            fontWeight={isCurrent ? '700' : '500'}
                            fontFamily="monospace"
                            textAnchor="middle"
                          >
                            {band.detector} · R~{band.resolving_power_nominal}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

                {/* Horizontal Surface Brightness Grid Lines */}
                {yTicks.map((val) => {
                  const y = getY(val);
                  return (
                    <line
                      key={`grid-${val}`}
                      x1={PAD_L}
                      y1={y}
                      x2={PAD_L + PLOT_W}
                      y2={y}
                      stroke="#1C2029"
                      strokeDasharray="2,4"
                      strokeWidth="1"
                    />
                  );
                })}

                {/* Real Dated IRSA Exposure Wavelength Markers (Filtered by Active Filters) */}
                {showIrsaMarkers &&
                  filteredObservations.map((obs) => {
                    if (
                      obs.wavelength_center_um === null ||
                      obs.wavelength_center_um < viewRange.minUm ||
                      obs.wavelength_center_um > viewRange.maxUm
                    )
                      return null;
                    const xObs = getX(obs.wavelength_center_um);
                    const isSelObs =
                      selectedObservation?.obs_id === obs.obs_id &&
                      selectedObservation?.detector === obs.detector;
                    const color = DETECTOR_COLORS[obs.detector] || '#FFFFFF';

                    return (
                      <g
                        key={`${obs.obs_id}-${obs.detector}`}
                        className="cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectObservation(obs);
                        }}
                      >
                        <line
                          x1={xObs}
                          y1={PAD_T + PLOT_H - 14}
                          x2={xObs}
                          y2={PAD_T + PLOT_H}
                          stroke={isSelObs ? '#FFFFFF' : color}
                          strokeWidth={isSelObs ? '2' : '1.2'}
                        />
                        <rect
                          x={xObs - 3.5}
                          y={PAD_T + PLOT_H - 16}
                          width="7"
                          height="7"
                          fill={isSelObs ? '#FFFFFF' : '#050507'}
                          stroke={color}
                          strokeWidth="1.5"
                        />
                      </g>
                    );
                  })}

                {/* Diagnostic Spectral Line Markers with Solid Background Badges */}
                {showFeatures &&
                  spectrum.spectral_features.map((feat, idx) => {
                    if (
                      feat.wavelength_um < viewRange.minUm ||
                      feat.wavelength_um > viewRange.maxUm
                    )
                      return null;
                    const xPos = getX(feat.wavelength_um);
                    const labelW = feat.name.length * 5.6 + 10;
                    const yBadge = PAD_T + 25 + (idx % 2) * 18;
                    return (
                      <g
                        key={feat.name}
                        className="cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectWavelengthOnChart(feat.wavelength_um);
                        }}
                      >
                        <line
                          x1={xPos}
                          y1={PAD_T}
                          x2={xPos}
                          y2={PAD_T + PLOT_H}
                          stroke="#888E9B"
                          strokeDasharray="2,3"
                          strokeWidth="1"
                          opacity="0.45"
                        />
                        <rect
                          x={xPos - labelW / 2}
                          y={yBadge}
                          width={labelW}
                          height="14"
                          rx="2"
                          fill="#050507"
                          stroke="#1C2029"
                          strokeWidth="1"
                        />
                        <text
                          x={xPos}
                          y={yBadge + 10}
                          fill="#D1D5DB"
                          fontSize="9"
                          fontFamily="monospace"
                          textAnchor="middle"
                        >
                          {feat.name}
                        </text>
                      </g>
                    );
                  })}

                {/* Independent measured samples may have different dates. No inferred continuum. */}
                {/* Vertical ±1σ Error Bar Whiskers per Channel */}
                {showErrorBars &&
                  spectrum.spectral_points.map((p) => {
                    if (
                      p.wavelength_um < viewRange.minUm - 0.05 ||
                      p.wavelength_um > viewRange.maxUm + 0.05
                    )
                      return null;
                    const x = getX(p.wavelength_um);
                    const yTop = getY(p.flux_mjy_sr + p.flux_error_mjy_sr);
                    const yBot = getY(p.flux_mjy_sr - p.flux_error_mjy_sr);
                    const color = DETECTOR_COLORS[p.detector] || '#38BDF8';
                    return (
                      <g key={`err-${p.channel_index}`} opacity="0.55">
                        <line x1={x} y1={yTop} x2={x} y2={yBot} stroke={color} strokeWidth="1" />
                        <line
                          x1={x - 2}
                          y1={yTop}
                          x2={x + 2}
                          y2={yTop}
                          stroke={color}
                          strokeWidth="1"
                        />
                        <line
                          x1={x - 2}
                          y1={yBot}
                          x2={x + 2}
                          y2={yBot}
                          stroke={color}
                          strokeWidth="1"
                        />
                      </g>
                    );
                  })}

                {/* 102 Individual Spectrophotometric Channel Nodes */}
                {spectrum.spectral_points.map((p) => {
                  if (
                    p.wavelength_um < viewRange.minUm - 0.05 ||
                    p.wavelength_um > viewRange.maxUm + 0.05
                  )
                    return null;
                  const x = getX(p.wavelength_um);
                  const y = getY(p.flux_mjy_sr);
                  const isSelected = activePoint?.channel_index === p.channel_index;
                  const color = DETECTOR_COLORS[p.detector] || '#38BDF8';
                  return (
                    <circle
                      key={p.channel_index}
                      cx={x}
                      cy={y}
                      r={isSelected ? 4.5 : 2.3}
                      fill={isSelected ? '#FFFFFF' : color}
                      stroke="#050507"
                      strokeWidth={isSelected ? 1.5 : 0.8}
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredPoint(p)}
                      onMouseLeave={() => setHoveredPoint(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectWavelengthOnChart(p.wavelength_um, p.detector);
                      }}
                    />
                  );
                })}

                {/* Active Wavelength Crosshair & Solid Callout Badge */}
                {activePoint &&
                  activePoint.wavelength_um >= viewRange.minUm &&
                  activePoint.wavelength_um <= viewRange.maxUm &&
                  (() => {
                    const cursorX = getX(activePoint.wavelength_um);
                    const cursorY = getY(activePoint.flux_mjy_sr);
                    const color = DETECTOR_COLORS[activePoint.detector] || '#FFFFFF';
                    const badgeW = 172;
                    const badgeX = Math.min(
                      PAD_L + PLOT_W - badgeW - 6,
                      Math.max(PAD_L + 6, cursorX - badgeW / 2)
                    );
                    return (
                      <g>
                        <line
                          x1={cursorX}
                          y1={PAD_T}
                          x2={cursorX}
                          y2={PAD_T + PLOT_H}
                          stroke="#FFFFFF"
                          strokeWidth="1"
                          opacity="0.85"
                        />
                        <circle
                          cx={cursorX}
                          cy={cursorY}
                          r="5"
                          fill="#FFFFFF"
                          stroke={color}
                          strokeWidth="2"
                        />
                        <rect
                          x={badgeX}
                          y={PAD_T + PLOT_H - 26}
                          width={badgeW}
                          height="20"
                          rx="3"
                          fill="#050507"
                          stroke={color}
                          strokeWidth="1"
                        />
                        <text
                          x={badgeX + badgeW / 2}
                          y={PAD_T + PLOT_H - 13}
                          fill="#FFFFFF"
                          fontSize="10"
                          fontWeight="bold"
                          fontFamily="monospace"
                          textAnchor="middle"
                        >
                          Sample {activePoint.channel_index + 1} · {activePoint.wavelength_um.toFixed(3)}
                          µm · {activePoint.flux_mjy_sr.toFixed(2)} MJy/sr
                        </text>
                      </g>
                    );
                  })()}
              </g>

              {/* Y-Axis Labels */}
              {yTicks.map((val) => {
                const y = getY(val);
                return (
                  <text
                    key={`ylabel-${val}`}
                    x={PAD_L - 8}
                    y={y + 3.5}
                    fill="#888E9B"
                    fontSize="10"
                    fontFamily="monospace"
                    textAnchor="end"
                  >
                    {val >= 10 ? val.toFixed(1) : val.toFixed(2)}
                  </text>
                );
              })}

              {/* Y-Axis Unit Label */}
              <text
                x={-(PAD_T + PLOT_H / 2)}
                y={16}
                fill="#888E9B"
                fontSize="10"
                fontFamily="monospace"
                textAnchor="middle"
                transform="rotate(-90)"
              >
                Surface brightness (MJy/sr)
              </text>

              {/* X-Axis Wavelength Ticks & Labels */}
              {xTicks.map((wl) => {
                const x = getX(wl);
                if (x < PAD_L || x > PAD_L + PLOT_W) return null;
                return (
                  <g key={wl}>
                    <line
                      x1={x}
                      y1={PAD_T + PLOT_H}
                      x2={x}
                      y2={PAD_T + PLOT_H + 5}
                      stroke="#888E9B"
                      strokeWidth="1"
                    />
                    <text
                      x={x}
                      y={PAD_T + PLOT_H + 17}
                      fill="#888E9B"
                      fontSize="10"
                      fontFamily="monospace"
                      textAnchor="middle"
                    >
                      {wl.toFixed(2)}
                    </text>
                  </g>
                );
              })}

              {/* X-Axis Title */}
              <text
                x={PAD_L + PLOT_W / 2}
                y={PAD_T + PLOT_H + 32}
                fill="#888E9B"
                fontSize="10"
                fontFamily="monospace"
                textAnchor="middle"
              >
                Wavelength λ (µm) — Scroll to Zoom ({zoomLevel.toFixed(1)}×), Drag to Pan, Click to
                Inspect Channel
              </text>

              {/* Main Plot Frame Borders */}
              <rect
                x={PAD_L}
                y={PAD_T}
                width={PLOT_W}
                height={PLOT_H}
                fill="none"
                stroke="#1C2029"
                strokeWidth="1.2"
              />
            </svg>
          ) : null}
        </div>
      </div>

      {/* COMPACT 3-COLUMN BOTTOM DECK: [1. Channel Telemetry] | [2. Filtered Exposure Details] | [3. Minimal FITS Stamp] */}
      <div className="h-60 border-t border-border-subtle bg-bg-surface grid grid-cols-1 lg:grid-cols-12 shrink-0 overflow-hidden">
        {/* COLUMN 1: Channel Spectrophotometry & Scrubbing (5 cols) */}
        <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-border-subtle p-3.5 flex flex-col justify-between overflow-y-auto">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <span className="text-[11px] uppercase tracking-wider font-mono text-[#888E9B]">
                  Channel Telemetry
                </span>
                <InfoTooltip
                  title="Calibrated Channel Photometry"
                  description="Each SPHEREx channel measures surface brightness in MegaJanskys per steradian (MJy/sr) with resolving power R = λ / Δλ ranging from R~41 (D1–D3) to R~130 (D5–D6)."
                />
              </div>

              <div className="flex items-center space-x-1.5 text-[11px] font-mono">
                <button
                  type="button"
                  onClick={() => stepChannel(-1)}
                  className="px-2 py-0.5 rounded bg-[#050507] border border-[#1C2029] text-[#888E9B] hover:text-white hover:border-white/30 cursor-pointer"
                >
                  ← Prev Ch
                </button>
                <button
                  type="button"
                  onClick={() => stepChannel(1)}
                  className="px-2 py-0.5 rounded bg-[#050507] border border-[#1C2029] text-[#888E9B] hover:text-white hover:border-white/30 cursor-pointer"
                >
                  Next Ch →
                </button>
              </div>
            </div>

            {/* Fine Wavelength Scrub Slider */}
            <div className="bg-[#050507] border border-[#1C2029] px-3 py-1.5 rounded">
              <div className="flex items-center justify-between text-[10px] font-mono text-[#888E9B] mb-1">
                <span>{viewRange.minUm.toFixed(2)} µm</span>
                <span className="text-white font-semibold">
                  λ = {activePoint ? activePoint.wavelength_um.toFixed(4) : selectedWavelength.toFixed(3)} µm
                </span>
                <span>{viewRange.maxUm.toFixed(2)} µm</span>
              </div>
              <input
                type="range"
                min={viewRange.minUm}
                max={viewRange.maxUm}
                step="0.005"
                value={Math.max(viewRange.minUm, Math.min(viewRange.maxUm, selectedWavelength))}
                onChange={(e) => selectWavelengthOnChart(parseFloat(e.target.value))}
                className="w-full accent-white h-1 bg-[#1C2029] rounded cursor-pointer"
              />
            </div>

            {/* 4 Solid Telemetry Badges */}
            <div className="grid grid-cols-4 gap-2 text-[11px] font-mono tabular-nums">
              <div className="bg-[#050507] border border-[#1C2029] px-2.5 py-1.5 rounded">
                <div className="text-[9px] text-[#888E9B] uppercase">Channel</div>
                <div className="text-white font-semibold mt-0.5">
                  {activePoint ? `Sample ${activePoint.channel_index + 1} (${activePoint.detector})` : '—'}
                </div>
              </div>

              <div className="bg-[#050507] border border-[#1C2029] px-2.5 py-1.5 rounded">
                <div className="text-[9px] text-[#888E9B] uppercase">Bandpass Δλ</div>
                <div className="text-white font-semibold mt-0.5">
                  {activePoint ? `±${(activePoint.bandwidth_um / 2).toFixed(3)} µm` : '—'}
                </div>
              </div>

              <div className="bg-[#050507] border border-[#1C2029] px-2.5 py-1.5 rounded">
                <div className="text-[9px] text-[#888E9B] uppercase">Flux F_λ</div>
                <div className="text-white font-semibold mt-0.5">
                  {activePoint ? `${activePoint.flux_mjy_sr.toFixed(3)} MJy/sr` : '—'}
                </div>
              </div>

              <div className="bg-[#050507] border border-[#1C2029] px-2.5 py-1.5 rounded">
                <div className="text-[9px] text-[#888E9B] uppercase">Error / SNR</div>
                <div className="text-white font-semibold mt-0.5">
                  {activePoint ? `±${activePoint.flux_error_mjy_sr.toFixed(3)} (${Number.isFinite(activePoint.snr) ? `${activePoint.snr}σ` : 'S/N unavailable'})` : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Nearest Spectral Feature Diagnostic Badge with ? Tooltip */}
          <div className="bg-[#050507] border border-[#1C2029] px-3 py-1.5 rounded text-[11px] tabular-nums flex items-center justify-between">
            {nearestFeature ? (
              <>
                <div className="flex items-center space-x-2 font-mono">
                  <span className="text-white font-semibold">
                    {nearestFeature.feature.name} ({nearestFeature.feature.wavelength_um} µm)
                  </span>
                  <span className="bg-[#12151C] border border-[#1C2029] px-1.5 py-0.2 rounded text-[9px] text-[#888E9B] uppercase">
                    {nearestFeature.feature.feature_type}
                  </span>
                </div>
                <div className="flex items-center space-x-2 text-[10px] font-mono text-[#888E9B]">
                  <span>τ = {nearestFeature.opticalDepth.toFixed(3)}</span>
                  <span>·</span>
                  <span>Ratio = {nearestFeature.ratio.toFixed(2)}×</span>
                  <InfoTooltip
                    title={nearestFeature.feature.name}
                    description={`${nearestFeature.feature.description}. Optical depth τ = -ln(F_λ / F_cont) quantifies absorption strength relative to continuum.`}
                    align="right"
                  />
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between w-full text-[10px] font-mono text-[#888E9B]">
                <span>Measured pixel brightness; samples can come from different dates. No spectral features have been identified.</span>
                <InfoTooltip
                  title="Continuum vs. Spectral Line"
                  description="Continuum regions measure thermal blackbody emission from stellar photospheres or dust grains without discrete molecular absorption."
                  align="right"
                />
              </div>
            )}
          </div>
        </div>

        {/* COLUMN 2: Active Filtered Exposure Summary & Quick List (4 cols) */}
        <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-border-subtle p-3.5 flex flex-col justify-between overflow-hidden">
          <div className="flex items-center justify-between mb-2 shrink-0">
            <div className="flex items-center space-x-1.5">
              <span className="text-[11px] uppercase tracking-wider font-mono text-[#888E9B]">
                Filtered IRSA Exposures ({filteredObservations.length})
              </span>
              <InfoTooltip
                title="Filtered LVF Exposures"
                description="Shows only the dated IRSA exposures matching the Band and Date dropdowns in the top filter bar. Clicking an exposure loads its minimal FITS stamp on the right."
              />
            </div>

            {(globalBandFilter !== 'ALL' || selectedDateFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setGlobalBandFilter('ALL');
                  setSelectedDateFilter('ALL');
                              }}
                className="px-2 py-0.5 rounded bg-[#050507] border border-[#1C2029] text-[10px] font-mono text-[#888E9B] hover:text-white cursor-pointer"
              >
                Reset Filters
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#1C2029] border border-[#1C2029] rounded bg-[#050507]">
            {loadingObservations ? (
              <div className="p-4 text-center text-[11px] text-[#888E9B] font-mono">
                Querying NASA/IPAC IRSA archive...
              </div>
            ) : filteredObservations.length === 0 ? (
              <div className="p-4 text-center text-[11px] text-[#888E9B] font-mono">
                No exposures match the selected Band / Date filter.
              </div>
            ) : (
              filteredObservations.map((obs) => {
                const isSelected =
                  selectedObservation?.obs_id === obs.obs_id &&
                  selectedObservation?.detector === obs.detector;
                const color = DETECTOR_COLORS[obs.detector] || '#FFFFFF';

                return (
                  <button
                    key={`${obs.obs_id}-${obs.detector}`}
                    type="button"
                    onClick={() => handleSelectObservation(obs)}
                    className={`w-full px-3 py-1.5 text-left flex items-center justify-between text-[11px] font-mono tabular-nums transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#12151C] text-white'
                        : 'bg-[#050507] text-[#888E9B] hover:bg-[#0B0D11] hover:text-white'
                    }`}
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      <span className="px-1.5 py-0.2 rounded bg-[#0B0D11] border border-[#1C2029] text-white font-semibold flex items-center space-x-1 shrink-0">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <span>{obs.detector}</span>
                      </span>
                      <span className="text-white font-medium shrink-0">{obs.date_only}</span>
                    </div>

                    <div className="flex items-center space-x-1.5 shrink-0">
                      <span className="bg-[#0B0D11] border border-[#1C2029] px-1.5 py-0.2 rounded text-[10px] text-white">
                        λ {(obs.wavelength_center_um?.toFixed(2) ?? 'unknown')} µm
                      </span>
                      {isSelected && (
                        <span className="bg-white text-black px-1.5 py-0.2 rounded text-[9px] font-bold">
                          ACTIVE
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* COLUMN 3: Minimal FITS Cutout Stamp (3 cols) */}
        <div className="lg:col-span-3 bg-black relative flex flex-col overflow-hidden">
          {/* Minimal Solid Stamp Header with Stretch Dropdown */}
          <div className="px-3 py-1.5 bg-[#0B0D11] border-b border-[#1C2029] flex items-center justify-between text-[11px] font-mono tabular-nums shrink-0">
            <div className="flex items-center space-x-1.5 truncate">
              {selectedObservation ? (
                <>
                  <span className="text-white font-semibold">
                    {selectedObservation.detector} · {selectedObservation.date_only}
                  </span>
                  <span className="bg-[#050507] border border-[#1C2029] px-1.5 py-0.2 rounded text-[10px] text-[#888E9B]">
                    {(selectedObservation.wavelength_center_um?.toFixed(2) ?? 'unknown')} µm
                  </span>
                </>
              ) : (
                <span className="text-[#888E9B]">LVF Stamp</span>
              )}
            </div>

            <div className="flex items-center space-x-1.5 shrink-0">
              <select
                value={stretch}
                onChange={(e) => setStretch(e.target.value)}
                className="bg-[#050507] border border-[#1C2029] rounded px-1.5 py-0.5 text-[10px] font-mono text-white focus:outline-none cursor-pointer uppercase"
              >
                <option value="zscale">ZScale</option>
                <option value="linear">Linear</option>
                <option value="log">Log</option>
              </select>
              <InfoTooltip
                title="Minimal LVF Cutout Stamp"
                description="Clean spatial context stamp for the selected dated IRSA exposure. Use the Observations tab for full astrometric overlays, SIMBAD catalog reticles, and multi-FOV controls."
                align="right"
              />
            </div>
          </div>

          <div className="flex-1 relative overflow-hidden">
            {cutoutError && <p role="alert" className="text-text-secondary text-xs p-2">{cutoutError}</p>}
            <FitsCanvas
              cutout={cutout}
              loading={loadingCutout}
              selectedStretch={stretch}
              onStretchChange={setStretch}
              targetId={target.canonical_name || target.query}
              targetName={target.canonical_name || target.query}
              targetRa={target.coordinates?.ra_deg}
              targetDec={target.coordinates?.dec_deg}
              accessUrl={selectedObservation?.access_url}
              showAperture={showAperture}
              targetRadiusPx={targetRadiusPx}
              skyInnerRadiusPx={targetRadiusPx + 3}
              skyOuterRadiusPx={targetRadiusPx + 7}
              onApertureChange={setApertureMetrics}
              minimal={true}
            />

            {showAperture && apertureMetrics && (
              <div className="absolute bottom-2 inset-x-2 mx-auto w-fit z-20 pointer-events-auto bg-[#050507] px-2 py-0.5 rounded border border-[#1C2029] text-[10px] font-mono tabular-nums flex items-center space-x-2 text-[#888E9B]">
                {([3, 4, 6] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setTargetRadiusPx(r)}
                    className={`px-1 py-0.2 rounded cursor-pointer ${
                      targetRadiusPx === r
                        ? 'bg-white text-black font-bold'
                        : 'text-[#888E9B] hover:text-white'
                    }`}
                  >
                    {r}px
                  </button>
                ))}
                <span className="text-white font-semibold">
                  Net: {apertureMetrics.netFluxMjySr.toFixed(3)} MJy/sr
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
