import "dotenv/config";

export const PORT = Number(process.env.PORT || 3100);

export const API_URL =
  process.env.NINESYS_API_URL || "https://api.ninesys19.com";

export const CDN_URL =
  process.env.NINESYS_CDN_URL || "https://cdn.ninesys19.com";

export const INTERNAL_TOKEN = process.env.MSG_SERVICE_INTERNAL_TOKEN || "";

export const API_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS || 5000);

// Reintentos + backoff (portado de msg_ninesys/src/services/aiService.js).
export const API_RETRIES = Number(process.env.API_RETRIES || 2);
export const BACKOFF_BASE_MS = 400;

// Circuit breaker por proceso.
export const CB_FAIL_THRESHOLD = Number(process.env.API_CB_THRESHOLD || 5);
export const CB_COOLDOWN_MS = Number(process.env.API_CB_COOLDOWN_MS || 30_000);

// Cache TTL en memoria por recurso (ms). Valores heredados de los clientes
// actuales de msg_ninesys: catálogo 2 min, órdenes 3 min, telas/tallas/horario
// cambian poco → 10 min, galería 5 min.
export const CACHE_TTL = {
  catalog: 2 * 60 * 1000,
  orders: 3 * 60 * 1000,
  customer: 3 * 60 * 1000,
  fabrics: 10 * 60 * 1000,
  sizes: 10 * 60 * 1000,
  businessHours: 10 * 60 * 1000,
  galleryImages: 5 * 60 * 1000,
  galleryCategories: 10 * 60 * 1000,
} as const;

// Límite de caracteres para respuestas en texto (evita inundar el contexto del LLM).
export const CHARACTER_LIMIT = 12000;

// Límite duro de productos devueltos por búsqueda de catálogo.
export const MAX_CATALOG_ITEMS = 25;
