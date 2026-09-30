import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet } from "../services/apiClient.js";
import { ok, guard } from "./helpers.js";
import type { RequestContext } from "./index.js";

// Reposición = volver a producir parte de una orden porque algo salió mal
// (se dañó, faltó, salió con error). Datos de /internal/reposiciones/*.

interface Reposicion {
  id_reposicion: number;
  id_orden: number;
  estado: string;
  estado_orden: string | null;
  producto: string | null;
  talla: string | null;
  tela: string | null;
  corte: string | null;
  unidades: number;
  departamento_solicitante: string | null;
  solicitada_por: string | null;
  motivo: string | null;
  asignada_a: string | null;
  departamento_asignado: string | null;
  nota_encargado: string | null;
  fecha: string | null;
  costo_insumos: number;
  costo_mano_obra: number;
  costo_tinta: number;
  costo_total: number;
}

interface EnCursoResponse {
  por_aprobar: Reposicion[];
  en_curso: Reposicion[];
  totales: Record<string, number>;
}

interface HistorialResponse {
  total: number;
  devueltas: number;
  filtros: Record<string, unknown>;
  resumen: {
    cantidad: number;
    unidades: number;
    por_estado: Record<string, number>;
    por_departamento_solicitante: Record<string, number>;
    costo_por_departamento_solicitante: Record<string, number>;
    por_producto: Record<string, number>;
    costo_insumos: number;
    costo_mano_obra: number;
    costo_tinta: number;
    costo_total: number;
  };
  reposiciones: Reposicion[];
}

const money = (n: number) => `$${Number(n).toFixed(2)}`;
const una = (t: string | null) => (t || "").replace(/\s+/g, " ").trim();

export const GLOSARIO_REPOSICIONES = `Reposición = volver a producir parte de una orden porque algo salió mal (se dañó, faltó o salió con error). La pide un empleado desde su departamento con un motivo; un encargado la aprueba (asignándola a un empleado) o la rechaza.
Una reposición recorre varios departamentos, desde el asignado hasta el que la pidió (incluido). Cuando un empleado termina su parte, la reposición pasa al siguiente departamento SIN empleado hasta que un supervisor la asigna a alguien.
Estados: 'por_aprobar' (pedida, sin revisar), 'en_curso' (aprobada y asignada a un empleado, sin terminar), 'esperando_departamento' (aprobada y detenida en un departamento, sin empleado asignado todavía; para el taller sigue EN CURSO), 'terminada', 'rechazada' (con motivo del encargado), 'inconsistente' (asignada sin aprobar), 'eliminada'.
Costo de una reposición = insumos consumidos + mano de obra (comisiones pagadas por ella) + tinta; es el mismo cálculo del reporte de reposiciones.`;

function linea(r: Reposicion): string {
  const prod = [una(r.producto), [r.talla, r.tela].filter(Boolean).join("/")].filter(Boolean).join(" ");
  return (
    `#${r.id_reposicion} orden #${r.id_orden} | ${prod} x${r.unidades} | pedida por ${una(r.solicitada_por) || "-"} (${r.departamento_solicitante || "-"}) ${r.fecha || ""}` +
    (r.asignada_a ? ` | asignada a ${una(r.asignada_a)} (${r.departamento_asignado || "-"})` : "") +
    ` | costo ${money(r.costo_total)}` +
    (r.motivo ? ` | motivo: ${una(r.motivo).slice(0, 120)}` : "")
  );
}

