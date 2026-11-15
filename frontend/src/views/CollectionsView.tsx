import React, { useState, useEffect, useMemo } from 'react';
import {
  Download,
  Search,
  Trash2,
  Plus,
  ArrowUpRight,
} from 'lucide-react';
import { NavigationTab, DETECTOR_COLORS } from '../tokens/colors';
import { SavedSpectrum } from '../components/SavedSpectrum';
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
  const [spectrumResult, setSpectrumResult] = useState<{ key: string; data?: SpectrumResponse; error?: string; loading?: boolean } | null>(null);
  const [sampleLimit, setSampleLimit] = useState(2);
  const [spectrumRequest, setSpectrumRequest] = useState({ key: '', limit: 2, revision: 0 });

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
      filteredItems[0] ||
      null
    );
  }, [filteredItems, selectedId]);

  const spectrum = spectrumResult?.key === activeItem?.id ? spectrumResult?.data ?? null : null;
  const spectrumError = spectrumResult?.key === activeItem?.id ? spectrumResult?.error : null;
  const spectrumLoading = spectrumResult?.key === activeItem?.id && !!spectrumResult?.loading;
  const activeId = activeItem?.id;
  const targetName = activeItem?.target.canonical_name || activeItem?.target.query;
  const targetRa = activeItem?.target.coordinates.ra_deg;
  const targetDec = activeItem?.target.coordinates.dec_deg;

  // A result is only displayed or exported for the saved target it belongs to.
  useEffect(() => {
    if (!activeId || !targetName || spectrumRequest.key !== activeId) return;
    const controller = new AbortController();
    const key = activeId;
    setSpectrumResult({ key, loading: true });
    fetchTargetSpectrum(
      targetName, targetRa, targetDec, controller.signal, spectrumRequest.limit,
    )
      .then((res) => {
        if (!controller.signal.aborted) setSpectrumResult({ key, data: res });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setSpectrumResult({ key, error: error instanceof Error ? error.message : 'Measured samples unavailable.' });
      });

    return () => {
      controller.abort();
    };
  }, [activeId, targetName, targetRa, targetDec, spectrumRequest]);

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
                  <span className="block text-[10px] text-[#888E9B]">Saved metadata · not revalidated</span>
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
                    onClick={() => handleOpenInTab(activeItem, 'Compare')}
                    className="px-3 py-1.5 text-[#888E9B] hover:text-white hover:bg-[#12151C] transition-colors cursor-pointer flex items-center space-x-1"
                  >
                    <span>Compare images</span>
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
                    <option value="csv" disabled={!spectrum}>CSV Spectrum (.csv)</option>
                    <option value="ipac" disabled={!spectrum}>NASA/IPAC Table (.tbl)</option>
                    <option value="votable" disabled={!spectrum}>IVOA VOTable (.xml)</option>
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
                  {activeItem.target.proper_motion ? 'mas / yr (ICRS)' : 'Not provided'}
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
                  {spectrum ? `${spectrum.total_channels} measured samples · mean ${spectrum.mean_flux_mjy_sr.toFixed(2)} MJy/sr` : spectrumError || (spectrumLoading ? 'Loading measured samples…' : 'Load spectral samples below')}
                </div>
              </div>
            </div>

            <section className="px-8 py-6 border-b border-[#1C2029]" aria-label="Saved target spectrum">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4"><div><h2 className="text-sm font-medium">Spectrum · measured samples</h2><p className="text-xs text-[#888E9B] mt-1">Real Level 2 measurements at the saved coordinates.</p></div><div className="flex flex-wrap items-center gap-2"><label className="text-xs text-[#888E9B]">Observation limit <select aria-label="Spectrum observation limit" className="ml-2 bg-[#0B0D11] border border-[#1C2029] rounded px-2 py-1.5 text-white" value={sampleLimit} disabled={spectrumLoading} onChange={event => setSampleLimit(Number(event.target.value))}>{[2, 4, 6].map(value => <option key={value} value={value}>{value}</option>)}</select></label><button type="button" className="bg-white text-black rounded px-3 py-2 text-xs disabled:opacity-40" disabled={spectrumLoading} onClick={() => setSpectrumRequest(previous => ({ key: activeItem.id, limit: sampleLimit, revision: previous.revision + 1 }))}>{spectrumLoading ? 'Loading samples…' : spectrum ? 'Refresh spectrum' : 'Load spectrum'}</button></div></div>
              {spectrumLoading && <p className="text-xs text-[#888E9B]" role="status">Loading small calibrated cutouts one at a time. Only usable measured pixels will appear.</p>}
              {spectrumError && <p className="text-xs text-amber-300" role="alert">{spectrumError}</p>}
              {spectrum && <SavedSpectrum spectrum={spectrum} />}
              {!spectrum && !spectrumLoading && !spectrumError && <p className="text-xs text-[#888E9B]">Press Load spectrum to query up to {sampleLimit} observations. Saving a target stores its coordinates and notes; measurements are retrieved from the archive when requested.</p>}
            </section>

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
