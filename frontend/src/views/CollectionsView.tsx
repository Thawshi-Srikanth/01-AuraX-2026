import React, { useState, useEffect, useMemo } from 'react';
import {
  Download,
  Search,
  Trash2,
  Plus,
  ArrowUpRight,
} from 'lucide-react';
import { NavigationTab, DETECTOR_COLORS } from '../tokens/colors';
import {
  ResolvedTarget,
  SpectrumResponse,
  fetchTargetSpectrum,
} from '../services/api';
import {
  SavedTargetItem,
  getSavedTargets,
  toggleSaveTarget,
  removeSavedTarget,
  updateSavedTargetNotes,
  isTargetSaved,
  exportSpectrumCsv,
  exportSpectrumIpac,
  exportSpectrumVOTable,
  exportCollectionsManifest,
} from '../utils/collections';

interface CollectionsViewProps {
  currentTarget: ResolvedTarget;
  onSelectTarget: (target: ResolvedTarget) => void;
  onNavigate: (tab: NavigationTab) => void;
}

const FILTER_TABS = [
  { id: 'ALL', label: 'All' },
  { id: 'STAR', label: 'Stars' },
  { id: 'GALAXY', label: 'Galaxies' },
  { id: 'BROWN_DWARF', label: 'Dwarfs' },
] as const;

