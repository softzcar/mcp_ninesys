import pino from "pino";

const level = process.env.LOG_LEVEL || "info";

// En desarrollo usamos pino-pretty si está disponible; en producción, JSON plano.
const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level,
  // Nunca registrar secretos ni PII sensible.
  redact: {
    paths: [
      "authorization",
      "req.headers.authorization",
      "*.token",
      "*.MSG_SERVICE_INTERNAL_TOKEN",
      "headers.x-internal-token",
      "req.headers['x-internal-token']",
    ],
    censor: "[redacted]",
  },
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        },
      }
    : {}),
});

export function createLogger(name: string) {
  return logger.child({ mod: name });
}
