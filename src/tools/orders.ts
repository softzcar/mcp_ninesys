import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet } from "../services/apiClient.js";
import { cached } from "../services/cache.js";
import { CACHE_TTL } from "../constants.js";
import { phone, responseFormat } from "../schemas/inputs.js";
import { ok, guard } from "./helpers.js";
import type { RequestContext } from "./index.js";
import type {
  OrdersByPhoneResponse,
  OrderByIdResponse,
  OrdersByStatusResponse,
  OrdersSearchByProductResponse,
  Order,
  OrderCustomerInfo,
} from "../types/api.js";

const money = (n: number) => `$${Number(n).toFixed(2)}`;
const fmtDate = (s: string | null) => {
  if (!s) return "-";
  const d = new Date(s);
  return isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" });
};
const STATUS: Record<string, string> = {
  activa: "Activa (en producción)",
  "en espera": "En espera",
  en_espera: "En espera",
  terminada: "Terminada / Lista",
  entregada: "Entregada",
  pausada: "Pausada",
  cancelada: "Cancelada",
  pendiente: "Pendiente",
  en_produccion: "En producción",
  listo: "Listo para entrega",
  entregado: "Entregado",
};

function formatOrderSimple(o: Order): string {
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

function formatOrderDetail(o: Order, cliente?: OrderCustomerInfo, custName?: string): string {
  const lines = [
    `Orden #${o.id_orden} — ${o.cliente_nombre || custName || cliente?.nombre || "Cliente"}`,
    `  Estado: ${STATUS[o.status] || o.status || "-"}`,
    `  Vendedor: ${o.vendedor || "Sin asignar"}`,
    `  Fecha emisión: ${fmtDate(o.fecha_inicio ?? null)}`,
    `  Fecha entrega: ${fmtDate(o.fecha_entrega)}`,
    `  Estado de pago: ${o.estado_pago || "-"}`,
    `  Total: ${money(o.pago_total)} | Abonos: ${money(o.total_abonos)}` +
      (o.total_descuentos > 0 ? ` | Descuentos: ${money(o.total_descuentos)}` : "") +
      (o.total_notas_credito && o.total_notas_credito > 0 ? ` | Notas de crédito: ${money(o.total_notas_credito)}` : ""),
  ];
  if (o.saldo_pendiente > 0) {
    lines.push(`  Saldo pendiente: ${money(o.saldo_pendiente)}`);
  }
  if (o.sobrepago && o.sobrepago > 0) {
    lines.push(`  Sobrepago (a favor del cliente): ${money(o.sobrepago)}`);
  }
  if (o.descuento_detalle) {
    lines.push(`  Detalle descuentos: ${o.descuento_detalle}`);
  }
  if (cliente && (cliente.telefono || cliente.cedula || cliente.email)) {
    lines.push(`  Cliente: Tel: ${cliente.telefono || "-"} | Cédula: ${cliente.cedula || "-"} | Email: ${cliente.email || "-"}`);
  }
  if (o.diseno_tipo && o.diseno_tipo !== "Ninguno") {
    lines.push(`  Diseño: ${o.diseno_tipo}`);
  }
  if (o.observaciones) {
    lines.push(`  Observaciones: ${o.observaciones}`);
  }
  if (o.metodos_pago?.length) {
    lines.push(`  Métodos de pago registrados:`);
    for (const mp of o.metodos_pago) {
      const detalle = mp.detalle ? ` (ref/det: ${mp.detalle})` : "";
      const tasa = mp.tasa ? ` @ tasa ${mp.tasa}` : "";
      lines.push(`    - ${mp.moneda} ${mp.metodo_pago}: ${mp.monto}${tasa}${detalle}`);
    }
  }
  if (o.productos?.length) {
    lines.push(`  Productos (${o.productos.length}):`);
    for (const p of o.productos) {
      const specs: string[] = [];
      if (p.talla) specs.push(`Talla: ${p.talla}`);
      if (p.tela) specs.push(`Tela: ${p.tela}`);
      if (p.corte && p.corte !== "No aplica") specs.push(`Corte: ${p.corte}`);
      if (p.atributo) specs.push(`Atributo: ${p.atributo}`);
      const specsStr = specs.length ? ` [${specs.join(", ")}]` : "";
      const priceStr = p.precio !== undefined ? ` @ ${money(p.precio)} = ${money(p.subtotal ?? p.cantidad * p.precio)}` : "";
      lines.push(`    - ${p.name} x ${p.cantidad}${specsStr}${priceStr}`);
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
        parts.push(...conDeuda.map(formatOrderSimple));
        if (conDeuda.length > 1) parts.push(`\nTotal adeudado: ${money(totalDeuda)}`);
      } else {
        parts.push("(Sin órdenes con saldo pendiente.)");
      }
      if (sinDeuda.length) {
        parts.push("", "== Ya pagadas / sin deuda ==", ...sinDeuda.map(formatOrderSimple));
      }
      return ok(parts.join("\n"), structured);
    })
  );

  server.registerTool(
    "ninesys_get_order_by_id",
    {
      title: "Obtener una orden por su número (id)",
      description: `Devuelve UNA orden concreta con detalle exhaustivo por su número/id:
- Datos del cliente: nombre, teléfono, cédula, email y dirección.
- Datos de la orden: estado ('activa', 'en espera', 'terminada', 'entregada', 'pausada', 'cancelada'), vendedor, fecha de emisión, fecha de entrega.
- Pagos y financiero: total, abonos, descuentos, notas de crédito, saldo pendiente, sobrepago, estado de pago ('pagado_total', 'abono_parcial', 'pendiente_pago', 'sobrepago') y desglose de métodos de pago (moneda, monto, tasa, referencia).
- Observaciones de la orden (limpias de etiquetas HTML).
- Tipo de diseño asociado.
- Productos completos: nombre, cantidad, precio unitario, subtotal, talla, tela, corte y atributos.

Úsala cuando se pregunte por una orden específica por su número (ej: "estado de la orden 7226", "cuánto debe la orden 7060", "qué tela lleva la orden 123", "qué observaciones tiene la orden 7226", "cómo pagaron la orden 7226"). NO crea ni modifica nada. La empresa ya está fijada por la sesión.

Args:
  - id_orden (number): número/id de la orden.
  - response_format ('markdown' | 'json'): formato de salida (default: markdown).`,
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
        customer_id: data.customer_id,
        customer_name: data.customer_name,
        cliente: data.cliente,
        orden: data.orden,
      };
      if (response_format === "json") {
        return ok(JSON.stringify(structured, null, 2), structured);
      }
      return ok(formatOrderDetail(data.orden, data.cliente, data.customer_name), structured);
    })
  );

  server.registerTool(
    "ninesys_list_orders_by_status",
    {
      title: "Listar órdenes por estado",
      description: `Consulta y lista órdenes según su estado actual en producción o entrega:
- 'activa': órdenes actualmente en producción/taller.
- 'en espera': órdenes en cola o esperando inicio/materiales.
- 'terminada': órdenes terminadas/listas para ser entregadas o retiradas.
- 'entregada': órdenes que ya fueron entregadas al cliente.
- 'pausada': órdenes en pausa.
- 'cancelada': órdenes anuladas o canceladas.
- 'todas': órdenes más recientes sin importar el estado.

Devuelve para cada orden: número de orden, nombre del cliente, vendedor, fechas de inicio y entrega, total facturado, abonos, saldo pendiente, sobrepago, estado de pago y resumen de productos.

Úsala cuando pregunten qué órdenes están en producción, cuáles están listas o terminadas, qué pedidos están pendientes de entrega, o qué órdenes recientes hay con un estado específico. NO modifica nada. La empresa ya está fijada por la sesión.

Args:
  - status (string, opcional): estado a filtrar ('activa', 'en espera', 'terminada', 'entregada', 'pausada', 'cancelada', o 'todas'). Default: 'todas'.
  - limit (number, opcional): cantidad máxima de órdenes a retornar (1 a 50, default: 20).
  - response_format ('markdown' | 'json'): formato de salida (default: markdown).`,
      inputSchema: {
        status: z
          .string()
          .optional()
          .describe("Estado a filtrar ('activa', 'en espera', 'terminada', 'entregada', 'pausada', 'cancelada', o 'todas'). Default: 'todas'."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Cantidad máxima de órdenes a retornar (default: 20, max: 50)."),
        response_format: responseFormat,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard("ninesys_list_orders_by_status", async (args) => {
      const { status = "todas", limit = 20, response_format } = args as {
        status?: string;
        limit?: number;
        response_format: "markdown" | "json";
      };
      const data = await cached(
        `orders_status:${id_empresa}:${status}:${limit}`,
        CACHE_TTL.orders,
        () =>
          apiGet<OrdersByStatusResponse>(`/internal/ordenes/${id_empresa}/by-status`, id_empresa, {
            status,
            limit,
          })
      );

      if (!data || !data.ordenes?.length) {
        return ok(`No se encontraron órdenes con estado '${status}' en la empresa ${id_empresa}.`, {
          total: 0,
          status_filter: status,
          ordenes: [],
        });
      }

      const structured = {
        total: data.total,
        status_filter: data.status_filter,
        ordenes: data.ordenes,
      };

      if (response_format === "json") {
        return ok(JSON.stringify(structured, null, 2), structured);
      }

      const lines = [
        `Órdenes con estado '${data.status_filter}' (empresa ${id_empresa}, total devueltas: ${data.total}):`,
        "",
      ];
      for (const o of data.ordenes) {
        const prodSummary = o.productos_resumen?.length
          ? o.productos_resumen.map((p) => `${p.name} x ${p.cantidad}${p.talla ? ` (${p.talla})` : ""}`).join(", ")
          : "Sin productos registrados";
        lines.push(
          `• Orden #${o.id_orden} — ${o.cliente_nombre || "Cliente"} (${STATUS[o.status] || o.status})`,
          `  Vendedor: ${o.vendedor || "-"} | Entrega: ${fmtDate(o.fecha_entrega)}`,
          `  Total: ${money(o.pago_total)} | Abonos: ${money(o.total_abonos)} | Saldo: ${money(o.saldo_pendiente)} [${o.estado_pago}]`,
          `  Productos: ${prodSummary}`,
          ""
        );
      }
      return ok(lines.join("\n"), structured);
    })
  );

  server.registerTool(
    "ninesys_search_orders_by_product",
    {
      title: "Buscar órdenes por producto, talla o tela",
      description: `Busca órdenes de trabajo según los productos que contienen, permitiendo filtrar por cualquier combinación de:
- producto: nombre del producto (ej: 'franela', 'franelas sublimadas', 'dtf', 'jersey', 'gorra'). Normaliza automáticamente singulares y plurales.
- talla: talla del producto (ej: 'S', 'M', 'L', 'XL', '14', 'Unica').
- tela: nombre o tipo de tela (ej: 'ESCOSIA', 'LICRA SPRINT', 'DRY FIT', 'ALGODON').
- corte: tipo de corte (ej: 'Damas', 'Caballeros', 'Niños').
- status: estado de orden. Por defecto 'en_curso' (busca órdenes NO entregadas ni canceladas: 'activa', 'en espera', 'terminada'). También permite 'todas' o un status puntual.

Úsala cuando el usuario pregunte por órdenes que contengan cierto producto ("órdenes con franelas", "pedidos de DTF"), con cierta talla ("franelas talla S", "pedidos en talla M"), con un tipo de tela específico ("órdenes con tela ESCOSIA", "pedidos en licra"), o combinaciones de estos ("franelas talla S con tela dry fit"). NO crea ni modifica nada. La empresa ya está fijada por la sesión.

Args:
  - producto (string, opcional): texto o nombre del producto a buscar.
  - talla (string, opcional): talla a filtrar (ej: 'S', 'M', 'L', 'XL', '14', 'Unica').
  - tela (string, opcional): nombre o tipo de tela (ej: 'ESCOSIA', 'LICRA SPRINT', 'DRY FIT', 'ALGODON').
  - corte (string, opcional): tipo de corte (ej: 'Damas', 'Caballeros', 'Niños').
  - status (string, opcional): por defecto 'en_curso'. Opciones: 'en_curso', 'activa', 'en espera', 'terminada', 'entregada', 'todas'.
  - limit (number, opcional): cantidad máxima de órdenes a retornar (default: 20, max: 50).
  - response_format ('markdown' | 'json'): formato de salida (default: markdown).`,
      inputSchema: {
        producto: z
          .string()
          .optional()
          .describe("Texto o nombre del producto a buscar (ej: 'franela', 'dtf', 'gorra')."),
        talla: z
          .string()
          .optional()
          .describe("Talla a filtrar (ej: 'S', 'M', 'L', 'XL', '14', 'Unica')."),
        tela: z
          .string()
          .optional()
          .describe("Nombre o tipo de tela (ej: 'ESCOSIA', 'LICRA SPRINT', 'DRY FIT', 'ALGODON')."),
        corte: z
          .string()
          .optional()
          .describe("Tipo de corte (ej: 'Damas', 'Caballeros', 'Niños')."),
        status: z
          .string()
          .optional()
          .describe("Estado de orden. Por defecto 'en_curso' (no entregadas ni canceladas). Opciones: 'en_curso', 'activa', 'en espera', 'terminada', 'entregada', 'todas'."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Cantidad máxima de órdenes a retornar (default: 20, max: 50)."),
        response_format: responseFormat,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard("ninesys_search_orders_by_product", async (args) => {
      const {
        producto,
        talla,
        tela,
        corte,
        status = "en_curso",
        limit = 20,
        response_format,
      } = args as {
        producto?: string;
        talla?: string;
        tela?: string;
        corte?: string;
        status?: string;
        limit?: number;
        response_format: "markdown" | "json";
      };

      const cacheKey = `orders_prod:${id_empresa}:${producto || ""}:${talla || ""}:${tela || ""}:${corte || ""}:${status}:${limit}`;
      const data = await cached(
        cacheKey,
        CACHE_TTL.orders,
        () =>
          apiGet<OrdersSearchByProductResponse>(`/internal/ordenes/${id_empresa}/search-by-product`, id_empresa, {
            producto: producto || "",
            talla: talla || "",
            tela: tela || "",
            corte: corte || "",
            status,
            limit,
          })
      );

      if (!data || !data.ordenes?.length) {
        const filtrosTxt = [
          producto ? `producto "${producto}"` : null,
          talla ? `talla "${talla}"` : null,
          tela ? `tela "${tela}"` : null,
          corte ? `corte "${corte}"` : null,
          status !== "todas" ? `estado "${status}"` : null,
        ]
          .filter(Boolean)
          .join(", ");
        return ok(`No se encontraron órdenes con ${filtrosTxt || "los criterios indicados"} en la empresa ${id_empresa}.`, {
          total: 0,
          filters: data?.filters || {},
          ordenes: [],
        });
      }

      const structured = {
        total: data.total,
        filters: data.filters,
        ordenes: data.ordenes,
      };

      if (response_format === "json") {
        return ok(JSON.stringify(structured, null, 2), structured);
      }

      const filtrosTxt = [
        data.filters.producto ? `Producto: "${data.filters.producto}"` : null,
        data.filters.talla ? `Talla: "${data.filters.talla}"` : null,
        data.filters.tela ? `Tela: "${data.filters.tela}"` : null,
        data.filters.corte ? `Corte: "${data.filters.corte}"` : null,
        data.filters.status ? `Estado: ${data.filters.status}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      const lines = [
        `Órdenes encontradas por producto (empresa ${id_empresa}, total: ${data.total}):`,
        `Filtros: ${filtrosTxt}`,
        "",
      ];

      for (const o of data.ordenes) {
        lines.push(
          `• Orden #${o.id_orden} — ${o.cliente_nombre || "Cliente"} (${STATUS[o.status] || o.status})`,
          `  Vendedor: ${o.vendedor || "-"} | Entrega: ${fmtDate(o.fecha_entrega)}`,
          `  Total: ${money(o.pago_total)} | Saldo: ${money(o.saldo_pendiente)} [${o.estado_pago}]`,
          `  Productos coincidentes:`
        );
        for (const p of o.productos_coincidentes) {
          const specs = [
            p.talla ? `Talla: ${p.talla}` : null,
            p.tela ? `Tela: ${p.tela}` : null,
            p.corte && p.corte !== "No aplica" ? `Corte: ${p.corte}` : null,
          ]
            .filter(Boolean)
            .join(", ");
          lines.push(`    - ${p.name} x ${p.cantidad}${specs ? ` [${specs}]` : ""} @ ${money(p.precio)}`);
        }
        lines.push("");
      }

      return ok(lines.join("\n"), structured);
    })
  );
}
