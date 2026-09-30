import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet } from "../services/apiClient.js";
import { cached } from "../services/cache.js";
import { CACHE_TTL, GLOSARIO_ESTADOS_ORDEN } from "../constants.js";
import { phone } from "../schemas/inputs.js";
import { ok, guard } from "./helpers.js";
import type { RequestContext } from "./index.js";
import type {
  OrdersByPhoneResponse,
  OrderByIdResponse,
  OrdersByStatusResponse,
  OrdersEnCursoResponse,
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
  if (o.imagenes_observaciones?.length) {
    lines.push(`  Imágenes en observaciones: ${o.imagenes_observaciones.length} imagen(es) adjunta(s) (se muestran en el chat).`);
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

Devuelve primero un resumen de TODAS sus órdenes (cantidad, por estado, total adeudado), luego el detalle completo de las órdenes con saldo pendiente y las demás en una línea cada una (las 30 más recientes). Si el cliente no tiene órdenes o el teléfono no está registrado, lo indica.

Nota para preguntas de deuda/saldo: usa SOLO las órdenes con saldo pendiente y el total adeudado; las pagadas son solo para consultar estado de un pedido puntual.

${GLOSARIO_ESTADOS_ORDEN}`,
      inputSchema: {
        phone,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard("ninesys_get_orders_by_phone", async (args) => {
      const { phone: tel } = args as { phone: string };
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

      const porEstado: Record<string, number> = {};
      for (const o of data.ordenes) porEstado[o.status] = (porEstado[o.status] || 0) + 1;
      const MAX_SIN_DEUDA = 30;
      const recientes = [...sinDeuda].sort((x, y) => Number(y.id_orden) - Number(x.id_orden));
      const parts: string[] = [
        `Cliente: ${data.customer_name || "cliente"} (empresa ${id_empresa}) | ${data.ordenes.length} órdenes (sin contar canceladas) | ` +
          Object.entries(porEstado).map(([k, v]) => `${k}: ${v}`).join(", "),
        `Con saldo pendiente: ${conDeuda.length} | TOTAL ADEUDADO: ${money(totalDeuda)}`,
        "",
        "== Con saldo pendiente ==",
        ...(conDeuda.length ? conDeuda.map(formatOrderSimple) : ["(Sin órdenes con saldo pendiente.)"]),
      ];
      if (recientes.length) {
        parts.push(
          "",
          `== Sin deuda (${recientes.length}; ${recientes.length > MAX_SIN_DEUDA ? `se listan las ${MAX_SIN_DEUDA} más recientes` : "todas"}) ==`,
          ...recientes
            .slice(0, MAX_SIN_DEUDA)
            .map((o) => `#${o.id_orden} (${o.status}) | entrega ${o.fecha_entrega ?? "-"} | total ${money(o.pago_total)}`)
        );
      }
      return ok(parts.join("\n"), structured);
    })
  );

  server.registerTool(
    "ninesys_get_order_by_id",
    {
      title: "Obtener una orden por su número (id)",
      description: `Devuelve UNA orden concreta con detalle exhaustivo por su número/id (sin importar su estado: activa, en espera, terminada, entregada, pausada o cancelada):
- Observaciones y notas de la orden (limpias de etiquetas HTML).
- Datos del cliente: nombre, teléfono, cédula, email y dirección.
- Datos de la orden: estado ('activa', 'en espera', 'terminada', 'entregada', 'pausada', 'cancelada'), vendedor, fecha de emisión, fecha de entrega.
- Pagos y financiero: total, abonos, descuentos, notas de crédito, saldo pendiente, sobrepago, estado de pago ('pagado_total', 'abono_parcial', 'pendiente_pago', 'sobrepago') y desglose de métodos de pago (moneda, monto, tasa, referencia).
- Tipo de diseño asociado.
- Productos completos: nombre, cantidad, precio unitario, subtotal, talla, tela, corte y atributos.

Úsala SIEMPRE que se pregunte por una orden específica por su número/id (ej: "observaciones de la orden 6998", "qué observaciones tiene la orden 6998", "qué dice la orden 7226", "detalles de la orden 6998", "información de la orden 6998", "estado de la orden 7226", "cuánto debe la orden 7060", "qué tela lleva la orden 123", "cómo pagaron la orden 7226"). NO crea ni modifica nada. La empresa ya está fijada por la sesión.

Args:
  - id_orden (number): número/id de la orden.

${GLOSARIO_ESTADOS_ORDEN}`,
      inputSchema: {
        id_orden: z.coerce
          .number()
          .int()
          .positive()
          .describe("Número/id de la orden a consultar (ej: 6998)."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard("ninesys_get_order_by_id", async (args) => {
      const { id_orden } = args as { id_orden: number };
      const data = await cached(
        `order:${id_empresa}:${id_orden}`,
        CACHE_TTL.orders,
        () => apiGet<OrderByIdResponse>(`/internal/ordenes/${id_empresa}/by-id`, id_empresa, { id: id_orden })
      );

      if (!data || !data.found || !data.orden) {
        return ok(`No se encontró la orden #${id_orden} en la empresa ${id_empresa}.`, { found: false });
      }

      const images: Array<{ url: string; caption: string }> = (
        data.orden.imagenes_observaciones || []
      ).map((img) => ({
        url: img.url,
        caption: img.caption || `Orden #${id_orden} — observación`,
      }));

      const structured = {
        found: true,
        customer_id: data.customer_id,
        customer_name: data.customer_name,
        cliente: data.cliente,
        orden: data.orden,
        images,
      };
      return ok(formatOrderDetail(data.orden, data.cliente, data.customer_name), structured);
    })
  );

  server.registerTool(
    "ninesys_ordenes_en_curso",
    {
      title: "Órdenes en curso (Control de producción)",
      description: `Órdenes que están realmente en proceso de fabricación, con EXACTAMENTE el mismo criterio que la pantalla "Control de producción" del sistema: estado activa, pausada o En espera, con lote de producción y con al menos un producto físico. Devuelve SIEMPRE el TOTAL REAL y el resumen de TODAS las órdenes en curso (por estado, por paso/departamento actual, urgentes, atrasadas y por asignar, con los números de las urgentes y de las por asignar), y el detalle de las órdenes (todas o solo las del filtro).

Úsala SIEMPRE que pregunten cuántas órdenes hay en producción, en curso o en el taller, en qué paso/departamento están, cuáles están atrasadas, urgentes, pausadas, sin asignar o son de SOLO IMPRESIÓN.

"Solo impresión" = órdenes en producción cuyos productos son TODOS servicios de impresión (DTF, sublimación por metros, etc.; no requieren corte/costura/estampado): mismo criterio que el filtro SOLO IMPRESIÓN del taller. Para eso usa solo='solo_impresion' (NO busques por nombre de producto). Para listar un subconjunto USA LOS FILTROS (así el detalle llega completo). Responde solo con órdenes que aparezcan en la salida: nunca completes con números inventados. NO modifica nada. La empresa ya está fijada por la sesión.

"Entrega" es la fecha de entrega COMPROMETIDA en la orden; "atrasada" = esa fecha ya pasó. La pantalla del taller muestra además una fecha PROYECTADA (estimación) que no es esta.

Args (todos opcionales, se combinan):
  - solo ('urgentes' | 'atrasadas' | 'por_asignar' | 'solo_impresion'): limita el detalle a ese grupo.
  - paso (string): limita el detalle a un paso/departamento actual (ej. 'Limpieza', 'Estampado', 'Impresión', 'Por asignar', 'Terminado').
  - estado (string): limita el detalle a un estado ('activa', 'En espera', 'pausada').

${GLOSARIO_ESTADOS_ORDEN}`,
      inputSchema: {
        solo: z
          .enum(["urgentes", "atrasadas", "por_asignar", "solo_impresion"])
          .optional()
          .describe("Limita el detalle a: 'urgentes', 'atrasadas', 'por_asignar' o 'solo_impresion'."),
        paso: z.string().optional().describe("Paso/departamento actual (ej. 'Limpieza', 'Estampado')."),
        estado: z.string().optional().describe("Estado: 'activa', 'En espera' o 'pausada'."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard("ninesys_ordenes_en_curso", async (args) => {
      const { solo, paso, estado } = args as { solo?: "urgentes" | "atrasadas" | "por_asignar" | "solo_impresion"; paso?: string; estado?: string };
      const data = await cached(
        `orders_en_curso:${id_empresa}`,
        CACHE_TTL.orders,
        () => apiGet<OrdersEnCursoResponse>(`/internal/ordenes/${id_empresa}/en-curso`, id_empresa)
      );

      if (!data || !data.total) {
        return ok(`No hay órdenes en curso (en producción) en la empresa ${id_empresa}.`, {
          total: 0,
          resumen: data?.resumen ?? null,
          ordenes: [],
        });
      }

      const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
      let detalle = data.ordenes;
      if (solo === "urgentes") detalle = detalle.filter((o) => o.urgente);
      if (solo === "atrasadas") detalle = detalle.filter((o) => o.atrasada);
      if (solo === "por_asignar") detalle = detalle.filter((o) => o.paso === "Por asignar");
      if (solo === "solo_impresion") detalle = detalle.filter((o) => o.solo_impresion);
      if (paso) detalle = detalle.filter((o) => norm(o.paso) === norm(paso));
      if (estado) detalle = detalle.filter((o) => norm(o.status) === norm(estado));
      const filtros = [solo && `solo ${solo}`, paso && `paso ${paso}`, estado && `estado ${estado}`].filter(Boolean).join(", ");

      const r = data.resumen;
      const conteo = (obj: Record<string, number>) =>
        Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(" | ");
      const ids = (lista: typeof data.ordenes) => lista.map((o) => `#${o.id_orden}`).join(", ") || "ninguna";
      const lines = [
        `Órdenes en curso (Control de producción, empresa ${id_empresa}): TOTAL ${data.total}`,
        `Por estado: ${conteo(r.por_estado)}`,
        `Por paso actual: ${conteo(r.por_paso)}`,
        `Urgentes (${r.urgentes}): ${ids(data.ordenes.filter((o) => o.urgente))}`,
        `Por asignar (${r.por_asignar}): ${ids(data.ordenes.filter((o) => o.paso === "Por asignar"))}`,
        `Solo impresión (${r.solo_impresion ?? 0}): ${ids(data.ordenes.filter((o) => o.solo_impresion))}`,
        `Atrasadas (entrega comprometida vencida): ${r.atrasadas}`,
        "",
        filtros
          ? `Detalle filtrado (${filtros}): ${detalle.length} orden(es)`
          : `Detalle de las ${detalle.length} órdenes (orden de la fila de producción):`,
      ];
      for (const o of detalle) {
        const marcas = [o.urgente && "URGENTE", o.atrasada && "atrasada", o.solo_impresion && "solo impresión", o.status !== "activa" && o.status]
          .filter(Boolean)
          .join(", ");
        lines.push(
          `#${o.id_orden} ${o.cliente || "Cliente"} | ${o.paso} ${o.progreso}% | ${o.unidades} und | entrega ${o.fecha_entrega ?? "-"}` +
            (marcas ? ` | ${marcas}` : "")
        );
      }
      return ok(lines.join("\n"), { total: data.total, resumen: data.resumen, filtros: filtros || null, ordenes: detalle });
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

Úsala para ver órdenes recientes con un estado específico (terminadas, entregadas, canceladas, etc.) o sus datos de pago. 'TOTAL' es la cantidad REAL de órdenes con ese estado; la lista trae solo las 'limit' más recientes (default 20). Para "¿cuántas órdenes hay en producción / en curso / en el taller?" o el detalle del taller usa SIEMPRE ninesys_ordenes_en_curso. NO modifica nada. La empresa ya está fijada por la sesión.

Args:
  - status (string, opcional): estado a filtrar ('activa', 'en espera', 'terminada', 'entregada', 'pausada', 'cancelada', o 'todas'). Default: 'todas'.
  - limit (number, opcional): cantidad máxima de órdenes a retornar (1 a 50, default: 20).

${GLOSARIO_ESTADOS_ORDEN}`,
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
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard("ninesys_list_orders_by_status", async (args) => {
      const { status = "todas", limit = 20 } = args as { status?: string; limit?: number };
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
        devueltas: data.devueltas ?? data.ordenes.length,
        status_filter: data.status_filter,
        ordenes: data.ordenes,
      };

      const lines = [
        `Órdenes con estado '${data.status_filter}' (empresa ${id_empresa}): TOTAL ${data.total} (se listan las ${data.ordenes.length} más recientes)`,
        "",
      ];
      for (const o of data.ordenes) {
        const prodSummary = o.productos_resumen?.length
          ? o.productos_resumen.map((p) => `${p.name} x ${p.cantidad}${p.talla ? ` (${p.talla})` : ""}`).join(", ")
          : "Sin productos registrados";
        lines.push(
          `#${o.id_orden} ${o.cliente_nombre || "Cliente"} (${o.status}) | vend. ${o.vendedor || "-"} | entrega ${o.fecha_entrega ?? "-"} | ` +
            `total ${money(o.pago_total)} abonos ${money(o.total_abonos)} saldo ${money(o.saldo_pendiente)} [${o.estado_pago}] | ${prodSummary}`
        );
      }
      return ok(lines.join("\n"), structured);
    })
  );

  server.registerTool(
    "ninesys_search_orders_by_product",
    {
      title: "Buscar órdenes por producto, talla o tela",
      description: `Busca órdenes de trabajo según los productos que contienen y CALCULA EL TOTAL DE PRENDAS/UNIDADES y desgloses por talla y tela. Permite filtrar por cualquier combinación de:
- producto: nombre del producto (ej: 'franela', 'franelas sublimadas', 'dtf', 'jersey', 'gorra'). Normaliza automáticamente singulares y plurales.
- talla: talla del producto (ej: 'S', 'M', 'L', 'XL', '14', 'Unica').
- tela: nombre o tipo de tela (ej: 'ESCOSIA', 'LICRA SPRINT', 'DRY FIT', 'ALGODON').
- corte: tipo de corte (ej: 'Damas', 'Caballeros', 'Niños').
- NO la uses para "órdenes de solo impresión": eso lo responde ninesys_ordenes_en_curso con solo='solo_impresion'.
- status: estado de orden. Por defecto 'en_curso' = todo lo que sigue en la empresa (NO entregadas ni canceladas: en espera, activa, pausada y terminada); úsalo para "sin entregar", "pendientes de entrega" o "en la empresa". Para contar solo lo que está EN PRODUCCIÓN (sin las terminadas) usa 'en_produccion'; para "listas para entregar" usa 'terminada'. También permite 'todas' o un status puntual.

Úsala cuando el usuario pregunte:
1. Por órdenes que contengan un producto, talla o tela ("órdenes con franelas", "pedidos de DTF", "órdenes con tela ESCOSIA").
2. Por la CANTIDAD TOTAL DE PRENDAS O UNIDADES ("¿cuántas franelas tienen esas órdenes?", "¿cuántas franelas talla S hay en producción?", "¿cuántas prendas de tela escosia hay?"). Esta herramienta ya incluye el conteo exacto consolidado en 'Total de prendas/unidades coincidentes' y su desglose por talla y tela, úsalos directamente para responder. NO crea ni modifica nada. La empresa ya está fijada por la sesión.

Args:
  - producto (string, opcional): texto o nombre del producto a buscar.
  - talla (string, opcional): talla a filtrar (ej: 'S', 'M', 'L', 'XL', '14', 'Unica').
  - tela (string, opcional): nombre o tipo de tela (ej: 'ESCOSIA', 'LICRA SPRINT', 'DRY FIT', 'ALGODON').
  - corte (string, opcional): tipo de corte (ej: 'Damas', 'Caballeros', 'Niños').
  - status (string, opcional): por defecto 'en_curso'. Opciones: 'en_curso', 'en_produccion', 'activa', 'en espera', 'pausada', 'terminada', 'entregada', 'cancelada', 'todas'.
  - limit (number, opcional): cantidad máxima de órdenes a retornar (default: 20, max: 50).

${GLOSARIO_ESTADOS_ORDEN}`,
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
          .describe("Estado de orden. Por defecto 'en_curso' (en la empresa: no entregadas ni canceladas, incluye terminadas). 'en_produccion' = solo en espera/activa/pausada. Otras: 'activa', 'en espera', 'pausada', 'terminada', 'entregada', 'cancelada', 'todas'."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Cantidad máxima de órdenes a retornar (default: 20, max: 50)."),
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
      } = args as {
        producto?: string;
        talla?: string;
        tela?: string;
        corte?: string;
        status?: string;
        limit?: number;
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
        devueltas: data.devueltas ?? data.ordenes.length,
        resumen: data.resumen,
        filters: data.filters,
        ordenes: data.ordenes,
      };

      const filtrosTxt = [
        data.filters.producto ? `Producto: "${data.filters.producto}"` : null,
        data.filters.talla ? `Talla: "${data.filters.talla}"` : null,
        data.filters.tela ? `Tela: "${data.filters.tela}"` : null,
        data.filters.corte ? `Corte: "${data.filters.corte}"` : null,
        data.filters.status ? `Estado: ${data.filters.status}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      const totalUnidades = data.resumen?.total_unidades !== undefined ? data.resumen.total_unidades : "N/A";
      const lines = [
        `Órdenes encontradas: TOTAL ${data.total} | Prendas/unidades coincidentes (de TODAS): ${totalUnidades}` +
          (data.ordenes.length < data.total ? ` | se listan las ${data.ordenes.length} más recientes` : ""),
        `Filtros: ${filtrosTxt}`,
      ];

      if (data.resumen?.unidades_por_talla && Object.keys(data.resumen.unidades_por_talla).length > 0) {
        const desgloseTallas = Object.entries(data.resumen.unidades_por_talla)
          .map(([t, cant]) => `${t}: ${cant}`)
          .join(", ");
        lines.push(`Desglose por talla: ${desgloseTallas}`);
      }
      if (data.resumen?.unidades_por_tela && Object.keys(data.resumen.unidades_por_tela).length > 0) {
        const desgloseTelas = Object.entries(data.resumen.unidades_por_tela)
          .map(([tl, cant]) => `${tl}: ${cant}`)
          .join(", ");
        lines.push(`Desglose por tela: ${desgloseTelas}`);
      }
      lines.push("");

      for (const o of data.ordenes) {
        const MAX_PRODS = 3;
        const extra = o.productos_coincidentes.length - MAX_PRODS;
        const prods = o.productos_coincidentes
          .slice(0, MAX_PRODS)
          .map((p) => {
            const specs = [p.talla, p.tela, p.corte && p.corte !== "No aplica" ? p.corte : null].filter(Boolean).join("/");
            return `${p.name} x${p.cantidad}${specs ? ` (${specs})` : ""}`;
          })
          .join(", ");
        lines.push(
          `#${o.id_orden} ${o.cliente_nombre || "Cliente"} (${o.status}) | entrega ${o.fecha_entrega ?? "-"} | saldo ${money(o.saldo_pendiente)} | ${prods}` +
            (extra > 0 ? ` (+${extra} líneas más; el desglose completo está en el resumen)` : "")
        );
      }

      return ok(lines.join("\n"), structured);
    })
  );
}
