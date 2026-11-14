export interface Health {
  status: 'healthy';
  service: 'AURAx API';
  version: string;
}

const apiBase = (import.meta.env.VITE_API_BASE_URL || '/backend').replace(/\/+$/, '');

export async function fetchHealth(signal?: AbortSignal): Promise<Health> {
  const response = await fetch(`${apiBase}/health`, {
    signal,
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Backend is unavailable.');
  const data: unknown = await response.json();
  if (
    typeof data !== 'object' || data === null ||
    !('status' in data) || data.status !== 'healthy' ||
    !('service' in data) || data.service !== 'AURAx API' ||
    !('version' in data) || typeof data.version !== 'string' ||
    data.version.length === 0
  ) throw new Error('Backend returned an invalid health response.');
  return { status: 'healthy', service: 'AURAx API', version: data.version };
}
