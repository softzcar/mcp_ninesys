import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet } from "../services/apiClient.js";
import { ok, guard } from "./helpers.js";
import type { RequestContext } from "./index.js";
import type {
  EmployeeListResponse,
  EmployeeSalesResponse,
} from "../types/api.js";

const money = (n: number) => `$${Number(n).toFixed(2)}`;

export function registerEmployeeTools(server: McpServer, ctx: RequestContext): void {
  const { idEmpresa } = ctx;

  // =========================================================================
  // TOOL 1: ninesys_get_employees
  // =========================================================================
  server.registerTool(
    "ninesys_get_employees",
    {
      title: "Listar y buscar empleados y personal",
      description: `Consulta el listado del personal y empleados de la empresa, incluyendo su nombre, estatus (activo/inactivo), departamento principal y departamentos adicionales asignados donde labora.

Permite filtrar por texto de búsqueda (nombre o correo), filtrar por departamento (ej: 'Administración', 'Comercialización', 'Corte', 'Costura', 'Diseño') y elegir si incluir o no inactivos.

Úsala ante preguntas como:
- "¿Quiénes trabajan en la empresa?"
- "¿Qué empleados están en el departamento de Comercialización o Diseño?"
- "¿Sayerlin está activa en el sistema y en qué departamentos trabaja?"
- "¿Cuál es el correo o teléfono de Sarahit?"
NO modifica nada.`,
      inputSchema: {
        buscar: z
          .string()
          .optional()
          .describe("Texto para buscar por nombre o correo (ej: 'Sayerlin', 'Mojica')."),
        departamento: z
          .string()
          .optional()
          .describe("Filtrar por departamento principal o asignado (ej: 'Comercialización', 'Administración', 'Corte')."),
        solo_activos: z
          .boolean()
          .default(true)
          .describe("Si es true (default), devuelve solo empleados activos en la empresa."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_get_employees", async (args) => {
      const params: Record<string, unknown> = {
        solo_activos: args.solo_activos !== false ? 1 : 0,
      };
      if (args.buscar) params.buscar = args.buscar;
      if (args.departamento) params.departamento = args.departamento;

      const data = await apiGet<EmployeeListResponse>(
        `/internal/empleados/${idEmpresa}/list`,
        idEmpresa,
        params
      );

      const lines = [
        `👥 EMPLEADOS (Empresa ${idEmpresa}) — Total encontrados: ${data.total}`,
        "",
      ];

      if (data.empleados.length === 0) {
        lines.push("(no se encontraron empleados con los criterios indicados)");
      } else {
        data.empleados.forEach((emp) => {
          const deps = emp.departamentos_asignados.length
            ? ` | Asignado a: ${emp.departamentos_asignados.join(", ")}`
            : "";
          const statusIcon = emp.status === "activo" ? "🟢 Activo" : "🔴 Inactivo";
          const tel = emp.telefono ? ` | Tel: ${emp.telefono}` : "";
          const email = emp.email ? ` | Email: ${emp.email}` : "";

          lines.push(
            `#${emp.id_usuario} ${emp.nombre} [${statusIcon}] - Depto: ${emp.departamento_principal}${deps}${tel}${email}`
          );
        });
      }

      return ok(lines.join("\n"), { ...data });
    })
  );

  // =========================================================================
  // TOOL 2: ninesys_get_employee_sales
  // =========================================================================
  server.registerTool(
    "ninesys_get_employee_sales",
    {
      title: "Ventas y órdenes por empleado / vendedor",
      description: `Consulta el volumen de ventas, cantidad de órdenes vendidas, montos facturados, cobrados y saldos pendientes de un empleado (vendedor/responsable) en cualquier período (mes actual, mes anterior, año actual, semana o rango de fechas).

Si no se especifica un empleado en particular, devuelve el ranking de desempeño de todos los vendedores de la empresa en el período consultado.

Úsala ante preguntas como:
- "¿Cuántas órdenes ha vendido Sayerlin este mes?"
- "¿Cuánto ha vendido Sarahit en lo que va de año?"
- "¿Quién es el vendedor que más órdenes ha cerrado este mes?"
- "¿Cuáles son las ventas por empleado de agosto?"
NO modifica nada.`,
      inputSchema: {
        empleado: z
          .string()
          .optional()
          .describe("Nombre o ID del empleado a consultar (ej: 'Sayerlin', 'Sarahit', o '10'). Si se omite, devuelve el ranking de todos los vendedores."),
        periodo: z
          .enum([
            "mes_actual",
            "mes_anterior",
            "ano_actual",
            "ano_anterior",
            "semana_actual",
            "semana_anterior",
            "custom",
          ])
          .default("mes_actual")
          .describe("Período a consultar. Default 'mes_actual'."),
        inicio: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Fecha inicial YYYY-MM-DD si periodo='custom'."),
        fin: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Fecha final YYYY-MM-DD si periodo='custom'."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_get_employee_sales", async (args) => {
      const params: Record<string, unknown> = {
        periodo: args.periodo || "mes_actual",
      };
      if (args.empleado) params.empleado = args.empleado;
      if (args.inicio) params.inicio = args.inicio;
      if (args.fin) params.fin = args.fin;

      const data = await apiGet<EmployeeSalesResponse>(
        `/internal/empleados/${idEmpresa}/ventas`,
        idEmpresa,
        params
      );

      const r = data.rango;

      // CASO 1: Consulta de un empleado específico
      if (data.empleado && data.metricas) {
        const emp = data.empleado;
        const m = data.metricas;
        const stLines = data.por_estado
          ? Object.entries(data.por_estado).map(([st, cnt]) => `    • ${st}: ${cnt} órdenes`).join("\n")
          : "    (sin órdenes)";

        const ultLines = (data.ultimas_ordenes || []).length
          ? (data.ultimas_ordenes || []).map((o) => `    • Orden #${o.id_orden} (${o.fecha}): ${money(o.monto)} - ${o.cliente} [${o.status}]`).join("\n")
          : "    (ninguna)";

        const lines = [
          `👤 VENTAS DEL EMPLEADO: ${emp.nombre} (#${emp.id_usuario}) - ${emp.departamento}`,
          `📅 Período: ${r.descripcion} (${r.inicio} al ${r.fin})`,
          "",
          `📊 RESULTADOS COMERCIALES:`,
          `  - Total de órdenes vendidas: ${m.total_ordenes}`,
          `  - Monto total facturado: ${money(m.total_ventas)}`,
          `  - Monto efectivamente cobrado: ${money(m.total_cobrado)} (${m.porcentaje_cobrado}% de recaudación)`,
          `  - Saldo pendiente por cobrar: ${money(m.saldo_por_cobrar)}`,
          `  - Descuentos concedidos: ${money(m.total_descuentos)}`,
          `  - Ticket promedio: ${money(m.ticket_promedio)} por orden`,
          "",
          `📦 Órdenes por estado:`,
          stLines,
          "",
          `🕒 Órdenes más recientes en el período:`,
          ultLines,
        ];

        return ok(lines.join("\n"), { ...data });
      }

      // CASO 2: Ranking global de vendedores
      const tot = data.totales || { total_ordenes: 0, total_ventas: 0, total_cobrado: 0 };
      const lines = [
        `🏆 RANKING DE VENTAS POR EMPLEADO (Empresa ${idEmpresa})`,
        `📅 Período: ${r.descripcion} (${r.inicio} al ${r.fin})`,
        `Totales globales: ${tot.total_ordenes} órdenes vendidas | ${money(tot.total_ventas)} facturados | ${money(tot.total_cobrado)} cobrados`,
        "",
      ];

      if (!data.ranking || data.ranking.length === 0) {
        lines.push("(no se registraron ventas en este período)");
      } else {
        data.ranking.forEach((v) => {
          lines.push(
            `  ${v.posicion}. ${v.nombre} (${v.departamento}): ${v.total_ordenes} órdenes vendidas | ${money(v.total_ventas)} (${v.porcentaje_ventas}%) | Cobrado: ${money(v.total_cobrado)} | Saldo: ${money(v.saldo_por_cobrar)} | Ticket prom: ${money(v.ticket_promedio)}`
          );
        });
      }

      return ok(lines.join("\n"), { ...data });
    })
  );
}
