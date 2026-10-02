import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import {
  API_URL,
  CDN_URL,
  INTERNAL_TOKEN,
  API_TIMEOUT_MS,
  API_RETRIES,
  BACKOFF_BASE_MS,
  CB_FAIL_THRESHOLD,
  CB_COOLDOWN_MS,
} from "../constants.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("apiClient");

// ---------------------------------------------------------------------------
// Error accionable: lo que ven las tools. Nunca expone datos crudos de axios.
// ---------------------------------------------------------------------------
export class ApiError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, opts: { status?: number; code?: string } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
  }
}

// ---------------------------------------------------------------------------
// Circuit breaker por proceso (portado de aiService.js de msg_ninesys).
// ---------------------------------------------------------------------------
type BreakerState = "closed" | "open" | "half-open";
const breaker: { state: BreakerState; failures: number; openedAt: number } = {
  state: "closed",
  failures: 0,
  openedAt: 0,
};

function breakerCanPass(): boolean {
  if (breaker.state === "closed") return true;
  if (breaker.state === "open") {
    if (Date.now() - breaker.openedAt >= CB_COOLDOWN_MS) {
      breaker.state = "half-open";
      log.warn({ cb: breaker.state }, "circuit breaker half-open: probando 1 request");
      return true;
    }
    return false;
  }
  return true; // half-open deja pasar el probe
}
function breakerOnSuccess() {
  if (breaker.state !== "closed" || breaker.failures > 0) {
    log.info({ cb: "closed", prevFailures: breaker.failures }, "circuit breaker cerrado");
  }
  breaker.state = "closed";
  breaker.failures = 0;
  breaker.openedAt = 0;
}
function breakerOnFailure() {
  breaker.failures += 1;
  if (breaker.state === "half-open" || breaker.failures >= CB_FAIL_THRESHOLD) {
    breaker.state = "open";
    breaker.openedAt = Date.now();
    log.error(
      { cb: "open", failures: breaker.failures, cooldownMs: CB_COOLDOWN_MS },
      "circuit breaker ABIERTO — pausando llamadas a la API"
    );
  }
}
export function getBreakerState() {
  return {
    state: breaker.state,
    failures: breaker.failures,
    cooldownRemainingMs:
      breaker.state === "open"
        ? Math.max(0, CB_COOLDOWN_MS - (Date.now() - breaker.openedAt))
        : 0,
  };
}

function isRetryable(err: unknown): boolean {
  const e = err as { code?: string; response?: { status?: number }; message?: string };
  if (!e) return false;
  if (e.code === "ETIMEDOUT" || e.code === "ECONNRESET" || e.code === "ECONNABORTED") return true;
  if (e.message && /timeout/i.test(e.message)) return true;
  const status = e.response?.status;
  return status === 429 || status === 502 || status === 503 || status === 504;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Instancias axios: API interna (con X-Internal-Token) y CDN (público).
// ---------------------------------------------------------------------------
const apiHttp: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: API_TIMEOUT_MS,
  headers: {
    Accept: "application/json",
    "X-Internal-Token": INTERNAL_TOKEN,
  },
});

const cdnHttp: AxiosInstance = axios.create({
  baseURL: CDN_URL,
  timeout: 8000,
  headers: {
    Accept: "application/json",
    "X-Internal-Token": INTERNAL_TOKEN,
  },
});


async function withResilience<T>(fn: () => Promise<T>, ctx: string): Promise<T> {
  if (!breakerCanPass()) {
    throw new ApiError(
      "El servicio de datos está temporalmente saturado. Reintenta en unos segundos.",
      { code: "CIRCUIT_OPEN" }
    );
  }
  let lastErr: unknown;
  const maxAttempts = 1 + API_RETRIES;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fn();
      breakerOnSuccess();
      return res;
    } catch (e) {
      lastErr = e;
      const retryable = isRetryable(e);
      log.warn({ ctx, attempt, maxAttempts, retryable }, "llamada a la API falló");
      if (!retryable || attempt === maxAttempts) break;
      const base = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      await sleep(base + Math.random() * base * 0.5);
    }
  }
  breakerOnFailure();
  const e = lastErr as { response?: { status?: number; data?: { message?: string; error?: string } }; code?: string; message?: string };
  const status = e?.response?.status;
  const reason = e?.response?.data?.message || e?.response?.data?.error || e?.code || e?.message || "error desconocido";
  throw new ApiError(`No se pudo obtener datos de la API (${ctx}): ${reason}`, {
    status,
    code: e?.code,
  });
}

/**
 * GET a un endpoint interno de ninesys-api con el header Authorization:{id_empresa}.
 */
export async function apiGet<T>(
  path: string,
  idEmpresa: number,
  params?: Record<string, unknown>
): Promise<T> {
  const config: AxiosRequestConfig = {
    params,
    headers: { Authorization: String(idEmpresa) },
  };
  return withResilience<T>(async () => {
    const res = await apiHttp.get<T>(path, config);
    return res.data;
  }, `GET ${path} emp=${idEmpresa}`);
}

/**
 * GET al CDN (galería). No usa Authorization por tenant; id_empresa va como query.
 */
export async function cdnGet<T>(params: Record<string, unknown>): Promise<T> {
  return withResilience<T>(async () => {
    const res = await cdnHttp.get<T>("/", { params });
    return res.data;
  }, `CDN ${JSON.stringify(params)}`);
}

/**
 * POST a un endpoint interno de ninesys-api con el header Authorization:{id_empresa}.
 */
export async function apiPost<T>(
  path: string,
  idEmpresa: number,
  data?: unknown
): Promise<T> {
  const config: AxiosRequestConfig = {
    headers: {
      Authorization: String(idEmpresa),
      "Content-Type": "application/json",
    },
  };
  return withResilience<T>(async () => {
    const res = await apiHttp.post<T>(path, data, config);
    return res.data;
  }, `POST ${path} emp=${idEmpresa}`);
}
