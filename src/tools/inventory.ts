import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet } from "../services/apiClient.js";
import { ok, guard } from "./helpers.js";
import type { RequestContext } from "./index.js";
import type { InventoryStockResponse } from "../types/api.js";

export function registerInventoryTools(server: McpServer, ctx: RequestContext): void {
  const { idEmpresa } = ctx;

  // =========================================================================
  // TOOL: ninesys_get_inventory_stock
  // =========================================================================
  server.registerTool(
    "ninesys_get_inventory_stock",
    {
      title: "Consultar inventario, existencias de telas y consumibles",
      description: `Consulta el stock y existencias del inventario de la empresa: telas (microfibra, atlética, muselina, etc.), consumibles (papel/rollos DTF, tintas), y materiales generales.

Permite:
- Buscar por nombre de insumo, SKU o color (ej: 'microfibra', 'DTF', 'blanco', 'negro').
- Filtrar por tipo ('tela', 'papel', 'tinta', 'general' o 'todos').
- Filtrar alertas de bajo stock o insumos agotados con 'solo_bajo_stock: true' y definir un 'umbral' numérico (por defecto 5 unidades/Kg/Mts).
- Filtrar por departamento asignado.

Úsala ante preguntas como:
- "¿Cuánto papel DTF y tela microfibra tenemos en stock?"
- "¿Qué telas blancas tenemos disponibles?"
- "¿Cuáles insumos o rollos están por agotarse o tienen bajo stock?"
- "¿Tenemos stock de tinta para sublimación o DTF?"
NO modifica datos.`,
      inputSchema: {
        tipo: z
          .enum(["todos", "tela", "papel", "tinta", "general"])
          .optional()
          .default("todos")
          .describe("Tipo de insumo a filtrar: 'tela', 'papel' (DTF), 'tinta', 'general' o 'todos'."),
        buscar: z
          .string()
          .optional()
          .describe("Texto para buscar en insumo, SKU o color (ej: 'microfibra', 'DTF', 'blanco')."),
        departamento: z
          .string()
          .optional()
          .describe("Filtrar por departamento (ej: 'Taller', 'Estampado', 'Corte', 'General')."),
        solo_bajo_stock: z
          .boolean()
          .optional()
          .default(false)
          .describe("Si es true, devuelve solo insumos con stock menor o igual al umbral (alertas y agotados)."),
        umbral: z
          .number()
          .optional()
          .default(5)
          .describe("Umbral de stock para considerar bajo stock (default 5.0)."),
        limit: z
          .number()
          .optional()
          .default(50)
          .describe("Cantidad máxima de ítems a retornar (1-100, default 50)."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_get_inventory_stock", async (args) => {
      const params: Record<string, unknown> = {
        tipo: args.tipo || "todos",
        solo_bajo_stock: args.solo_bajo_stock ? 1 : 0,
        umbral: args.umbral ?? 5,
        limit: args.limit ?? 50,
      };
      if (args.buscar) params.buscar = args.buscar;
      if (args.departamento) params.departamento = args.departamento;

      const data = await apiGet<InventoryStockResponse>(
        `/internal/inventario/${idEmpresa}/stock`,
        idEmpresa,
        params
      );

      const lines = [
        `📦 INVENTARIO Y CONSUMIBLES (Empresa ${idEmpresa})`,
        "",
      ];

      // Resumen general por tipo
      if (data.resumen_por_tipo && Object.keys(data.resumen_por_tipo).length > 0) {
        lines.push("📊 Resumen por categoría:");
        for (const [tipo, info] of Object.entries(data.resumen_por_tipo)) {
          lines.push(`  • ${tipo.toUpperCase()}: ${info.stock_total} en total (${info.total_items} registros/lotes)`);
        }
        lines.push("");
      }

      const filtroDesc = [
        args.tipo && args.tipo !== "todos" ? `tipo='${args.tipo}'` : null,
        args.buscar ? `búsqueda='${args.buscar}'` : null,
        args.departamento ? `depto='${args.departamento}'` : null,
        args.solo_bajo_stock ? `solo bajo stock (≤ ${args.umbral})` : null,
      ].filter(Boolean).join(", ");

      if (filtroDesc) {
        lines.push(`🔍 Filtros aplicados: ${filtroDesc}`);
        lines.push("");
      }

      if (data.items.length === 0) {
        lines.push("(no se encontraron insumos con los filtros solicitados)");
      } else {
        lines.push(`Total ítems mostrados: ${data.total_resultados}`);
        lines.push("--------------------------------------------------------------------------------");
        data.items.forEach((item) => {
          let alertBadge = "🟢";
          if (item.agotado) {
            alertBadge = "🔴 AGOTADO";
          } else if (item.alerta_bajo) {
            alertBadge = "⚠️ BAJO STOCK";
          }

          lines.push(
            `${alertBadge} [${item.sku}] ${item.insumo} (${item.tipo_insumo})`
          );
          lines.push(
            `    Stock Total: ${item.stock_total} ${item.unidad} | Lotes/Rollos: ${item.rollos_lotes} | Depto: ${item.departamento}`
          );
        });
      }

      return ok(lines.join("\n"), { ...data });
    })
  );
}
