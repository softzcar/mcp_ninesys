import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet } from "../services/apiClient.js";
import { cached } from "../services/cache.js";
import { CACHE_TTL } from "../constants.js";
import { responseFormat } from "../schemas/inputs.js";
import { ok, guard } from "./helpers.js";
import type { RequestContext } from "./index.js";
import type {
  FabricsResponse,
  SizesResponse,
  BusinessHoursResponse,
  BusinessHours,
} from "../types/api.js";

const DIAS = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function decimalToHHMM(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function formatSchedule(hr: BusinessHours): string {
  const dias = (hr.diasLaborales || [])
    .map(Number)
    .filter((d) => d >= 1 && d <= 7)
    .sort((a, b) => a - b)
    .map((d) => DIAS[d])
    .join(", ");
  const tramos: string[] = [];
  const num = (v: number | string | undefined) =>
    v === undefined || v === "" ? null : Number(v);
  const hIM = num(hr.horaInicioManana),
    hFM = num(hr.horaFinManana),
    hIT = num(hr.horaInicioTarde),
    hFT = num(hr.horaFinTarde);
  if (hIM != null && hFM != null) tramos.push(`${decimalToHHMM(hIM)}–${decimalToHHMM(hFM)}`);
  if (hIT != null && hFT != null) tramos.push(`${decimalToHHMM(hIT)}–${decimalToHHMM(hFT)}`);
  return `Horario de atención: ${dias || "días no especificados"} de ${
    tramos.length ? tramos.join(" y ") : "horario no especificado"
  }.`;
}

export function registerCatalogMetaTools(server: McpServer, ctx: RequestContext): void {
  const { idEmpresa: id_empresa } = ctx;
  // ---- Telas ----
  server.registerTool(
    "ninesys_list_fabrics",
    {
      title: "Listar telas disponibles",
      description: `Lista las telas disponibles de la empresa con su _id numérico y nombre.

Úsala cuando el cliente pregunta qué telas hay o necesitas el _id de una tela para armar un presupuesto. NO crea ni modifica nada. La empresa ya está fijada por la sesión.

Args:
  - response_format ('markdown' | 'json'): formato de salida (default: markdown).

Devuelve: { count, fabrics: [{ _id, nombre }] }.`,
      inputSchema: { response_format: responseFormat },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_list_fabrics", async (args) => {
      const { response_format } = args as {
        response_format: "markdown" | "json";
      };
      const data = await cached(`fabrics:${id_empresa}`, CACHE_TTL.fabrics, () =>
        apiGet<FabricsResponse>(`/telas`, id_empresa)
      );
      const fabrics = (Array.isArray(data?.data) ? data.data : [])
        .filter((r) => r && r.tela && r._id)
        .map((r) => ({ _id: Number(r._id), nombre: String(r.tela).trim() }));
      if (!fabrics.length) {
        return ok(`La empresa ${id_empresa} no tiene telas configuradas.`, { count: 0, fabrics: [] });
      }
      const structured = { count: fabrics.length, fabrics };
      if (response_format === "json") return ok(JSON.stringify(structured, null, 2), structured);
      const text = ["Telas disponibles:", "", ...fabrics.map((f) => `- ${f.nombre} [_id:${f._id}]`)].join("\n");
      return ok(text, structured);
    })
  );

  // ---- Tallas ----
  server.registerTool(
    "ninesys_list_sizes",
    {
      title: "Listar tallas disponibles",
      description: `Lista las tallas disponibles de la empresa.

Úsala cuando necesitas las tallas válidas para un producto o presupuesto. NO crea ni modifica nada. La empresa ya está fijada por la sesión.

Args:
  - response_format ('markdown' | 'json'): formato de salida (default: markdown).

Devuelve: { count, sizes: [...] } con los registros de talla tal como los entrega la API.`,
      inputSchema: { response_format: responseFormat },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_list_sizes", async (args) => {
      const { response_format } = args as {
        response_format: "markdown" | "json";
      };
      const data = await cached(`sizes:${id_empresa}`, CACHE_TTL.sizes, () =>
        apiGet<SizesResponse>(`/sizes`, id_empresa)
      );
      const sizes = Array.isArray(data?.data) ? data.data : [];
      const structured = { count: sizes.length, sizes: sizes as Record<string, unknown>[] };
      if (response_format === "json") return ok(JSON.stringify(structured, null, 2), structured);
      const names = sizes.map((s) => {
        const o = s as Record<string, unknown>;
        return String(o.nombre ?? o.name ?? o.talla ?? JSON.stringify(o));
      });
      const text = names.length
        ? ["Tallas disponibles:", "", ...names.map((n) => `- ${n}`)].join("\n")
        : `La empresa ${id_empresa} no tiene tallas configuradas.`;
      return ok(text, structured);
    })
  );

  // ---- Horario de atención ----
  server.registerTool(
    "ninesys_get_business_hours",
    {
      title: "Obtener horario de atención",
      description: `Devuelve el horario de atención de la empresa (días laborales y tramos de mañana/tarde).

Úsala cuando el cliente pregunta el horario, si están abiertos, o hasta qué hora atienden. NO crea ni modifica nada. La empresa ya está fijada por la sesión.

Args:
  - response_format ('markdown' | 'json'): formato de salida (default: markdown).

Devuelve: en markdown, una frase legible del horario; en json, { nombre, horario_laboral: { horaInicioManana, horaFinManana, horaInicioTarde, horaFinTarde, diasLaborales, ... } }.`,
      inputSchema: { response_format: responseFormat },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_get_business_hours", async (args) => {
      const { response_format } = args as {
        response_format: "markdown" | "json";
      };
      const data = await cached(`bh:${id_empresa}`, CACHE_TTL.businessHours, () =>
        apiGet<BusinessHoursResponse>(`/internal/business-hours`, id_empresa)
      );
      const structured = {
        nombre: data.nombre,
        horario_laboral: data.horario_laboral as unknown as Record<string, unknown>,
      };
      if (response_format === "json") return ok(JSON.stringify(structured, null, 2), structured);
      return ok(formatSchedule(data.horario_laboral), structured);
    })
  );
}
