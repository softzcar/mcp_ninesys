import { CHARACTER_LIMIT } from "../constants.js";
import { ApiError } from "../services/apiClient.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("tools");

// Forma del retorno de un handler de tool del SDK de MCP.
// El índice [x: string] es requerido por el tipo CallToolResult del SDK.
export interface ToolResult {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Construye una respuesta de tool con texto (markdown o json) y, opcionalmente,
 * datos estructurados. Trunca el texto al CHARACTER_LIMIT para no inundar el
 * contexto del LLM.
 */
export function ok(
  text: string,
  structured?: Record<string, unknown>
): ToolResult {
  let out = text;
  if (out.length > CHARACTER_LIMIT) {
    out = out.slice(0, CHARACTER_LIMIT) + "\n\n[...salida truncada...]";
  }
  return {
    content: [{ type: "text", text: out }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

/**
 * Respuesta de error de tool: mensaje accionable, marcada como isError para que
 * el cliente MCP la distinga de un resultado normal.
 */
export function fail(message: string): ToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Envuelve un handler async: captura ApiError y errores inesperados y los
 * convierte en respuestas de tool accionables (nunca lanza al transporte).
 */
export function guard<A>(
  name: string,
  handler: (args: A) => Promise<ToolResult>
): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return await handler(args);
    } catch (err) {
      if (err instanceof ApiError) {
        log.warn({ tool: name, status: err.status, code: err.code }, err.message);
        return fail(err.message);
      }
      log.error({ tool: name, err: (err as Error).message }, "error inesperado en tool");
      return fail(`Fallo interno procesando la solicitud (${name}).`);
    }
  };
}
