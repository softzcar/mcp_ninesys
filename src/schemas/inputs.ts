import { z } from "zod";

// NOTA: la empresa (tenant) NO es un argumento de las tools. Se identifica a
// nivel de acceso (cabecera obligatoria X-Ninesys-Empresa, validada por el
// middleware) y el servidor la inyecta a cada tool desde el contexto de la
// petición. El LLM nunca la ve ni la controla → sin riesgo cross-empresa.

// Teléfono en dígitos, sin '+', formato de JID de WhatsApp (ej: 5804241234567).
export const phone = z
  .string()
  .trim()
  .regex(/^\d{7,15}$/, "El teléfono debe tener entre 7 y 15 dígitos, sin '+' ni espacios.")
  .describe("Número de teléfono del cliente en solo dígitos (ej: '5804241234567').");

export const responseFormat = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe(
    "Formato de salida: 'markdown' (legible, para presentar al usuario) o 'json' (datos estructurados)."
  );
