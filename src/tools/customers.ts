import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet } from "../services/apiClient.js";
import { cached } from "../services/cache.js";
import { CACHE_TTL } from "../constants.js";
import { phone, responseFormat } from "../schemas/inputs.js";
import { ok, guard } from "./helpers.js";
import type { RequestContext } from "./index.js";
import type { CustomerByPhoneResponse } from "../types/api.js";

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
}