export function registerReposicionTools(server: McpServer, ctx: RequestContext): void {
  const { idEmpresa: id_empresa } = ctx;

  server.registerTool(
    "ninesys_reposiciones_en_curso",
    {
      title: "Reposiciones pendientes y en curso",
      description: `Lo que el taller tiene pendiente de reposiciones AHORA, con el mismo criterio de la pantalla Control de producción: las por aprobar y las en curso (incluye las que esperan en un departamento a que se les asigne un empleado), con orden, producto, unidades, quién la pidió y desde qué departamento, motivo, a quién está asignada (o en qué departamento espera) y su costo hasta ahora.

Úsala cuando pregunten si hay reposiciones pendientes, por aprobar o en curso, qué se está reponiendo, cuáles esperan asignación o quién tiene reposiciones asignadas. Para historial, costos por período o por departamento usa ninesys_historial_reposiciones. NO modifica nada.

${GLOSARIO_REPOSICIONES}`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_reposiciones_en_curso", async () => {
      const d = await apiGet<EnCursoResponse>(`/internal/reposiciones/${id_empresa}/en-curso`, id_empresa);
      const t = d.totales;
      const lines = [
        `Reposiciones (empresa ${id_empresa}): por aprobar ${t.por_aprobar} | en curso ${t.en_curso} (${t.con_empleado_asignado} con empleado asignado, ${t.esperando_departamento} esperando asignación en un departamento)`,
        "",
        "== Por aprobar ==",
        ...(d.por_aprobar.length ? d.por_aprobar.map(linea) : ["(ninguna)"]),
        "",
        "== En curso ==",
        ...(d.en_curso.length
          ? d.en_curso.map((r) => linea(r) + (r.estado === "esperando_departamento" ? ` | ESPERANDO asignación en ${r.departamento_asignado || "un departamento"}` : ""))
          : ["(ninguna)"]),
      ];
      if (t.restos_de_ordenes_cerradas > 0) {
        lines.push("", `Además hay ${t.restos_de_ordenes_cerradas} reposiciones detenidas de órdenes ya entregadas o canceladas (restos antiguos; no se detallan).`);
      }
      return ok(lines.join("\n"), { ...d });
    })
  );

  server.registerTool(
    "ninesys_historial_reposiciones",
    {
      title: "Historial y costos de reposiciones",
      description: `Historial de reposiciones con su COSTO (insumos + mano de obra + tinta), con filtros combinables. Devuelve un resumen sobre TODAS las coincidencias (cantidad, unidades, por estado, por departamento que la pidió, por producto y costos) y el detalle de las más recientes.

Úsala para: cuánto costaron las reposiciones (en un mes, de un departamento, de una orden), qué departamento o producto genera más reposiciones, qué reposiciones tuvo una orden, cuántas se rechazaron. El número a responder es el del resumen, no la cantidad de líneas listadas. NO modifica nada.

Args (todos opcionales):
  - desde, hasta ('YYYY-MM-DD'): rango de fechas de la solicitud.
  - id_orden (number): solo las de esa orden.
  - departamento (string): departamento que la pidió (ej. 'Corte', 'Estampado').
  - estado ('terminada' | 'rechazada' | 'en_curso' | 'por_aprobar' | 'esperando_departamento' | 'inconsistente' | 'eliminada' | 'todas'): default todas menos eliminadas.
  - limit (1-50, default 20): cuántas listar en el detalle.

${GLOSARIO_REPOSICIONES}`,
      inputSchema: {
        desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fecha inicial YYYY-MM-DD."),
        hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fecha final YYYY-MM-DD."),
        id_orden: z.coerce.number().int().positive().optional().describe("Número de orden."),
        departamento: z.string().optional().describe("Departamento que la pidió."),
        estado: z
          .enum(["terminada", "rechazada", "en_curso", "por_aprobar", "esperando_departamento", "inconsistente", "eliminada", "todas"])
          .optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_historial_reposiciones", async (args) => {
      const a = args as { desde?: string; hasta?: string; id_orden?: number; departamento?: string; estado?: string; limit?: number };
      const d = await apiGet<HistorialResponse>(`/internal/reposiciones/${id_empresa}/historial`, id_empresa, {
        desde: a.desde || "",
        hasta: a.hasta || "",
        id_orden: a.id_orden || "",
        departamento: a.departamento || "",
        estado: a.estado || "",
        limit: a.limit || 20,
      });
      const r = d.resumen;
      const conteo = (o: Record<string, number>, max = 12) =>
        Object.entries(o)
          .slice(0, max)
          .map(([k, v]) => `${una(k)}: ${Number(v.toFixed ? v.toFixed(2) : v)}`)
          .join(" | ") || "-";
      const filtros = Object.entries(d.filtros)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      const lines = [
        `Reposiciones (empresa ${id_empresa}; ${filtros}): TOTAL ${d.total} | ${r.unidades} unidades`,
        `Costo total ${money(r.costo_total)} = insumos ${money(r.costo_insumos)} + mano de obra ${money(r.costo_mano_obra)} + tinta ${money(r.costo_tinta)}`,
        `Por estado: ${conteo(r.por_estado)}`,
        `Por departamento que la pidió (cantidad y costo): ${
          Object.entries(r.por_departamento_solicitante)
            .map(([k, v]) => `${una(k)}: ${v} (${money(r.costo_por_departamento_solicitante?.[k] ?? 0)})`)
            .join(" | ") || "-"
        }`,
        `Unidades por producto (principales): ${conteo(r.por_producto, 8)}`,
        "",
        d.total ? `Detalle de las ${d.reposiciones.length} más recientes${d.total > d.reposiciones.length ? ` (de ${d.total})` : ""}:` : "Sin reposiciones con esos filtros.",
        ...d.reposiciones.map((x) => `${linea(x)} | ${x.estado}`),
      ];
      return ok(lines.join("\n"), { ...d });
    })
  );
}
