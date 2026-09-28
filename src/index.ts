import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { PORT, INTERNAL_TOKEN } from "./constants.js";
import { requireBearer, requireEmpresa } from "./auth.js";
import { registerAllTools } from "./tools/index.js";
import { getBreakerState } from "./services/apiClient.js";
import { createLogger } from "./lib/logger.js";

const log = createLogger("index");

// Crea una instancia de McpServer con todas las tools registradas y atadas a la
// empresa de la petición. En modo stateless se crea una por request (barato),
// lo que permite inyectar la empresa server-side sin estado compartido.
function buildServer(idEmpresa: number): McpServer {
  const server = new McpServer({
    name: "ninesys-mcp-server",
    version: "0.1.0",
  });
  registerAllTools(server, { idEmpresa });
  return server;
}

async function main() {
  if (!INTERNAL_TOKEN) {
    log.warn(
      "MSG_SERVICE_INTERNAL_TOKEN vacío — las llamadas a los endpoints /internal de la API serán rechazadas (401)."
    );
  }

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Health check público (sin auth): para Nginx/uptime y verificación de arranque.
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "ninesys-mcp-server", breaker: getBreakerState() });
  });

  // Endpoint MCP: Streamable HTTP stateless (JSON). Requiere Bearer token (app)
  // y empresa identificada (X-Ninesys-Empresa) — sin empresa no hay acceso.
  app.post("/mcp", requireBearer, requireEmpresa, async (req: Request, res: Response) => {
    const server = buildServer(req.idEmpresa!);
    const transport = new StreamableHTTPServerTransport({
      // stateless: sin gestión de sesiones (más simple de escalar detrás de Nginx/PM2).
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error({ err: (err as Error).message, client: req.mcpClient }, "error manejando request MCP");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Error interno del servidor MCP." },
          id: null,
        });
      }
    }
  });

  // El transporte stateless no soporta GET (SSE) ni DELETE (sesiones).
  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Método no permitido (servidor MCP stateless)." },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.listen(PORT, () => {
    log.info({ port: PORT }, "ninesys-mcp-server escuchando");
  });
}

main().catch((err) => {
  log.error({ err: (err as Error).message }, "fallo al arrancar el servidor");
  process.exit(1);
});
