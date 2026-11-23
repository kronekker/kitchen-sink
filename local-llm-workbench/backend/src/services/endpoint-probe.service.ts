import { EndpointHealthState, EndpointProbeResult, LlmEndpoint, ModelInfo } from '@shared/index';

const PROBE_TIMEOUT_MS = 2500;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function buildHeaders(apiKey: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return headers;
}

async function fetchJsonWithTimeout(
  url: string,
  headers: Record<string, string>
): Promise<{ ok: boolean; status: number; body: any; latencyMs: number }> {
  const started = performance.now();
  const res = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const latencyMs = Math.round(performance.now() - started);
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body, latencyMs };
}

export async function probeEndpoint(endpoint: LlmEndpoint): Promise<EndpointProbeResult> {
  const base = normalizeBaseUrl(endpoint.baseUrl);
  const headers = buildHeaders(endpoint.apiKey);
  const checkedAt = new Date().toISOString();

  let status: EndpointHealthState = 'offline';
  let models: ModelInfo[] = [];
  let latencyMs: number | null = null;
  let errorMessage: string | undefined;

  try {
    // Primary probe: OpenAI-compatible /v1/models
    const modelsRes = await fetchJsonWithTimeout(`${base}/v1/models`, headers);
    latencyMs = modelsRes.latencyMs;

    if (modelsRes.ok && modelsRes.body) {
      const list = Array.isArray(modelsRes.body.data)
        ? modelsRes.body.data
        : Array.isArray(modelsRes.body.models)
          ? modelsRes.body.models
          : [];

      models = list
        .map((m: any) => ({
          id: String(m.id ?? m.name ?? m.model ?? ''),
          ownedBy: m.owned_by ? String(m.owned_by) : undefined,
        }))
        .filter((m: ModelInfo) => m.id.length > 0);

      status = 'online';
    } else if (modelsRes.status === 503) {
      const msg = String(modelsRes.body?.error?.message ?? modelsRes.body?.status ?? '');
      if (msg.toLowerCase().includes('loading')) {
        status = 'loading';
      } else {
        status = 'offline';
        errorMessage = msg || `HTTP 503`;
      }
    } else {
      // Fallback: check /health (e.g., llama-server loading or non-standard server)
      try {
        const healthRes = await fetchJsonWithTimeout(`${base}/health`, headers);
        latencyMs = healthRes.latencyMs;
        if (healthRes.ok) {
          status = 'online';
        } else if (
          healthRes.status === 503 &&
          JSON.stringify(healthRes.body ?? '').toLowerCase().includes('loading')
        ) {
          status = 'loading';
        } else {
          status = 'offline';
          errorMessage = `HTTP ${modelsRes.status}`;
        }
      } catch {
        status = 'offline';
        errorMessage = `HTTP ${modelsRes.status}`;
      }
    }
  } catch (err: any) {
    status = 'offline';
    const causeCode = err?.cause?.code;
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      errorMessage = 'Connection timed out';
    } else if (causeCode === 'ECONNREFUSED') {
      errorMessage = 'Connection refused';
    } else {
      errorMessage = err?.message || 'Unreachable';
    }
  }

  return {
    endpointId: endpoint.id,
    name: endpoint.name,
    baseUrl: endpoint.baseUrl,
    isBuiltIn: endpoint.isBuiltIn,
    status,
    models,
    activeModel: models.length > 0 ? models[0].id : null,
    latencyMs,
    checkedAt,
    error: errorMessage,
  };
}
