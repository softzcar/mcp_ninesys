import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet } from "../services/apiClient.js";
import { ok, guard } from "./helpers.js";
import type { RequestContext } from "./index.js";
import type { EmployeePayrollResponse } from "../types/api.js";

const money = (n: number) => `$${Number(n).toFixed(2)}`;

export function registerPayrollTools(server: McpServer, ctx: RequestContext): void {
  const { idEmpresa } = ctx;

  // =========================================================================
  // TOOL: ninesys_get_employee_commissions
  // =========================================================================
  server.registerTool(
    "ninesys_get_employee_commissions",
    {
      title: "Consultar nómina y comisiones por empleado o taller",
      description: `Consulta las comisiones, pagos por tareas o destajo acumulados por los empleados de taller y comercialización.

Permite:
- Consultar un empleado específico (por nombre, apellido, correo o ID) para ver su desglose por conceptos (Costura, Diseño, Montar Tallas, Estampado, Comercialización) y el detalle de sus tareas/órdenes.
- Consultar el resumen global de nómina y comisiones de toda la empresa (ranking de pagos acumulados por trabajador).
- Filtrar por estado: 'pendientes' (comisiones generadas por pagar/liquidar, fecha_pago IS NULL), 'pagadas' (historial liquidado) o 'todas'.
- Filtrar por rango de fechas (desde / hasta).

Úsala ante preguntas como:
- "¿Cuánto se le debe en comisiones a Andreina?"
- "¿Cuánto dinero en comisiones pendientes hay por pagar en taller?"
- "¿Qué pagos o comisiones ha recibido Maria Norvis este mes?"
- "¿Cuál es el desglose de lo ganado por Sayerlin en diseño o ventas?"
NO modifica datos.`,
      inputSchema: {
        empleado: z
          .string()
          .optional()
          .describe("Nombre, correo o ID del empleado. Si se omite, devuelve el consolidado general de toda la nómina."),
        estado: z
          .enum(["pendientes", "pagadas", "todas"])
          .optional()
          .default("pendientes")
          .describe("Filtrar por estado: 'pendientes' (por liquidar, default), 'pagadas' (liquidadas) o 'todas'."),
        desde: z
          .string()
          .optional()
          .describe("Fecha inicial en formato YYYY-MM-DD."),
        hasta: z
          .string()
          .optional()
          .describe("Fecha final en formato YYYY-MM-DD."),
        limit: z
          .number()
          .optional()
          .default(20)
          .describe("Cantidad máxima de tareas a listar en detalle individual (default 20)."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_get_employee_commissions", async (args) => {
      const params: Record<string, unknown> = {
        estado: args.estado || "pendientes",
        limit: args.limit ?? 20,
      };
      if (args.empleado) params.empleado = args.empleado;
      if (args.desde) params.desde = args.desde;
      if (args.hasta) params.hasta = args.hasta;

      const data = await apiGet<EmployeePayrollResponse>(
        `/internal/nomina/${idEmpresa}/comisiones`,
        idEmpresa,
        params
      );

      const lines = [
        `💵 NÓMINA Y COMISIONES (Empresa ${idEmpresa})`,
        `Estado consultado: ${data.estado_filtro.toUpperCase()}`,
        "",
      ];

      // CASO A: Empleado específico
      if (data.empleado) {
        lines.push(`👤 Empleado: #${data.empleado.id_usuario} ${data.empleado.nombre} (${data.empleado.departamento})`);
        lines.push(`💰 Monto Total: ${money(data.monto_total || 0)} | Tareas/Registros: ${data.total_tareas || 0}`);
        lines.push("");

        if (data.desglose_por_concepto && data.desglose_por_concepto.length > 0) {
          lines.push("📌 Desglose por concepto / departamento:");
          data.desglose_por_concepto.forEach((d) => {
            lines.push(`  • ${d.concepto}: ${money(d.monto)} (${d.cantidad} tareas)`);
          });
          lines.push("");
        }

        if (data.tareas && data.tareas.length > 0) {
          lines.push("📋 Tareas recientes:");
          data.tareas.forEach((t) => {
            const ordenStr = t.id_orden ? `Orden #${t.id_orden}` : "Sin orden";
            const fechaStr = t.fecha_pago ? `Pagado: ${t.fecha_pago}` : `Generado: ${t.fecha_tarea}`;
            lines.push(`  - Pago #${t.id_pago} | ${ordenStr} | ${t.concepto}: ${money(t.monto_pago)} [${fechaStr}] (${t.estatus})`);
          });
        } else {
          lines.push("(no hay detalle de tareas registradas)");
        }

        return ok(lines.join("\n"), { ...data });
      }

      // CASO B: Resumen de toda la nómina de la empresa
      lines.push(`💰 Gran Total de Comisiones: ${money(data.gran_total_monto || 0)}`);
      lines.push(`Total de tareas registradas: ${data.gran_total_tareas || 0}`);
      lines.push("");

      if (!data.personal || data.personal.length === 0) {
        lines.push("(no se encontraron registros de comisiones con los criterios solicitados)");
      } else {
        lines.push("👥 Personal y montos acumulados:");
        lines.push("--------------------------------------------------------------------------------");
        data.personal.forEach((p, idx) => {
          lines.push(
            `${idx + 1}. #${p.id_empleado} ${p.nombre} (${p.departamento}): ${money(p.monto_total)} (${p.total_tareas} tareas)`
          );
        });
      }

      return ok(lines.join("\n"), { ...data });
    })
  );
}
