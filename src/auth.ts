import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { createLogger } from "./lib/logger.js";

const log = createLogger("auth");

// Parseo de MCP_CLIENT_TOKENS: "nombre:token,nombre2:token2" o "token,token2".
// Devuelve Map<token, nombreCliente> para identificar al llamador en logs sin
// registrar el token.
function parseClientTokens(): Map<string, string> {
  const raw = process.env.MCP_CLIENT_TOKENS || "";
  const map = new Map<string, string>();
  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    const idx = entry.indexOf(":");
    if (idx > 0) {
      const name = entry.slice(0, idx).trim();
      const token = entry.slice(idx + 1).trim();
      if (token) map.set(token, name);
    } else {
      map.set(entry, "anon");
    }
  }
  return map;
}

const CLIENT_TOKENS = parseClientTokens();

if (CLIENT_TOKENS.size === 0) {
  log.warn(
    "MCP_CLIENT_TOKENS está vacío — TODAS las peticiones serán rechazadas con 401. Configura al menos un token por app."
  );
}

// Comparación en tiempo constante para no filtrar longitud/prefijo por timing.
function safeMatch(provided: string): string | null {
  const providedBuf = Buffer.from(provided);
  for (const [token, name] of CLIENT_TOKENS) {
    const tokenBuf = Buffer.from(token);
    if (tokenBuf.length === providedBuf.length && timingSafeEqual(tokenBuf, providedBuf)) {
      return name;
    }
  }
  return null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      mcpClient?: string;
      idEmpresa?: number;
    }
  }
}

// Nombre de la cabecera que identifica la empresa (tenant) en cada petición.
export const EMPRESA_HEADER = "x-ninesys-empresa";

/**
 * Exige Authorization: Bearer <token> contra MCP_CLIENT_TOKENS.
 * En éxito, anota req.mcpClient con el nombre de la app llamante.
 */
export function requireBearer(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    log.warn({ ip: req.ip, path: req.path }, "petición sin Bearer token");
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "No autorizado: falta el header Authorization: Bearer <token>." },
      id: null,
    });
    return;
  }
  const clientName = safeMatch(m[1]);
  if (!clientName) {
    log.warn({ ip: req.ip, path: req.path }, "Bearer token inválido");
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "No autorizado: token inválido." },
      id: null,
    });
    return;
  }
  req.mcpClient = clientName;
  next();
}

/**
 * Exige e valida la cabecera X-Ninesys-Empresa (entero positivo). El MCP existe
 * solo para extraer datos de una empresa concreta: sin empresa identificada no
 * hay acceso. Debe ir DESPUÉS de requireBearer. Anota req.idEmpresa.
 */
export function requireEmpresa(req: Request, res: Response, next: NextFunction): void {
  const raw = req.headers[EMPRESA_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  if (!value || !Number.isInteger(id) || id <= 0) {
    log.warn({ client: req.mcpClient, path: req.path, empresa: value ?? null }, "petición sin empresa válida");
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32002,
        message: `Empresa no identificada: falta o es inválida la cabecera ${EMPRESA_HEADER} (entero positivo).`,
      },
      id: null,
    });
    return;
  }
  req.idEmpresa = id;
  next();
}