export const CollectionsView: React.FC<CollectionsViewProps> = ({
  currentTarget,
  onSelectTarget,
  onNavigate,
}) => {
  const [items, setItems] = useState<SavedTargetItem[]>(() => getSavedTargets());
  const [selectedId, setSelectedId] = useState<string>(() => {
    const initial = getSavedTargets();
    return initial[0]?.id || '';
  });
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [spectrum, setSpectrum] = useState<SpectrumResponse | null>(null);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const q = searchQuery.trim().toLowerCase();
      const nameMatch =
        !q ||
        item.target.canonical_name.toLowerCase().includes(q) ||
        item.target.query.toLowerCase().includes(q) ||
        item.target.object_type.toLowerCase().includes(q) ||
        item.notes.toLowerCase().includes(q);
      if (!nameMatch) return false;

      if (typeFilter === 'ALL') return true;
      const t = item.target.object_type.toLowerCase();
      if (typeFilter === 'STAR') return t.includes('star') || t.includes('yso');
      if (typeFilter === 'GALAXY') return t.includes('galaxy');
      if (typeFilter === 'BROWN_DWARF') return t.includes('dwarf');
      return true;
    });
  }, [items, searchQuery, typeFilter]);

  const activeItem = useMemo(() => {
    return (
      filteredItems.find((i) => i.id === selectedId) ||
      items.find((i) => i.id === selectedId) ||
      filteredItems[0] ||
      null
    );
  }, [filteredItems, items, selectedId]);

  // Fetch 102-channel SED for the active saved target
  useEffect(() => {
    if (!activeItem) {
      setSpectrum(null);
      return;
    }
    let cancelled = false;
    fetchTargetSpectrum(
      activeItem.target.canonical_name || activeItem.target.query,
      activeItem.target.coordinates.ra_deg,
      activeItem.target.coordinates.dec_deg
    )
      .then((res) => {
        if (!cancelled) setSpectrum(res);
      })
      .catch(() => {
        if (!cancelled) setSpectrum(null);
      });

    return () => {
      cancelled = true;
    };
  }, [activeItem]);

  const isCurrentBookmarked = useMemo(
    () => isTargetSaved(currentTarget),
    [currentTarget, items]
  );

  const handleBookmarkCurrent = () => {
    const res = toggleSaveTarget(currentTarget);
    setItems(res.items);
    if (res.saved && res.items[0]) {
      setSelectedId(res.items[0].id);
    }
  };

  const handleRemove = (id: string) => {
    const updated = removeSavedTarget(id);
    setItems(updated);
    if (selectedId === id) {
      setSelectedId(updated[0]?.id || '');
    }
  };

  const handleNotesChange = (nextNotes: string) => {
    if (!activeItem) return;
    const updated = updateSavedTargetNotes(activeItem.id, nextNotes);
    setItems(updated);
  };

  const handleOpenInTab = (item: SavedTargetItem, tab: NavigationTab) => {
    onSelectTarget(item.target);
    onNavigate(tab);
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-[#050507] text-white select-none">
      {/* Left Sidebar: Clean Master List */}
      <aside className="w-76 border-r border-[#1C2029] bg-[#0B0D11] flex flex-col shrink-0">
        {/* Search & Save Current Header */}
        <div className="p-3 border-b border-[#1C2029] space-y-2.5">
          <div className="flex items-center space-x-1.5">
            <div className="relative flex-1 flex items-center">
              <Search size={13} className="absolute left-2.5 text-[#888E9B]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search saved..."
                className="w-full bg-[#050507] border border-[#1C2029] focus:border-[#2E3646] rounded-md pl-8 pr-2.5 py-1 text-[12px] text-white placeholder-[#888E9B] focus:outline-none"
              />
            </div>

            {!isCurrentBookmarked && (
              <button
                type="button"
                onClick={handleBookmarkCurrent}
                className="p-1.5 rounded-md bg-[#12151C] hover:bg-[#1C2029] border border-[#1C2029] text-[#888E9B] hover:text-white transition-colors cursor-pointer shrink-0"
                title={`Save active target (${currentTarget.canonical_name || currentTarget.query})`}
              >
                <Plus size={13} />
              </button>
            )}
          </div>

          {/* Apple-Style Segmented Control */}
          <div className="grid grid-cols-4 bg-[#050507] p-0.5 rounded-md border border-[#1C2029] text-[11px]">
            {FILTER_TABS.map((tab) => {
              const active = typeFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTypeFilter(tab.id)}
                  className={`py-1 rounded text-center font-medium transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#12151C] text-white'
                      : 'text-[#888E9B] hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Minimal List Rows */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#1C2029]/60">
          {filteredItems.length === 0 ? (
            <div className="p-8 text-center text-[12px] text-[#888E9B]">
              No saved targets
            </div>
          ) : (
            filteredItems.map((item) => {
              const isSelected = activeItem?.id === item.id;
              const detColor = item.detector ? DETECTOR_COLORS[item.detector] : '#38BDF8';
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`px-4 py-3 cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#12151C]' : 'hover:bg-[#12151C]/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[13px] text-white truncate">
                      {item.target.canonical_name || item.target.query}
                    </span>
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: detColor }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-[#888E9B] mt-0.5">
                    <span className="truncate max-w-[140px]">{item.target.object_type}</span>
                    <span className="font-mono text-[10px] tabular-nums">
                      {item.target.coordinates.ra_hms.slice(0, 7)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Right Detail Pane: Cardless Hairline Layout */}
      <main className="flex-1 flex flex-col overflow-y-auto bg-[#050507]">
        {!activeItem ? (
          <div className="flex-1 flex items-center justify-center text-[13px] text-[#888E9B]">
            Select a target
          </div>
        ) : (
          <>
            {/* 1. Edge-to-Edge Title & Action Bar */}
            <div className="px-8 py-5 border-b border-[#1C2029] flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-[20px] font-semibold tracking-tight text-white">
                  {activeItem.target.canonical_name || activeItem.target.query}
                </h1>
                <div className="text-[12px] text-[#888E9B] mt-0.5">
                  {activeItem.target.object_type} · {activeItem.target.provenance}
                </div>
              </div>

              <div className="flex items-center space-x-2 text-[11px]">
                {/* Segmented View Launchers */}
                <div className="flex items-center bg-[#0B0D11] border border-[#1C2029] rounded-md overflow-hidden divide-x divide-[#1C2029]">
                  <button
                    type="button"
                    onClick={() => handleOpenInTab(activeItem, 'Observations')}
                    className="px-3 py-1.5 text-[#888E9B] hover:text-white hover:bg-[#12151C] transition-colors cursor-pointer flex items-center space-x-1"
                  >
                    <span>Find images</span>
                    <ArrowUpRight size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenInTab(activeItem, 'Wavelengths')}
                    className="px-3 py-1.5 text-[#888E9B] hover:text-white hover:bg-[#12151C] transition-colors cursor-pointer flex items-center space-x-1"
                  >
                    <span>Wavelengths</span>
                    <ArrowUpRight size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenInTab(activeItem, 'Compare')}
                    className="px-3 py-1.5 text-[#888E9B] hover:text-white hover:bg-[#12151C] transition-colors cursor-pointer flex items-center space-x-1"
                  >
                    <span>Compare dates</span>
                    <ArrowUpRight size={11} />
                  </button>
                </div>

                {/* Single Compact Export Dropdown */}
                <div className="flex items-center space-x-1.5 bg-[#0B0D11] border border-[#1C2029] hover:border-[#2E3646] rounded-md px-2.5 py-1.5">
                  <Download size={12} className="text-[#888E9B]" />
                  <select
                    aria-label="Export target spectrum or collection"
                    defaultValue=""
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === 'csv' && spectrum) exportSpectrumCsv(spectrum);
                      if (val === 'ipac' && spectrum) exportSpectrumIpac(spectrum);
                      if (val === 'votable' && spectrum) exportSpectrumVOTable(spectrum);
                      if (val === 'manifest') exportCollectionsManifest(items);
                      e.target.value = '';
                    }}
                    className="bg-[#0B0D11] text-white text-[11px] font-medium focus:outline-none cursor-pointer"
                  >
                    <option value="" disabled>
                      Export
                    </option>
                    <option value="csv">CSV Spectrum (.csv)</option>
                    <option value="ipac">NASA/IPAC Table (.tbl)</option>
                    <option value="votable">IVOA VOTable (.xml)</option>
                    <option value="manifest">All Saved Targets (.json)</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => handleRemove(activeItem.id)}
                  className="p-1.5 rounded-md bg-[#0B0D11] border border-[#1C2029] hover:border-red-500/40 text-[#888E9B] hover:text-red-400 transition-colors cursor-pointer"
                  title="Remove target"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* 2. Hairline Telemetry Strip (Zero Cards) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-[#1C2029] divide-x divide-[#1C2029] bg-[#0B0D11]/40">
              <div className="px-8 py-3.5">
                <div className="text-[10px] uppercase tracking-wider text-[#888E9B]">
                  Right Ascension
                </div>
                <div className="text-[13px] font-mono text-white tabular-nums mt-0.5">
                  {activeItem.target.coordinates.ra_hms}
                </div>
                <div className="text-[10px] font-mono text-[#888E9B] tabular-nums">
                  {activeItem.target.coordinates.ra_deg.toFixed(5)}°
                </div>
              </div>

              <div className="px-8 py-3.5">
                <div className="text-[10px] uppercase tracking-wider text-[#888E9B]">
                  Declination
                </div>
                <div className="text-[13px] font-mono text-white tabular-nums mt-0.5">
                  {activeItem.target.coordinates.dec_dms}
                </div>
                <div className="text-[10px] font-mono text-[#888E9B] tabular-nums">
                  {activeItem.target.coordinates.dec_deg.toFixed(5)}°
                </div>
              </div>

              <div className="px-8 py-3.5">
                <div className="text-[10px] uppercase tracking-wider text-[#888E9B]">
                  Proper Motion
                </div>
                <div className="text-[13px] font-mono text-white tabular-nums mt-0.5">
                  {activeItem.target.proper_motion
                    ? `${activeItem.target.proper_motion.pm_ra_mas_yr?.toFixed(1) ?? '0.0'}, ${
                        activeItem.target.proper_motion.pm_dec_mas_yr?.toFixed(1) ?? '0.0'
                      }`
                    : '—'}
                </div>
                <div className="text-[10px] font-mono text-[#888E9B]">
                  {activeItem.target.proper_motion ? 'mas / yr (ICRS)' : 'Stationary / Extragalactic'}
                </div>
              </div>

              <div className="px-8 py-3.5">
                <div className="text-[10px] uppercase tracking-wider text-[#888E9B]">
                  Surface Brightness
                </div>
                <div className="text-[13px] font-mono text-white tabular-nums mt-0.5">
                  {spectrum ? `${spectrum.peak_flux_mjy_sr.toFixed(2)} MJy/sr` : '—'}
                </div>
                <div className="text-[10px] font-mono text-[#888E9B] tabular-nums">
                  {spectrum ? `Mean ${spectrum.mean_flux_mjy_sr.toFixed(2)} MJy/sr` : '102 channels'}
                </div>
              </div>
            </div>

            {/* 3. Flush 102-Channel Spectral Curve */}
            {spectrum && (
              <div className="px-8 py-6 border-b border-[#1C2029]">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] uppercase tracking-wider text-[#888E9B]">
                    Wavelengths (0.75 – 5.00 µm)
                  </span>
                  <div className="flex items-center space-x-3 text-[10px] font-mono text-[#888E9B]">
                    {(['D1', 'D2', 'D3', 'D4', 'D5', 'D6'] as const).map((det) => (
                      <span key={det} className="flex items-center space-x-1">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: DETECTOR_COLORS[det] }}
                        />
                        <span>{det}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <div
                  onClick={() => handleOpenInTab(activeItem, 'Wavelengths')}
                  className="h-36 w-full cursor-pointer group"
                  title="Click to open interactive 102-channel spectrometer"
                >
                  <svg viewBox="0 0 880 120" className="w-full h-full overflow-visible">
                    <line x1="0" y1="20" x2="880" y2="20" stroke="#1C2029" strokeWidth="0.75" />
                    <line x1="0" y1="60" x2="880" y2="60" stroke="#1C2029" strokeWidth="0.75" />
                    <line x1="0" y1="100" x2="880" y2="100" stroke="#1C2029" strokeWidth="0.75" />
                    {(() => {
                      const pts = spectrum.spectral_points;
                      if (pts.length === 0) return null;
                      const fluxes = pts.map((p) => p.flux_mjy_sr);
                      const minF = Math.min(...fluxes) * 0.9;
                      const maxF = Math.max(0.1, Math.max(...fluxes) * 1.1);
                      const getX = (w: number) => 8 + ((w - 0.75) / (5.0 - 0.75)) * 864;
                      const getY = (f: number) =>
                        102 - ((f - minF) / Math.max(0.01, maxF - minF)) * 84;
                      const pathD = pts
                        .map(
                          (p, idx) =>
                            `${idx === 0 ? 'M' : 'L'} ${getX(p.wavelength_um).toFixed(1)} ${getY(
                              p.flux_mjy_sr
                            ).toFixed(1)}`
                        )
                        .join(' ');
                      return (
                        <>
                          <path
                            d={pathD}
                            fill="none"
                            stroke="#FFFFFF"
                            strokeWidth="1.25"
                            className="opacity-85 group-hover:opacity-100 transition-opacity"
                          />
                          {pts.map((p) => (
                            <circle
                              key={p.channel_index}
                              cx={getX(p.wavelength_um)}
                              cy={getY(p.flux_mjy_sr)}
                              r="2"
                              fill={DETECTOR_COLORS[p.detector] || '#FFFFFF'}
                            />
                          ))}
                        </>
                      );
                    })()}
                  </svg>
                </div>
              </div>
            )}

            {/* 4. Flush Apple-Notes Style Notes Area (Auto-Saves) */}
            <div className="px-8 py-6 flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] uppercase tracking-wider text-[#888E9B]">
                  Notes
                </span>
                <span className="text-[10px] font-mono text-[#888E9B]">
                  Saved {activeItem.savedAt.slice(0, 10)}
                </span>
              </div>
              <textarea
                value={activeItem.notes}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder="Write observation notes..."
                className="flex-1 w-full bg-transparent text-[13px] text-white/90 placeholder-[#888E9B]/50 leading-relaxed focus:outline-none resize-none"
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default CollectionsView;
