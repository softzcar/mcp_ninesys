import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet } from "../services/apiClient.js";
import { cached } from "../services/cache.js";
import { CACHE_TTL } from "../constants.js";
import { phone, responseFormat } from "../schemas/inputs.js";
import { ok, guard } from "./helpers.js";
import type { RequestContext } from "./index.js";
import type {
  CustomerByPhoneResponse,
  CustomerSearchResponse,
  AccountStatementResponse,
} from "../types/api.js";

const money = (n: number) => `$${Number(n).toFixed(2)}`;
const fmtDate = (s: string | null) => {
  if (!s) return "-";
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" });
};
const fmtMonto = (monto: number, moneda: string) =>
  /d[oó]lar/i.test(moneda) ? money(monto) : `${Number(monto).toFixed(2)} ${moneda}`;

export function registerCustomerTools(server: McpServer, ctx: RequestContext): void {
  const { idEmpresa: id_empresa } = ctx;
  server.registerTool(
    "ninesys_get_customer_by_phone",
    {
      title: "Buscar cliente por teléfono",
      description: `Busca un cliente de la empresa por su número de teléfono y devuelve sus datos (nombre, apellido, cédula, email, dirección) y el id del último vendedor que lo atendió.

Úsala para saber si un cliente ya está registrado y recuperar sus datos antes de cotizar o atender. NO crea ni modifica nada. La empresa ya está fijada por la sesión.

Args:
  - phone (string): teléfono en solo dígitos (ej: "5804241234567").
  - response_format ('markdown' | 'json'): formato de salida (default: markdown).

Devuelve: { found, customer: { _id, first_name, last_name, cedula, phone, email, address }, last_vendedor_id }. Si no existe, found=false.`,
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
    guard("ninesys_get_customer_by_phone", async (args) => {
      const { phone: tel, response_format } = args as {
        phone: string;
        response_format: "markdown" | "json";
      };
      const data = await cached(
        `customer:${id_empresa}:${tel}`,
        CACHE_TTL.customer,
        () =>
          apiGet<CustomerByPhoneResponse>(`/internal/cliente/${id_empresa}/by-phone`, id_empresa, {
            phone: tel,
          })
      );

      if (!data || !data.found || !data.customer) {
        return ok(`No hay cliente registrado con el teléfono ${tel} en la empresa ${id_empresa}.`, {
          found: false,
        });
      }

      const c = data.customer;
      const structured = { found: true, customer: c, last_vendedor_id: data.last_vendedor_id ?? null };
      if (response_format === "json") {
        return ok(JSON.stringify(structured, null, 2), structured);
      }
      const text = [
        `Cliente encontrado (empresa ${id_empresa}):`,
        `  Nombre: ${c.first_name} ${c.last_name}`.trim(),
        `  Cédula: ${c.cedula || "-"}`,
        `  Teléfono: ${c.phone || "-"}`,
        `  Email: ${c.email || "-"}`,
        `  Dirección: ${c.address || "-"}`,
        `  Último vendedor (id): ${data.last_vendedor_id ?? "-"}`,
      ].join("\n");
      return ok(text, structured);
    })
  );

  server.registerTool(
    "ninesys_search_customers",
    {
      title: "Buscar clientes por nombre",
      description: `Busca clientes de la empresa por su NOMBRE COMPLETO (o parte), en cualquier orden. Funciona con "nombre apellido" juntos (ej. "maria arrieta"), nombres compuestos e ignora tildes. También busca por teléfono, cédula o email.

Úsala cuando se pregunta por un cliente por su nombre. Cada resultado trae el ID del cliente (_id), cuántas órdenes en curso tiene y su última orden. Con el ID puedes llamar a ninesys_get_account_statement (customer_id). NO crea ni modifica nada. La empresa ya está fijada por la sesión.

REGLA CUANDO HAY VARIAS COINCIDENCIAS: el usuario normalmente SOLO conoce el nombre del cliente. NUNCA le pidas teléfono, cédula ni email. Muéstrale la lista con el ID, el nombre completo, las órdenes en curso y la última orden de cada uno, y pídele que responda con el ID del cliente que le interesa. Cuando responda con un ID, úsalo directamente como customer_id.

Args:
  - query (string): nombre (o parte), teléfono, cédula o email a buscar.
  - response_format ('markdown' | 'json'): formato de salida (default: markdown).

Devuelve: { count, customers: [{ _id, first_name, last_name, phone, cedula, email, ordenes_en_curso, ultima_orden, fecha_ultima_orden }] }.`,
      inputSchema: {
        query: z
          .string()
          .trim()
          .min(2, "El texto de búsqueda debe tener al menos 2 caracteres.")
          .describe("Nombre (o parte), teléfono o cédula del cliente."),
        response_format: responseFormat,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard("ninesys_search_customers", async (args) => {
      const { query, response_format } = args as {
        query: string;
        response_format: "markdown" | "json";
      };
      const data = await cached(
        `custsearch:${id_empresa}:${query.toLowerCase().trim()}`,
        CACHE_TTL.customer,
        () => apiGet<CustomerSearchResponse>(`/internal/clientes/${id_empresa}/search`, id_empresa, { q: query })
      );

      const customers = data?.customers || [];
      if (!customers.length) {
        return ok(`No se encontraron clientes que coincidan con "${query}" en la empresa ${id_empresa}.`, {
          count: 0,
          customers: [],
        });
      }
      const structured = { count: customers.length, customers: customers as unknown as Record<string, unknown>[] };
      if (response_format === "json") {
        return ok(JSON.stringify(structured, null, 2), structured);
      }
      const lines = [
        `Clientes que coinciden con "${query}" (${customers.length}):`,
        "",
        ...customers.map((c) => {
          const nombre = `${c.first_name} ${c.last_name}`.replace(/\s+/g, " ").trim();
          const enCurso =
            c.ordenes_en_curso > 0
              ? `${c.ordenes_en_curso} orden${c.ordenes_en_curso === 1 ? "" : "es"} en curso`
              : "sin órdenes en curso";
          const ultima = c.ultima_orden
            ? `última orden #${c.ultima_orden}${c.fecha_ultima_orden ? ` (${fmtDate(c.fecha_ultima_orden)})` : ""}`
            : "sin órdenes";
          return `- ID ${c._id} — ${nombre} — ${enCurso} — ${ultima}`;
        }),
      ];
      if (customers.length > 1) {
        lines.push(
          "",
          "HAY VARIAS COINCIDENCIAS: muestra esta lista al usuario (ID, nombre, órdenes en curso y última orden) " +
            "y pídele que responda con el ID del cliente que le interesa. NO le pidas teléfono, cédula ni email."
        );
      }
      return ok(lines.join("\n"), structured);
    })
  );

  server.registerTool(
    "ninesys_get_account_statement",
    {
      title: "Estado de cuenta de un cliente",
      description: `Devuelve el ESTADO DE CUENTA de un cliente: resumen (facturado, abonado, descuentos, saldo total pendiente), las órdenes relevantes con su saldo, y el detalle de cada PAGO/ABONO (fecha, número de orden, método de pago, moneda, monto, tasa, equivalente en $, referencia y si está verificado por caja), más descuentos y notas de crédito.

Úsala para: "estado de cuenta de X", "qué abonos ha hecho", "cuándo pagó", "con qué método pagó", "a qué órdenes corresponden sus pagos", "pagos pendientes de verificar". NO crea ni modifica nada. La empresa ya está fijada por la sesión.

Órdenes incluidas: todas las que NO están entregadas ni canceladas (en cualquier estado), más las entregadas que aún tienen deuda. Las entregadas ya pagadas solo si se pide su historial (incluir_entregadas_pagadas=true). Las canceladas nunca.

Si solo tienes el NOMBRE del cliente, usa antes ninesys_search_customers para obtener su _id y pásalo como customer_id. Si la búsqueda devuelve varios clientes, NO pidas teléfono ni cédula: muestra la lista con ID y nombre y pide al usuario el ID. Si el usuario responde con un número de ID de cliente, pásalo como customer_id.

Args:
  - customer_id (number, opcional): _id del cliente (de ninesys_search_customers). Preferido.
  - phone (string, opcional): teléfono en dígitos. Se requiere customer_id o phone.
  - incluir_entregadas_pagadas (boolean, default false): incluir órdenes entregadas ya saldadas.
  - response_format ('markdown' | 'json').

Los montos y el saldo vienen calculados por el sistema: úsalos tal cual, no los recalcules ni sumes la lista de pagos. Los pagos marcados como "posible duplicado" no cuentan en el saldo: menciónalos como registros a revisar, no como pagos.`,
      inputSchema: {
        customer_id: z.number().int().positive().optional().describe("_id del cliente (preferido)."),
        phone: z
          .string()
          .trim()
          .regex(/^\d{7,15}$/, "El teléfono debe tener entre 7 y 15 dígitos.")
          .optional()
          .describe("Teléfono del cliente en solo dígitos (alternativa a customer_id)."),
        incluir_entregadas_pagadas: z
          .boolean()
          .default(false)
          .describe("Incluir también órdenes entregadas ya pagadas (solo si se pide el historial)."),
        response_format: responseFormat,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard("ninesys_get_account_statement", async (args) => {
      const { customer_id, phone: tel, incluir_entregadas_pagadas, response_format } = args as {
        customer_id?: number;
        phone?: string;
        incluir_entregadas_pagadas: boolean;
        response_format: "markdown" | "json";
      };
      if (!customer_id && !tel) {
        return ok(
          "Falta identificar al cliente: indica customer_id (obtenlo con ninesys_search_customers) o phone.",
          { found: false }
        );
      }

      const params: Record<string, unknown> = {};
      if (customer_id) params.customer_id = customer_id;
      else params.phone = tel;
      if (incluir_entregadas_pagadas) params.incluir_entregadas_pagadas = 1;

      const data = await apiGet<AccountStatementResponse>(
        `/internal/clientes/${id_empresa}/estado-cuenta`,
        id_empresa,
        params
      );

      if (!data || !data.found || !data.customer || !data.resumen) {
        return ok(`No se encontró el cliente en la empresa ${id_empresa}.`, { found: false });
      }

      const structured = data as unknown as Record<string, unknown>;
      if (response_format === "json") {
        return ok(JSON.stringify(data, null, 2), structured);
      }

      const r = data.resumen;
      const ordenes = data.ordenes || [];
      const pagos = data.pagos || [];
      const ajustes = data.ajustes || [];
      const out: string[] = [];

      out.push(`Estado de cuenta — ${data.customer.nombre} (tel ${data.customer.phone || "-"})`);
      out.push("");
      out.push("== Resumen ==");
      out.push(`  Órdenes listadas: ${r.ordenes_listadas}`);
      out.push(`  Total facturado: ${money(r.total_facturado)} | Abonado: ${money(r.total_abonado)}`);
      if (r.total_descuentos > 0) out.push(`  Descuentos: ${money(r.total_descuentos)}`);
      if (r.total_notas_credito > 0) out.push(`  Notas de crédito: ${money(r.total_notas_credito)}`);
      out.push(`  SALDO TOTAL PENDIENTE: ${money(r.saldo_total_pendiente)}`);
      if (r.entregadas_con_deuda > 0) out.push(`  ⚠ Órdenes entregadas con deuda: ${r.entregadas_con_deuda}`);
      if (r.pagos_sin_verificar > 0) out.push(`  ⚠ Pagos pendientes de verificar: ${r.pagos_sin_verificar}`);
      if (r.pagos_sin_abono > 0)
        out.push(
          `  ⚠ Registros de pago sin abono asociado (posible duplicado, NO suman al saldo): ${r.pagos_sin_abono}`
        );

      out.push("");
      out.push("== Órdenes ==");
      if (!ordenes.length) {
        out.push("  (Sin órdenes en curso ni entregadas con deuda.)");
      } else {
        for (const o of ordenes) {
          out.push(
            `  Orden #${o.id_orden} — ${o.status}${o.entregada_con_deuda ? " (ENTREGADA CON DEUDA)" : ""}` +
              ` | creada ${fmtDate(o.fecha_creacion)} | entrega ${fmtDate(o.fecha_entrega)}`
          );
          out.push(
            `    Total ${money(o.pago_total)} | Abonado ${money(o.total_abonos)}` +
              (o.total_descuentos > 0 ? ` | Desc. ${money(o.total_descuentos)}` : "") +
              ` | Saldo ${money(o.saldo_pendiente)}`
          );
        }
      }

      out.push("");
      out.push("== Pagos (más recientes primero) ==");
      if (!pagos.length) {
        out.push("  (Sin pagos registrados en estas órdenes.)");
      } else {
        for (const p of pagos) {
          const eq = /d[oó]lar/i.test(p.moneda) ? "" : ` (≈ ${money(p.monto_base)} a tasa ${p.tasa})`;
          out.push(
            `  ${fmtDate(p.fecha)} — Orden #${p.id_orden} — ${p.metodo_pago}: ${fmtMonto(p.monto, p.moneda)}${eq}` +
              (p.referencia ? ` — ref: ${p.referencia}` : "") +
              (p.sin_abono
                ? " — ⚠ POSIBLE DUPLICADO (sin abono asociado, no suma al saldo)"
                : p.verificado
                  ? ""
                  : " — ⚠ SIN VERIFICAR")
          );
        }
      }

      if (ajustes.length) {
        out.push("");
        out.push("== Descuentos / notas de crédito ==");
        for (const a of ajustes) {
          const parts = [];
          if (a.descuento > 0) parts.push(`descuento ${money(a.descuento)}`);
          if (a.nota_credito > 0) parts.push(`nota de crédito ${money(a.nota_credito)}`);
          out.push(`  ${fmtDate(a.fecha)} — Orden #${a.id_orden} — ${parts.join(", ")}${a.detalle ? ` (${a.detalle})` : ""}`);
        }
      }

      return ok(out.join("\n"), structured);
    })
  );
}
