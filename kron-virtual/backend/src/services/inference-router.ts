import { ActiveEngineStatus, EngineModelInfo } from '@shared/index';

interface EngineCandidate {
  port: number;
  label: string;
  baseUrl: string;
}

const CANDIDATES: EngineCandidate[] = [
  { port: 8080, label: 'llama-server (8080)', baseUrl: 'http://127.0.0.1:8080' },
  { port: 8081, label: 'ai-toolbox-cockpit (8081)', baseUrl: 'http://127.0.0.1:8081' },
];

const PROBE_TIMEOUT_MS = 1800;
const CACHE_TTL_MS = 4000;

let cachedStatus: ActiveEngineStatus | null = null;
let cachedAtMs = 0;

interface CandidateProbe {
  candidate: EngineCandidate;
  status: 'online' | 'loading' | 'offline';
  models: EngineModelInfo[];
  activeModel: string | null;
  latencyMs: number | null;
  error?: string;
}

async function probeCandidate(candidate: EngineCandidate): Promise<CandidateProbe> {
  const start = performance.now();

  try {
    const modelsRes = await fetch(`${candidate.baseUrl}/v1/models`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    const latencyMs = Math.round(performance.now() - start);

    if (modelsRes.ok) {
      const json: any = await modelsRes.json().catch(() => null);
      const rawList: any[] = Array.isArray(json?.data) ? json.data : [];
      const models: EngineModelInfo[] = rawList
        .filter((m) => m && typeof m.id === 'string')
        .map((m) => ({
          id: m.id,
          ownedBy: typeof m.owned_by === 'string' ? m.owned_by : undefined,
        }));

      return {
        candidate,
        status: 'online',
        models,
        activeModel: models[0]?.id ?? null,
        latencyMs,
      };
    }

    if (modelsRes.status === 503) {
      return {
        candidate,
        status: 'loading',
        models: [],
        activeModel: null,
        latencyMs,
        error: 'Model is loading (HTTP 503)',
      };
    }

    // Fallback check on /health for servers like llama.cpp that expose loading state there
    const healthRes = await fetch(`${candidate.baseUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(1000),
    }).catch(() => null);

    if (healthRes && healthRes.status === 503) {
      return {
        candidate,
        status: 'loading',
        models: [],
        activeModel: null,
        latencyMs: Math.round(performance.now() - start),
        error: 'Model is loading',
      };
    }

    return {
      candidate,
      status: 'offline',
      models: [],
      activeModel: null,
      latencyMs,
      error: `HTTP ${modelsRes.status}`,
    };
  } catch (err: any) {
    return {
      candidate,
      status: 'offline',
      models: [],
      activeModel: null,
      latencyMs: null,
      error: err?.name === 'TimeoutError' ? 'Timed out' : err?.message || 'Connection failed',
    };
  }
}

export async function getActiveEngineStatus(forceRefresh = false): Promise<ActiveEngineStatus> {
  const nowMs = Date.now();
  if (!forceRefresh && cachedStatus && nowMs - cachedAtMs < CACHE_TTL_MS) {
    return cachedStatus;
  }

  const probes = await Promise.all(CANDIDATES.map((c) => probeCandidate(c)));
  const online = probes.find((p) => p.status === 'online');
  const loading = probes.find((p) => p.status === 'loading');
  const chosen = online ?? loading ?? null;

  const result: ActiveEngineStatus = chosen
    ? {
        status: chosen.status,
        port: chosen.candidate.port,
        label: chosen.candidate.label,
        baseUrl: chosen.candidate.baseUrl,
        activeModel: chosen.activeModel,
        models: chosen.models,
        latencyMs: chosen.latencyMs,
        error: chosen.error,
        checkedAt: new Date().toISOString(),
      }
    : {
        status: 'offline',
        port: null,
        label: null,
        baseUrl: null,
        activeModel: null,
        models: [],
        latencyMs: null,
        error: 'No local inference engine detected on localhost:8080 or localhost:8081.',
        checkedAt: new Date().toISOString(),
      };

  cachedStatus = result;
  cachedAtMs = nowMs;
  return result;
}

export async function resolveActiveEngine(): Promise<ActiveEngineStatus> {
  const status = await getActiveEngineStatus(false);
  if (status.status === 'online' && status.baseUrl) {
    return status;
  }
  return getActiveEngineStatus(true);
}
