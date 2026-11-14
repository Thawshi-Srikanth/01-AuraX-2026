import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AnalysisSession } from './navigation';
import { preference, setPreference } from './navigation';

export const AnalysisContext = createContext<{ session: AnalysisSession; setSession: Dispatch<SetStateAction<AnalysisSession>> } | null>(null);
export function useRetainedState<T>(view: string, targetKey: string, field: string, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const context = useContext(AnalysisContext);
  if (!context) throw new Error('Analysis preferences require the application context.');
  const { session, setSession } = context;
  const initial = useRef(fallback).current;
  const value = preference(session, targetKey, view, field, initial);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(next => {
    setSession(current => {
      const before = preference(current, targetKey, view, field, initial);
      const after = typeof next === 'function' ? (next as (value: T) => T)(before) : next;
      return setPreference(current, targetKey, view, field, after);
    });
  }, [setSession, targetKey, view, field, initial]);
  useEffect(() => { setValue(current => current); }, [setValue]);
  return [value, setValue];
}
