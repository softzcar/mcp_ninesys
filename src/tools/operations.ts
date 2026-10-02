import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet } from "../services/apiClient.js";
import { ok, guard } from "./helpers.js";
import type { RequestContext } from "./index.js";
import type {
  DelayedOrdersResponse,
  DesignerWorkloadResponse,
} from "../types/api.js";

const money = (n: number) => `$${Number(n).toFixed(2)}`;

export function registerOperationTools(server: McpServer, ctx: RequestContext): void {
  const { idEmpresa } = ctx;

  // =========================================================================
  // TOOL 1: ninesys_get_delayed_orders
  // =========================================================================
  server.registerTool(
    "ninesys_get_delayed_orders",
    {
      title: "Consultar órdenes de producción retrasadas (semáforo rojo)",
      description: `Consulta las órdenes activas cuya fecha comprometida de entrega ya venció en relación a hoy (semáforo de entregas en rojo).

Permite:
- Ver el total de órdenes vencidas y el conteo por estación/departamento donde están frenadas (ej: Corte, Costura, Diseño, Estampado, Limpieza).
- Obtener el listado priorizado por mayor número de días de retraso.
- Consultar cliente, saldo pendiente, fecha de entrega original, departamento actual y resumen de productos incluidos.
- Filtrar opcionalmente por departamento específico.

Úsala ante preguntas como:
- "¿Cuáles son las órdenes que están retrasadas?"
- "¿Cuántas órdenes tienen la fecha de entrega vencida y en qué departamentos están frenadas?"
- "¿Qué órdenes en Costura o Estampado tienen más días de retraso?"
NO modifica datos.`,
      inputSchema: {
        departamento: z
          .string()
          .optional()
          .describe("Filtrar por estación o departamento actual donde está el lote (ej: 'Costura', 'Corte', 'Diseño', 'Estampado')."),
        limit: z
          .number()
          .optional()
          .default(20)
          .describe("Cantidad máxima de órdenes retrasadas a retornar (1-100, default 20)."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_get_delayed_orders", async (args) => {
      const params: Record<string, unknown> = {
        limit: args.limit ?? 20,
      };
      if (args.departamento) params.departamento = args.departamento;

      const data = await apiGet<DelayedOrdersResponse>(
        `/internal/taller/${idEmpresa}/ordenes-retrasadas`,
        idEmpresa,
        params
      );

      const lines = [
        `🚨 CONTROL DE ENTREGAS: ÓRDENES RETRASADAS (Empresa ${idEmpresa})`,
        `Total de órdenes vencidas: ${data.total_retrasadas}`,
        "",
      ];

      if (data.resumen_por_departamento && Object.keys(data.resumen_por_departamento).length > 0) {
        lines.push("📍 Cuello de botella por departamento actual:");
        for (const [depto, cant] of Object.entries(data.resumen_por_departamento)) {
          lines.push(`  • ${depto}: ${cant} orden(es) retrasada(s)`);
        }
        lines.push("");
      }

      if (data.ordenes.length === 0) {
        lines.push("🎉 ¡Excelente! No hay órdenes activas retrasadas con los criterios seleccionados.");
      } else {
        lines.push(`Mostrando las ${data.total_mostradas} órdenes con mayor retraso:`);
        lines.push("--------------------------------------------------------------------------------");
        data.ordenes.forEach((o) => {
          lines.push(
            `🔴 Orden #${o.id_orden} | Cliente: ${o.cliente} | ⏳ Retraso: ${o.dias_retraso} días (Debió entregarse: ${o.fecha_entrega})`
          );
          lines.push(
            `    Frenada en: [${o.departamento_actual}] | Total: ${money(o.pago_total)} (Saldo pend.: ${money(o.saldo_pendiente)})`
          );
          lines.push(`    Productos: ${o.productos}`);
        });
      }

      return ok(lines.join("\n"), { ...data });
    })
  );

  // =========================================================================
  // TOOL 2: ninesys_get_designers_workload
  // =========================================================================
  server.registerTool(
    "ninesys_get_designers_workload",
    {
      title: "Consultar carga de trabajo de diseñadores y propuestas en espera",
      description: `Consulta el volumen y estado del departamento de diseño:
- Cuántos diseños activos tiene en cola cada diseñador.
- Diseños terminados por diseñador.
- Propuestas de bocetos/diseños enviadas que están 'Esperando Respuesta' del cliente.
- Detalle de los bocetos en espera con cliente y enlace de imagen previa.

Úsala ante preguntas como:
- "¿Cómo está la carga de trabajo de los diseñadores?"
- "¿Quién es el diseñador con más trabajo pendiente o asignado?"
- "¿Cuántas propuestas de diseño están esperando aprobación del cliente?"
- "¿Qué bocetos o artes están pendientes por confirmación del cliente?"
NO modifica datos.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_get_designers_workload", async () => {
      const data = await apiGet<DesignerWorkloadResponse>(
        `/internal/taller/${idEmpresa}/disenadores-carga`,
        idEmpresa
      );

      const lines = [
        `🎨 CARGA DE TRABAJO EN DISEÑO (Empresa ${idEmpresa})`,
        `Total diseños activos en cola: ${data.total_disenos_activos}`,
        `Total propuestas esperando respuesta de cliente: ${data.total_esperando_cliente}`,
        "",
      ];

      lines.push("👥 Diseñadores y asignaciones:");
      lines.push("--------------------------------------------------------------------------------");
      if (data.disenadores.length === 0) {
        lines.push("(no hay diseñadores registrados con asignaciones)");
      } else {
        data.disenadores.forEach((d) => {
          lines.push(
            `• ${d.disenador}: ${d.disenos_activos} activos en cola | ${d.disenos_terminados} terminados | ${d.propuestas_esperando_cliente} esperando cliente`
          );
        });
      }
      lines.push("");

      if (data.propuestas_en_espera && data.propuestas_en_espera.length > 0) {
        lines.push(`⏳ Bocetos/Propuestas recientes esperando aprobación (${data.propuestas_en_espera.length}):`);
        data.propuestas_en_espera.forEach((p) => {
          lines.push(
            `  - Propuesta #${p.id_revision} (Orden #${p.id_orden}) - Cliente: ${p.cliente} | Diseñador: ${p.disenador} | Enviado: ${p.fecha_propuesta}`
          );
        });
      }

      return ok(lines.join("\n"), { ...data });
    })
  );
}
