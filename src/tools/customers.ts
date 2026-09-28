import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet } from "../services/apiClient.js";
import { cached } from "../services/cache.js";
import { CACHE_TTL } from "../constants.js";
import { phone, responseFormat } from "../schemas/inputs.js";
import { ok, guard } from "./helpers.js";
import type { RequestContext } from "./index.js";
import type { CustomerByPhoneResponse, CustomerSearchResponse } from "../types/api.js";

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
      description: `Busca clientes de la empresa por su NOMBRE COMPLETO (o parte), en cualquier orden. Funciona con "nombre apellido" juntos (ej. "maria arrieta"), nombres compuestos e ignora tildes. También busca por teléfono o cédula.

Úsala cuando se pregunta por un cliente por su nombre (no por teléfono). Devuelve una lista de coincidencias con sus datos, incluido el teléfono — que luego puedes usar con ninesys_get_orders_by_phone para ver sus órdenes. NO crea ni modifica nada. La empresa ya está fijada por la sesión.

Args:
  - query (string): nombre (o parte), teléfono o cédula a buscar.
  - response_format ('markdown' | 'json'): formato de salida (default: markdown).

Devuelve: { count, customers: [{ _id, first_name, last_name, phone, cedula, email }] }. Si hay varias coincidencias, pide al usuario que precise.`,
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
          const nombre = `${c.first_name} ${c.last_name}`.trim();
          return `- ${nombre} — tel: ${c.phone || "-"}${c.cedula ? ` — CI: ${c.cedula}` : ""}`;
        }),
      ];
      return ok(lines.join("\n"), structured);
    })
  );
}
