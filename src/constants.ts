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

// SIN caché de datos (todos los TTL en 0). Decisión de producto: el asistente
// debe reflejar SIEMPRE el estado real en vivo. Cachear daría respuestas
// obsoletas — un producto recién creado que "no existe", un abono ya hecho que
// figura como impago, etc. El volumen de consultas internas es bajo y el circuit
// breaker/timeout ya protegen contra fallos de la API.
export const CACHE_TTL = {
  catalog: 0,
  orders: 0,
  customer: 0,
  fabrics: 0,
  sizes: 0,
  businessHours: 0,
  galleryImages: 0,
  galleryCategories: 0,
} as const;

// Límite de caracteres para respuestas en texto (evita inundar el contexto del LLM).
export const CHARACTER_LIMIT = 12000;

// Límite duro de productos devueltos por búsqueda de catálogo.
export const MAX_CATALOG_ITEMS = 25;
