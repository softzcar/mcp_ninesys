import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet } from "../services/apiClient.js";
import { cached } from "../services/cache.js";
import { CACHE_TTL } from "../constants.js";
import { phone, responseFormat } from "../schemas/inputs.js";
import { ok, guard } from "./helpers.js";
import type { RequestContext } from "./index.js";
import type { OrdersByPhoneResponse, OrderByIdResponse, Order } from "../types/api.js";

const money = (n: number) => `$${Number(n).toFixed(2)}`;
const fmtDate = (s: string | null) => {
  if (!s) return "-";
  const d = new Date(s);
  return isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" });
};
const STATUS: Record<string, string> = {
  pendiente: "Pendiente",
  en_produccion: "En producción",
  listo: "Listo para entrega",
  entregado: "Entregado",
  cancelada: "Cancelada",
};

function formatOrder(o: Order): string {
  const lines = [
    `Orden #${o.id_orden}`,
    `  Estado: ${STATUS[o.status] || o.status || "-"}`,
    `  Entrega estimada: ${fmtDate(o.fecha_entrega)}`,
    `  Total: ${money(o.pago_total)} | Abonos: ${money(o.total_abonos)}` +
      (o.total_descuentos > 0 ? ` | Descuentos: ${money(o.total_descuentos)}` : ""),
    `  Saldo pendiente: ${money(o.saldo_pendiente)}`,
  ];
  if (o.productos?.length) {
    for (const p of o.productos) {
      lines.push(`    - ${p.name} x ${p.cantidad}${p.detalle_tallas ? ` (${p.detalle_tallas})` : ""}`);
    }
  }
  return lines.join("\n");
}

export function registerOrderTools(server: McpServer, ctx: RequestContext): void {
  const { idEmpresa: id_empresa } = ctx;
  server.registerTool(
    "ninesys_get_orders_by_phone",
    {
      title: "Obtener órdenes de un cliente por teléfono",
      description: `Devuelve TODAS las órdenes de un cliente (identificado por teléfono) con su estado, fecha de entrega, total, abonos, descuentos, saldo pendiente y productos.

Úsala cuando el cliente pregunta por sus pedidos, su saldo, su deuda, sus abonos, el estado o la fecha de entrega, o qué compró antes. NO crea ni modifica nada. La empresa ya está fijada por la sesión.

Args:
  - phone (string): teléfono del cliente en solo dígitos (ej: "5804241234567").
  - response_format ('markdown' | 'json'): formato de salida (default: markdown).

Devuelve las órdenes separadas en "con saldo pendiente" y "ya pagadas / sin deuda", más el total adeudado. Si el cliente no tiene órdenes o el teléfono no está registrado, lo indica.

Nota para preguntas de deuda/saldo: usa SOLO las órdenes con saldo pendiente y el total adeudado; las pagadas son solo para consultar estado de un pedido puntual.`,
      inputSchema: {
        phone,
        response_format: responseFormat,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard("ninesys_get_orders_by_phone", async (args) => {
      const { phone: tel, response_format } = args as {
        phone: string;
        response_format: "markdown" | "json";
      };
      const data = await cached(
        `orders:${id_empresa}:${tel}`,
        CACHE_TTL.orders,
        () =>
          apiGet<OrdersByPhoneResponse>(`/internal/ordenes/${id_empresa}/by-phone`, id_empresa, {
            phone: tel,
          })
      );

      if (!data || !data.found || !data.ordenes?.length) {
        return ok(
          `No se encontraron órdenes para el teléfono ${tel} en la empresa ${id_empresa}.`,
          { found: false, ordenes: [] }
        );
      }

      const conDeuda = data.ordenes.filter((o) => Number(o.saldo_pendiente) > 0);
      const sinDeuda = data.ordenes.filter((o) => Number(o.saldo_pendiente) <= 0);
      const totalDeuda = conDeuda.reduce((s, o) => s + Number(o.saldo_pendiente), 0);

      const structured = {
        found: true,
        customer_id: data.customer_id,
        customer_name: data.customer_name,
        total_adeudado: Number(totalDeuda.toFixed(2)),
        con_saldo_pendiente: conDeuda,
        sin_deuda: sinDeuda,
      };

      if (response_format === "json") {
        return ok(JSON.stringify(structured, null, 2), structured);
      }

      const parts: string[] = [`Órdenes de ${data.customer_name || "cliente"} (empresa ${id_empresa}):`, ""];
      parts.push("== Con saldo pendiente ==");
      if (conDeuda.length) {
        parts.push(...conDeuda.map(formatOrder));
        if (conDeuda.length > 1) parts.push(`\nTotal adeudado: ${money(totalDeuda)}`);
      } else {
        parts.push("(Sin órdenes con saldo pendiente.)");
      }
      if (sinDeuda.length) {
        parts.push("", "== Ya pagadas / sin deuda ==", ...sinDeuda.map(formatOrder));
      }
      return ok(parts.join("\n"), structured);
    })
  );

  server.registerTool(
    "ninesys_get_order_by_id",
    {
      title: "Obtener una orden por su número (id)",
      description: `Devuelve UNA orden concreta por su número/id, con su estado, fecha de entrega, total, abonos, descuentos, saldo pendiente, productos y el nombre del cliente dueño.

Úsala cuando se pregunta por una orden específica por su número (ej: "estado de la orden 1234", "cuánto falta por pagar de la orden #58", "qué tiene la orden 320"). NO crea ni modifica nada. La empresa ya está fijada por la sesión.

Args:
  - id_orden (number): número/id de la orden.
  - response_format ('markdown' | 'json'): formato de salida (default: markdown).

Devuelve: { found, customer_name, orden: { id_orden, status, fecha_entrega, pago_total, total_abonos, total_descuentos, saldo_pendiente, productos } }. Si la orden no existe en esta empresa, found=false.`,
      inputSchema: {
        id_orden: z
          .number()
          .int()
          .positive()
          .describe("Número/id de la orden a consultar."),
        response_format: responseFormat,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard("ninesys_get_order_by_id", async (args) => {
      const { id_orden, response_format } = args as {
        id_orden: number;
        response_format: "markdown" | "json";
      };
      const data = await cached(
        `order:${id_empresa}:${id_orden}`,
        CACHE_TTL.orders,
        () => apiGet<OrderByIdResponse>(`/internal/ordenes/${id_empresa}/by-id`, id_empresa, { id: id_orden })
      );

      if (!data || !data.found || !data.orden) {
        return ok(`No se encontró la orden #${id_orden} en la empresa ${id_empresa}.`, { found: false });
      }

      const structured = {
        found: true,
        customer_name: data.customer_name,
        orden: data.orden as unknown as Record<string, unknown>,
      };
      if (response_format === "json") {
        return ok(JSON.stringify(structured, null, 2), structured);
      }
      const header = `Orden #${data.orden.id_orden}${data.customer_name ? ` — ${data.customer_name}` : ""} (empresa ${id_empresa}):`;
      return ok([header, "", formatOrder(data.orden)].join("\n"), structured);
    })
  );
}
