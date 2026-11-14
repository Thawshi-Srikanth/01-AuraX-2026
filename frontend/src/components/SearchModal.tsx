import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Loader2, MapPin, X, ArrowRight, Compass, Sparkles } from 'lucide-react';
import { NavigationTab } from '../tokens/colors';
import { resolveTarget, resolveCoordinates, ResolvedTarget } from '../services/api';
import { SKY_LANDMARKS, BRIGHT_NAV_STARS } from '../data/skyCoverage';
import messierDataRaw from '../data/celestial/messier.json';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTargetResolved: (target: ResolvedTarget) => void;
  onNavigate: (tab: NavigationTab) => void;
  currentTab?: NavigationTab;
}

interface SearchCandidate {
  id: string;
  name: string;
  subtitle: string;
  type: string;
  category: 'benchmark' | 'star' | 'dso' | 'coords';
  ra?: number;
  dec?: number;
}

// Canonical SPHEREx & SIMBAD Verified Benchmark Targets
const BENCHMARK_TARGETS: SearchCandidate[] = [
  {
    id: 'andromeda',
    name: 'Andromeda Galaxy',
    subtitle: 'M31 Spiral Galaxy • 2.5 Mly',
    type: 'Spiral Galaxy',
    category: 'benchmark',
    ra: 10.685,
    dec: 41.269,
  },
  {
    id: 'barnard',
    name: "Barnard's Star",
    subtitle: 'Astrometric Benchmark • High proper motion (10.3"/yr)',
    type: 'Red Dwarf',
    category: 'benchmark',
    ra: 269.452,
    dec: 4.693,
  },
  {
    id: 'epsilon_indi',
    name: 'Epsilon Indi B',
    subtitle: 'Sub-stellar brown dwarf binary pair',
    type: 'Brown Dwarf Pair',
    category: 'benchmark',
    ra: 330.84,
    dec: -56.79,
  },
  {
    id: 'wise0855',
    name: 'WISE 0855',
    subtitle: 'Coldest known sub-zero sub-stellar dwarf',
    type: 'Sub-zero Brown Dwarf',
    category: 'benchmark',
    ra: 133.795,
    dec: -7.245,
  },
  {
    id: 'm101',
    name: 'Pinwheel Galaxy (M101)',
    subtitle: 'Grand design spiral galaxy in Ursa Major',
    type: 'Spiral Galaxy',
    category: 'benchmark',
    ra: 210.802,
    dec: 54.349,
  },
  {
    id: 'rw_aur',
    name: 'RW Aurigae',
    subtitle: 'Young stellar object with variable circumstellar disk',
    type: 'T Tauri Star',
    category: 'benchmark',
    ra: 77.108,
    dec: 30.402,
  },
  {
    id: 'm42',
    name: 'Orion Nebula (M42)',
    subtitle: 'Nearest massive stellar nursery and H II region',
    type: 'Diffuse Nebula',
    category: 'benchmark',
    ra: 83.822,
    dec: -5.391,
  },
  {
    id: 'pleiades',
    name: 'Pleiades (M45)',
    subtitle: 'Open star cluster • Seven Sisters in Taurus',
    type: 'Open Cluster',
    category: 'benchmark',
    ra: 56.75,
    dec: 24.117,
  },
];

