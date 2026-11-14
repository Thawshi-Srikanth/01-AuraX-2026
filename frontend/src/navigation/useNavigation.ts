import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { emptySession, readRoute, readSession, routeUrl, writeSession } from './session';
import type { Position, View } from './session';

function boot() {
  let saved = emptySession();
  try { saved = readSession(window.sessionStorage); } catch { /* Storage may be blocked. */ }
  return readRoute(window.location, saved);
}

export function useNavigation() {
  const [route, setRoute] = useState(boot);
  useEffect(() => {
    const restore = () => setRoute(readRoute(window.location));
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    if (route.error) return;
    try { writeSession(window.sessionStorage, route); } catch { /* Use in-memory state. */ }
    const url = routeUrl(route.view, route.target) + window.location.hash;
    if (window.location.pathname + window.location.search + window.location.hash !== url) {
      window.history.replaceState(null, '', url);
    }
  }, [route]);

  function navigate(event: MouseEvent<HTMLAnchorElement>, view: View, target: Position | null = route.target) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const url = routeUrl(view, target);
    if (window.location.pathname + window.location.search + window.location.hash !== url) {
      window.history.pushState(null, '', url);
    }
    setRoute({ view, target, error: null });
  }
  function selectTarget(target: Position, view: View = route.view) {
    const url = routeUrl(view, target);
    if (window.location.pathname + window.location.search !== url) window.history.pushState(null, '', url);
    setRoute({ view, target, error: null });
  }
  return { route, navigate, selectTarget };
}
