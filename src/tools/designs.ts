import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, cdnGet } from "../services/apiClient.js";
import { CDN_URL } from "../constants.js";
import { responseFormat } from "../schemas/inputs.js";
import { ok, guard } from "./helpers.js";
import type { RequestContext } from "./index.js";
import type {
  ChatImage,
  CdnApprovedResponse,
  OrderDesignsResponse,
  PendingDesignsResponse,
} from "../types/api.js";

const fmtDate = (s: string | null) => {
  if (!s) return "-";
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" });
};

const IMAGES_NOTE =
  "Las imágenes se muestran automáticamente en el chat debajo de tu respuesta: NO escribas ni pegues URLs, solo descríbelas.";

/**
 * Imagen aprobada final de la orden: archivo {orden}-a.{ext} en el CDN de la empresa.
 * El CDN responde {url:"images/<emp>/<orden>-a.png"} o {url:"images/no-image.png"}.
 */
async function fetchApprovedImage(idEmpresa: number, idOrden: number): Promise<string | null> {
  try {
    const r = await cdnGet<CdnApprovedResponse>({ id_orden: idOrden, id_empresa: idEmpresa, aprobada: "true" });
    const rel = r?.url || "";
    if (!rel || rel.includes("no-image")) return null;
    return /^https?:\/\//.test(rel) ? rel : `${CDN_URL.replace(/\/$/, "")}/${rel.replace(/^\//, "")}`;
  } catch {
    return null;
  }
}

export function registerDesignTools(server: McpServer, ctx: RequestContext): void {
  const { idEmpresa: id_empresa } = ctx;

  server.registerTool(
    "ninesys_get_order_designs",
    {
      title: "Diseños e imagen aprobada de una orden",
      description: `Devuelve los diseños de UNA orden: la IMAGEN APROBADA final (si existe) y todas las propuestas/revisiones de diseño con su tipo (Diseño Gráfico, Cambio de Color, Logo…), estado (Aprobado, Rechazado, Esperando Respuesta), número de revisión y fecha, cada una con su imagen.

Úsala para: "muéstrame el diseño de la orden X", "imagen aprobada de la orden X", "qué propuestas tiene la orden X", "cuál diseño se aprobó". ${IMAGES_NOTE} NO crea ni modifica nada. La empresa ya está fijada por la sesión.

Args:
  - id_orden (number): número de la orden.
  - response_format ('markdown' | 'json').`,
      inputSchema: {
        id_orden: z.number().int().positive().describe("Número de la orden."),
        response_format: responseFormat,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_get_order_designs", async (args) => {
      const { id_orden, response_format } = args as { id_orden: number; response_format: "markdown" | "json" };

      const [data, aprobada] = await Promise.all([
        apiGet<OrderDesignsResponse>(`/internal/ordenes/${id_empresa}/disenos`, id_empresa, { id: id_orden }),
        fetchApprovedImage(id_empresa, id_orden),
      ]);

      if (!data || !data.found) {
        return ok(`No existe la orden #${id_orden} en la empresa ${id_empresa}.`, { found: false });
      }
      const revisiones = data.revisiones || [];

      const images: ChatImage[] = [];
      if (aprobada) images.push({ url: aprobada, caption: `Orden #${id_orden} — imagen aprobada` });
      for (const r of revisiones) {
        if (r.url_image) {
          images.push({
            url: r.url_image,
            caption: `Orden #${id_orden} — ${r.tipo}${r.revision ? ` (rev. ${r.revision})` : ""} — ${r.estatus}`,
          });
        }
      }

      const structured = { found: true, id_orden, imagen_aprobada: aprobada, revisiones, images };
      if (response_format === "json") return ok(JSON.stringify(structured, null, 2), structured);

      const out: string[] = [`Diseños de la orden #${id_orden}:`, ""];
      out.push(aprobada ? "Imagen aprobada: SÍ (se muestra en el chat)." : "Imagen aprobada: no hay imagen aprobada cargada.");
      out.push("");
      if (!revisiones.length) {
        out.push("Sin propuestas/revisiones de diseño registradas.");
      } else {
        out.push(`Propuestas/revisiones (${revisiones.length}):`);
        for (const r of revisiones) {
          out.push(
            `- ${r.tipo}${r.revision ? ` rev. ${r.revision}` : ""} — ${r.estatus} — ${fmtDate(r.fecha)}` +
              (r.url_image ? " — con imagen" : " — sin imagen") +
              (r.detalles ? ` — detalle: ${r.detalles}` : "")
          );
        }
      }
      out.push("", IMAGES_NOTE);
      return ok(out.join("\n"), structured);
    })
  );

  server.registerTool(
    "ninesys_list_pending_designs",
    {
      title: "Diseños pendientes de aprobación",
      description: `Lista las propuestas de diseño que están ESPERANDO RESPUESTA del cliente (pendientes de aprobación) en toda la empresa, con número de orden, cliente, tipo, revisión, fecha e imagen. Más recientes primero (máx. 30).

Úsala para: "qué diseños están pendientes de aprobación", "propuestas esperando respuesta", "qué clientes no han aprobado su diseño". ${IMAGES_NOTE} NO crea ni modifica nada.

Args:
  - response_format ('markdown' | 'json').`,
      inputSchema: { response_format: responseFormat },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_list_pending_designs", async (args) => {
      const { response_format } = args as { response_format: "markdown" | "json" };
      const data = await apiGet<PendingDesignsResponse>(`/internal/disenos/${id_empresa}/pendientes`, id_empresa);
      const list = data?.pendientes || [];
      const images: ChatImage[] = list.map((p) => ({
        url: p.url_image,
        caption: `Orden #${p.id_orden} — ${p.cliente || "cliente"} — ${p.tipo}${p.revision ? ` (rev. ${p.revision})` : ""}`,
      }));
      const structured = { count: list.length, pendientes: list, images };
      if (!list.length) return ok("No hay propuestas de diseño esperando respuesta del cliente.", structured);
      if (response_format === "json") return ok(JSON.stringify(structured, null, 2), structured);

      const out = [`Propuestas esperando respuesta del cliente (${list.length}):`, ""];
      for (const p of list) {
        out.push(
          `- Orden #${p.id_orden} (${p.status_orden}) — ${p.cliente || "-"} — ${p.tipo}` +
            `${p.revision ? ` rev. ${p.revision}` : ""} — enviada ${fmtDate(p.fecha)}`
        );
      }
      out.push("", IMAGES_NOTE);
      return ok(out.join("\n"), structured);
    })
  );
}
