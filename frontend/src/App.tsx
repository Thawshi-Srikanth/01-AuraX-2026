import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SearchModal } from './components/SearchModal';
import { LandingView } from './views/LandingView';
import { DocsView } from './views/DocsView';
import { ExploreView } from './views/ExploreView';
import { ObservationsView } from './views/ObservationsView';
import { CompareView } from './views/CompareView';
import { CollectionsView } from './views/CollectionsView';
import { NavigationTab } from './tokens/colors';
import { ResolvedTarget, resolveTarget } from './services/api';

import { AnalysisContext } from './utils/AnalysisContext';
import { emptySession, readSession, readRoute, routeUrl, validSession, targetIdentity, SESSION_KEY } from './utils/navigation';
import type { AnalysisSession } from './utils/navigation';

function boot() {
  let session = emptySession();
  try { session = readSession(window.sessionStorage); } catch { /* Storage can be unavailable. */ }
  return readRoute(window.location, session);
}

export function App() {
  const parsed = useMemo(boot, []);
  const [activeTab, setActiveTab] = useState<NavigationTab>(parsed.tab);
  const [session, setSession] = useState<AnalysisSession>(parsed.session);
  const [nameRequest, setNameRequest] = useState<string | null>(parsed.resolveName || null);
  const [routeProblem, setRouteProblem] = useState<string | null>(parsed.error || null);
  const [revision, setRevision] = useState(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const pushNext = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const target = session.target;
  const targetKey = targetIdentity(target);
  const context = useMemo(() => ({ session, setSession }), [session]);
  const setTarget = useCallback((next: ResolvedTarget) => {
    pushNext.current = targetIdentity(next) !== targetIdentity(sessionRef.current.target);
    setNameRequest(null); setRouteProblem(null);
    // Saved-target launchers select a target and navigate in the same event.
    sessionRef.current = { ...sessionRef.current, target: next };
    setSession(current => ({ ...current, target: next }));
  }, []);
  const navigate = useCallback((tab: NavigationTab) => {
    if (tab === 'Wavelengths') {
      tab = 'Observations';
    }
    pushNext.current = pushNext.current || tab !== activeTab || !!nameRequest || !!routeProblem;
    setNameRequest(null); setRouteProblem(null); setActiveTab(tab);
  }, [activeTab, nameRequest, routeProblem]);

  useEffect(() => {
    if (!nameRequest) return;
    let cancelled = false;
    const location = { pathname: window.location.pathname, search: window.location.search };
    resolveTarget(nameRequest).then(resolved => {
      if (cancelled) return;
      const params = new URLSearchParams(location.search);
      params.set('ra', String(resolved.coordinates.ra_deg)); params.set('dec', String(resolved.coordinates.dec_deg));
      setSession(current => readRoute({ ...location, search: '?' + params }, { ...current, target: resolved }).session);
      setNameRequest(null);
    }).catch(() => { if (!cancelled) { setRouteProblem('This target name could not be resolved. Choose a sample or enter coordinates on Home.'); setNameRequest(null); } });
    return () => { cancelled = true; };
  }, [nameRequest, revision]);

  useEffect(() => {
    try { window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* In-memory navigation still works. */ }
    if (nameRequest || routeProblem) return;
    const shouldPush = pushNext.current;
    pushNext.current = false;
    const url = routeUrl(activeTab, session) + (activeTab === 'Docs' && !shouldPush ? window.location.hash : '');
    const state = { aurax: 1, tab: activeTab, session };
    if (shouldPush && url !== window.location.pathname + window.location.search + window.location.hash) window.history.pushState(state, '', url);
    else window.history.replaceState(state, '', url);
  }, [activeTab, session, nameRequest, routeProblem]);

  useEffect(() => {
    function onPop(event: PopStateEvent) {
      pushNext.current = false;
      const snapshot: unknown = event.state?.session;
      const next = readRoute(window.location, validSession(snapshot) ? snapshot : sessionRef.current);
      setSession(next.session); setActiveTab(next.tab); setNameRequest(next.resolveName || null); setRouteProblem(next.error || null);
      setRevision(value => value + 1);
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setIsSearchOpen(value => !value); }
      else if (event.key === '/' && !isSearchOpen && !['input', 'textarea'].includes((event.target as HTMLElement)?.tagName?.toLowerCase())) { event.preventDefault(); setIsSearchOpen(true); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen]);

  return (
    <AnalysisContext.Provider value={context}><div className="min-h-screen h-screen flex flex-col bg-bg-app text-text-primary select-none">
      {/* SpaceX Mission Navbar */}
      <Navbar
        activeTab={activeTab === 'Wavelengths' ? 'Observations' : activeTab}
        onTabChange={navigate}
        onOpenSearch={() => setIsSearchOpen(true)}
        targetLabel={nameRequest ? 'Resolving ' + nameRequest : routeProblem ? 'No valid link target' : target.query || target.canonical_name}
        coordinateLabel={nameRequest || routeProblem ? undefined : 'RA ' + target.coordinates.ra_deg.toFixed(5) + '° · Dec ' + target.coordinates.dec_deg.toFixed(5) + '°'}
        labelUnverified={!nameRequest && !routeProblem && ['URL label — not independently verified', 'Example starting coordinates; not catalog verified'].includes(target.provenance)}
      />

      {/* Main Viewport Container */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <ErrorBoundary>
          {nameRequest || routeProblem ? <section className="m-auto max-w-xl p-8 text-center" role="status"><p>{nameRequest ? 'Resolving ' + nameRequest + '…' : routeProblem}</p><button type="button" className="mt-6 underline" onClick={() => navigate('Home')}>Open Home</button></section> : <>
          {activeTab === 'Home' && (
            <LandingView
              onNavigate={navigate}
              onTargetResolved={setTarget}
              activeTarget={target}
            />
          )}
          {activeTab === 'Explore' && (
            <ExploreView
              onNavigate={navigate}
              onTargetResolved={setTarget}
              activeTarget={target}
            />
          )}
          {(activeTab === 'Observations' || activeTab === 'Wavelengths') && (
            <ObservationsView key={targetKey + ":" + revision}
              target={target}
              onNavigate={navigate}
              onTargetResolved={setTarget}
            />
          )}
          {activeTab === 'Compare' && (
            <CompareView key={targetKey + ":" + revision} target={target} />
          )}
          {activeTab === 'Collections' && (
            <CollectionsView
              currentTarget={target}
              onSelectTarget={setTarget}
              onNavigate={navigate}
            />
          )}
          {activeTab === 'Docs' && (
            <DocsView onNavigate={navigate} />
          )}
          </>}
        </ErrorBoundary>
      </main>

      {/* Global Command Palette / Search Modal */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onTargetResolved={setTarget}
        onNavigate={navigate}
        currentTab={activeTab === 'Home' || activeTab === 'Docs' ? 'Observations' : activeTab}
      />
    </div></AnalysisContext.Provider>
  );
}

export default App;