// Coordinate detection regex (Decimal degrees or Sexagesimal HMS/DMS)
function parseCoordinates(query: string): { ra: number; dec: number } | null {
  const trimmed = query.trim();
  // Decimal format: "210.8, -15.5" or "210.8 -15.5"
  const decMatch = trimmed.match(/^([+-]?\d+(?:\.\d+)?)[,\s]+([+-]?\d+(?:\.\d+)?)$/);
  if (decMatch) {
    const ra = parseFloat(decMatch[1]);
    const dec = parseFloat(decMatch[2]);
    if (ra >= 0 && ra <= 360 && dec >= -90 && dec <= 90) {
      return { ra, dec };
    }
  }

  // Sexagesimal format: "12h 30m 15s, +45d 10m 00s" or "12:30:15, +45:10:00"
  const sexMatch = trimmed.match(
    /^(\d{1,2})[h:]\s*(\d{1,2})[m:]?\s*(\d{1,2}(?:\.\d+)?)?s?[,\s]+([+-]?\d{1,2})[d°:]\s*(\d{1,2})['m]?\s*(\d{1,2}(?:\.\d+)?)?"?$/i
  );
  if (sexMatch) {
    const h = parseFloat(sexMatch[1]);
    const m = parseFloat(sexMatch[2]);
    const s = sexMatch[3] ? parseFloat(sexMatch[3]) : 0;
    const sign = sexMatch[4].startsWith('-') ? -1 : 1;
    const absD = Math.abs(parseFloat(sexMatch[4]));
    const decM = parseFloat(sexMatch[5]);
    const decS = sexMatch[6] ? parseFloat(sexMatch[6]) : 0;

    const raDeg = (h + m / 60 + s / 3600) * 15;
    const decDeg = sign * (absD + decM / 60 + decS / 3600);

    if (raDeg >= 0 && raDeg <= 360 && decDeg >= -90 && decDeg <= 90) {
      return { ra: raDeg, dec: decDeg };
    }
  }

  return null;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  onTargetResolved,
  onNavigate,
  currentTab,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // OS detection for keyboard shortcut labels
  const isMac = useMemo(() => {
    return typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  }, []);

  // Prepare candidate astronomical corpus
  const candidates = useMemo<SearchCandidate[]>(() => {
    const list: SearchCandidate[] = [...BENCHMARK_TARGETS];

    // Add Bright Navigation Stars
    for (const star of BRIGHT_NAV_STARS) {
      if (!list.some((item) => item.name.toLowerCase() === star.name.toLowerCase())) {
        list.push({
          id: `star-${star.name.toLowerCase()}`,
          name: star.name,
          subtitle: `Yale Bright Star • Mag ${star.mag.toFixed(2)} • Class ${star.specType}`,
          type: 'Navigation Star',
          category: 'star',
          ra: star.ra,
          dec: star.dec,
        });
      }
    }

    // Add Messier Deep Sky Objects
    for (const dso of messierDataRaw as { id: string; name: string; alt: string; type: string; ra: number; dec: number }[]) {
      if (!list.some((item) => item.id.toLowerCase() === dso.id.toLowerCase() || item.name.toLowerCase() === dso.name.toLowerCase())) {
        list.push({
          id: dso.id.toLowerCase(),
          name: dso.name ? `${dso.name} (${dso.id})` : dso.id,
          subtitle: `${dso.type} • ${dso.alt || 'Messier Catalog'}`,
          type: dso.type,
          category: 'dso',
          ra: dso.ra,
          dec: dso.dec,
        });
      }
    }

    // Add Major Landmarks
    for (const lm of SKY_LANDMARKS) {
      if (!list.some((item) => item.name.toLowerCase() === lm.name.toLowerCase())) {
        list.push({
          id: `lm-${lm.name.toLowerCase().replace(/\s+/g, '-')}`,
          name: lm.name,
          subtitle: `${lm.catalog} • ${lm.desc}`,
          type: lm.type,
          category: 'benchmark',
          ra: lm.ra,
          dec: lm.dec,
        });
      }
    }

    return list;
  }, []);

  // Filter candidates based on current input query
  const filteredCandidates = useMemo<SearchCandidate[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return BENCHMARK_TARGETS;
    }

    // Check for celestial coordinate input
    const coords = parseCoordinates(query);
    const results: SearchCandidate[] = [];

    if (coords) {
      results.push({
        id: 'direct-coords',
        name: `Coordinates: RA ${coords.ra.toFixed(4)}°, Dec ${coords.dec.toFixed(4)}°`,
        subtitle: 'Direct Astrometric Coordinate Lookup',
        type: 'Celestial Point',
        category: 'coords',
        ra: coords.ra,
        dec: coords.dec,
      });
    }

    // Match candidate names, IDs, types, and subtitles
    const matches = candidates.filter((item) => {
      return (
        item.name.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.type.toLowerCase().includes(q)
      );
    });

    return [...results, ...matches.slice(0, 12)];
  }, [query, candidates]);

  // Is the current query valid for submission?
  const isValidQuery = useMemo(() => {
    const q = query.trim();
    if (!q) return false;
    if (parseCoordinates(q)) return true;
    return q.length > 0;
  }, [query]);

  // Auto-focus input on modal open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setErrorMessage(null);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Reset selected index when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCandidates.length]);

  // Scroll active candidate into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Handle target submission and resolution
  const handleSelectCandidate = async (candidate: SearchCandidate) => {
    if (isLoading) return;
    setIsLoading(true);
    setErrorMessage(null);

    const destTab = currentTab && currentTab !== 'Explore' ? currentTab : 'Observations';
    try {
      if (candidate.category === 'coords' && candidate.ra !== undefined && candidate.dec !== undefined) {
        const resolved = await resolveCoordinates(candidate.ra, candidate.dec);
        onTargetResolved(resolved);
        onNavigate(destTab);
        onClose();
        return;
      }

      const resolved = await resolveTarget(candidate.name);
      onTargetResolved(resolved);
      onNavigate(destTab);
      onClose();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Resolution failed. Please check target name.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!isValidQuery || isLoading) return;

    if (filteredCandidates.length > 0 && selectedIndex >= 0 && selectedIndex < filteredCandidates.length) {
      await handleSelectCandidate(filteredCandidates[selectedIndex]);
      return;
    }

    const coords = parseCoordinates(query);
    if (coords) {
      await handleSelectCandidate({
        id: 'direct-coords',
        name: `Coordinates (${coords.ra}, ${coords.dec})`,
        subtitle: 'Astrometric Point',
        type: 'Coordinate Target',
        category: 'coords',
        ra: coords.ra,
        dec: coords.dec,
      });
      return;
    }

    // Direct name lookup
    setIsLoading(true);
    setErrorMessage(null);
    const destTab = currentTab && currentTab !== 'Explore' ? currentTab : 'Observations';
    try {
      const resolved = await resolveTarget(query.trim());
      onTargetResolved(resolved);
      onNavigate(destTab);
      onClose();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'No astronomical target found.');
    } finally {
      setIsLoading(false);
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredCandidates.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % filteredCandidates.length);
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredCandidates.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + filteredCandidates.length) % filteredCandidates.length);
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
      return;
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-start justify-center pt-12 sm:pt-20 px-3 sm:px-4"
      onClick={onClose}
    >
      <div
        className="bg-[#0B0D11] border border-[#1C2029] rounded-lg shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[82vh] animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header */}
        <div className="flex items-center px-4 py-3.5 border-b border-[#1C2029] bg-[#0E1117] relative">
          {isLoading ? (
            <Loader2 size={18} className="text-emerald-400 animate-spin mr-3 shrink-0" />
          ) : (
            <Search size={18} className="text-text-secondary mr-3 shrink-0" />
          )}

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search celestial landmarks, stars, galaxies, or coordinates..."
            disabled={isLoading}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />

          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="p-1 text-text-tertiary hover:text-text-primary rounded mr-2 transition-colors cursor-pointer"
            >
              <X size={15} />
            </button>
          )}

          <div className="flex items-center space-x-1.5 text-[10px] font-mono text-text-tertiary">
            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 bg-[#12151C] border border-[#1C2029] rounded">
              {isMac ? '⌘K' : 'Ctrl+K'}
            </kbd>
            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 bg-[#12151C] border border-[#1C2029] rounded">
              ESC
            </kbd>
          </div>
        </div>

        {/* Validation Warning when no search match found */}
        {query.trim() && !isValidQuery && !isLoading && (
          <div className="px-4 py-2.5 bg-red-950/20 border-b border-red-900/30 text-red-400 text-xs flex items-center justify-between">
            <span>No matching astronomical target found. Enter a recognized identifier or J2000 coordinates.</span>
            <span className="text-[10px] text-red-500 font-mono">CANNOT SEARCH</span>
          </div>
        )}

        {errorMessage && (
          <div className="px-4 py-2.5 bg-red-950/20 border-b border-red-900/30 text-red-400 text-xs">
            {errorMessage}
          </div>
        )}

        {/* Pre-Sampled & Filtered Candidate List */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-1 divide-y divide-[#1C2029]/40">
          {!query.trim() && (
            <div className="px-2.5 pt-2 pb-1 text-[10px] font-bold tracking-wider text-text-tertiary uppercase flex items-center space-x-1.5">
              <Sparkles size={11} className="text-emerald-400" />
              <span>Verified Benchmark Landmarks</span>
            </div>
          )}

          {filteredCandidates.map((candidate, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={candidate.id}
                onClick={() => handleSelectCandidate(candidate)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-[#12151C] border border-border-strong text-white'
                    : 'text-text-secondary hover:bg-[#0E1117] hover:text-text-primary border border-transparent'
                }`}
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div
                    className={`w-7 h-7 rounded flex items-center justify-center shrink-0 border ${
                      candidate.category === 'benchmark'
                        ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-400'
                        : candidate.category === 'star'
                        ? 'bg-yellow-950/30 border-yellow-500/30 text-yellow-400'
                        : candidate.category === 'coords'
                        ? 'bg-cyan-950/30 border-cyan-500/30 text-cyan-400'
                        : 'bg-indigo-950/30 border-indigo-500/30 text-indigo-400'
                    }`}
                  >
                    {candidate.category === 'coords' ? (
                      <Compass size={13} />
                    ) : (
                      <MapPin size={13} />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-text-primary truncate flex items-center space-x-2">
                      <span>{candidate.name}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#181C26] text-text-tertiary font-normal">
                        {candidate.type}
                      </span>
                    </div>
                    <div className="text-[11px] text-text-secondary truncate mt-0.5">
                      {candidate.subtitle}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2 shrink-0 ml-3">
                  {isSelected && (
                    <span className="text-[10px] text-emerald-400 flex items-center space-x-1 font-mono">
                      <span>OPEN</span>
                      <ArrowRight size={11} />
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Hotkey Legend & Submission Controls */}
        <div className="px-4 py-2.5 bg-[#0E1117] border-t border-[#1C2029] flex items-center justify-between text-[11px] text-text-tertiary">
          <div className="flex items-center space-x-4">
            <span className="flex items-center space-x-1">
              <kbd className="px-1 py-0.5 font-mono bg-[#12151C] border border-[#1C2029] rounded text-[10px]">↑↓</kbd>
              <span>navigate</span>
            </span>
            <span className="flex items-center space-x-1">
              <kbd className="px-1 py-0.5 font-mono bg-[#12151C] border border-[#1C2029] rounded text-[10px]">↵</kbd>
              <span>select</span>
            </span>
            <span className="flex items-center space-x-1">
              <kbd className="px-1 py-0.5 font-mono bg-[#12151C] border border-[#1C2029] rounded text-[10px]">esc</kbd>
              <span>dismiss</span>
            </span>
          </div>

          <button
            type="button"
            disabled={!isValidQuery || isLoading}
            onClick={handleSubmit}
            className="px-2.5 py-1 bg-[#12151C] hover:bg-[#181C26] disabled:opacity-30 border border-[#1C2029] rounded text-text-primary text-[11px] font-medium transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {isLoading ? 'Resolving...' : 'Search Archive'}
          </button>
        </div>
      </div>
    </div>
  );
};
