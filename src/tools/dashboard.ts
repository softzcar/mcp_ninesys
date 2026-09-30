import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet } from "../services/apiClient.js";
import { ok, guard } from "./helpers.js";
import type { RequestContext } from "./index.js";
import type {
  DashboardSummaryResponse,
  SalesComparisonResponse,
  TopProductsResponse,
} from "../types/api.js";

const money = (n: number) => `$${Number(n).toFixed(2)}`;
const pct = (n: number | null) => (n !== null ? `${n >= 0 ? "+" : ""}${Number(n).toFixed(1)}%` : "N/A");

export function registerDashboardTools(server: McpServer, ctx: RequestContext): void {
  const { idEmpresa } = ctx;

  // =========================================================================
  // TOOL 1: ninesys_get_dashboard_summary
  // =========================================================================
  server.registerTool(
    "ninesys_get_dashboard_summary",
    {
      title: "Resumen global del Dashboard de Administración",
      description: `Consulta el estado general del taller y la empresa en tiempo real, coincidiendo exactamente con la pantalla de inicio del módulo de Administración (/administracion).

Devuelve:
1. Tasas de cambio del día (monedas configuradas, tasa manual/base y fecha de actualización).
2. Semáforo de entregas (órdenes retrasadas, para hoy, a tiempo, por iniciar y pausadas).
3. Distribución de órdenes por estado (activas, en espera, pausadas, terminadas).
4. Carga de trabajo actual por departamento (cuello de botella de producción).
5. Métricas financieras del mes actual (total facturado, cobrado en caja, saldo por cobrar y % recaudado).
6. Estado acumulado de diseños (asignados a diseñador, propuestas enviadas, aprobados/pagados).
7. Tendencia semanal de órdenes creadas (últimos 7 días con movimiento).

Úsala ante preguntas como: "¿Cómo está el taller?", "¿Cómo van las entregas?", "¿Cuántas órdenes están retrasadas?", "¿A cuánto está el dólar o la tasa?", "¿Qué departamento tiene más trabajo acumulado?", "¿Cómo va el mes de ventas?". NO modifica nada.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_get_dashboard_summary", async () => {
      const data = await apiGet<DashboardSummaryResponse>(
        `/internal/dashboard/${idEmpresa}/summary`,
        idEmpresa
      );

      const sem = data.tiempos_entrega;
      const est = data.estado_ordenes;
      const v = data.ventas_mes_actual;
      const dis = data.estado_disenos;

      // Tasas legibles
      const tasasStr = Object.entries(data.tasas)
        .map(([cod, info]) => {
          if (info.es_base) return `${cod}: Base ($1.00)`;
          return `${cod}: ${info.tasa_manual !== null ? info.tasa_manual : "N/A"}`;
        })
        .join(" | ");

      // Departamentos ordenados
      const deptosStr = data.ordenes_por_departamento.length
        ? data.ordenes_por_departamento.map((d) => `  - ${d.departamento}: ${d.cantidad} órdenes`).join("\n")
        : "  (sin órdenes en departamentos)";

      // Resumen semanal
      const semanalStr = data.resumen_semanal.length
        ? data.resumen_semanal.map((d) => `  - ${d.dia} (${d.fecha}): ${d.total_ordenes} órdenes`).join("\n")
        : "  (sin órdenes recientes)";

      const lines = [
        `📊 RESUMEN DASHBOARD DE ADMINISTRACIÓN (Empresa ${idEmpresa})`,
        `💵 Tasas de cambio: ${tasasStr}`,
        "",
        `🚦 SEMÁFORO DE ENTREGAS (Total cola: ${sem.total_cola} órdenes):`,
        `  - Retrasadas: ${sem.retrasado} ⚠️`,
        `  - Para hoy (en el día): ${sem.en_el_dia}`,
        `  - A tiempo: ${sem.a_tiempo}`,
        `  - Por iniciar (en espera): ${sem.por_iniciar}`,
        `  - Pausadas: ${sem.pausadas}`,
        "",
        `📦 ESTADO GLOBAL DE ÓRDENES (${est.total} en flujo):`,
        `  - Activas en producción: ${est.activas}`,
        `  - Terminadas: ${est.terminadas}`,
        `  - En espera: ${est.en_espera}`,
        `  - Pausadas: ${est.pausadas}`,
        "",
        `🏭 CARGA POR DEPARTAMENTO (Cuello de botella):`,
        deptosStr,
        "",
        `💰 VENTAS Y COBROS DEL MES ACTUAL:`,
        `  - Ventas facturadas: ${money(v.ventas)} (${v.total_ordenes} órdenes)`,
        `  - Cobrado / Abonos: ${money(v.cobrado)} (${v.porcentaje_cobrado}%)`,
        `  - Saldo pendiente por cobrar: ${money(v.saldo_por_cobrar)}`,
        "",
        `🎨 ESTADO DE DISEÑOS:`,
        `  - Asignados a diseñador: ${dis.asignados}`,
        `  - Propuestas enviadas al cliente: ${dis.propuestas_enviadas}`,
        `  - Aprobados y pagados: ${dis.aprobados_pagados}`,
        "",
        `📈 MOVIMIENTO DE ÓRDENES ÚLTIMOS DÍAS:`,
        semanalStr,
      ];

      return ok(lines.join("\n"), { ...data });
    })
  );

  // =========================================================================
  // TOOL 2: ninesys_get_sales_analytics
  // =========================================================================
  server.registerTool(
    "ninesys_get_sales_analytics",
    {
      title: "Analítica y comparativa de ventas y cobros",
      description: `Consulta el volumen de ventas, cobros recaudados, saldos pendientes y ticket promedio de cualquier período (mes actual, mes anterior, año actual, semana, etc.), con opción de comparar automáticamente contra otro período (mes anterior, año anterior o rango personalizado).

Calcula la variación absoluta en dólares y la variación porcentual (%) entre ambos períodos.

Úsala ante preguntas como:
- "¿Cuánto se vendió este mes y compáralo con el mes pasado?"
- "¿Cómo estuvieron las ventas en agosto?"
- "¿Cuánto falta por cobrar de este año?"
- "¿Las ventas aumentaron o bajaron respecto al año pasado?"
NO modifica nada.`,
      inputSchema: {
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
          .describe("Período a consultar. Por defecto 'mes_actual'."),
        inicio: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Fecha inicial YYYY-MM-DD cuando periodo es 'custom'."),
        fin: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Fecha final YYYY-MM-DD cuando periodo es 'custom'."),
        comparar_con: z
          .enum(["mes_anterior", "ano_anterior", "periodo_previo", "custom", "ninguno"])
          .optional()
          .describe("Período de comparación. Opcional (si se omite y el período es mensual, compara con el mes previo)."),
        comp_inicio: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Fecha inicial de comparación YYYY-MM-DD si comparar_con='custom'."),
        comp_fin: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Fecha final de comparación YYYY-MM-DD si comparar_con='custom'."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_get_sales_analytics", async (args) => {
      const params: Record<string, unknown> = {
        periodo: args.periodo || "mes_actual",
      };
      if (args.inicio) params.inicio = args.inicio;
      if (args.fin) params.fin = args.fin;
      if (args.comparar_con) params.comparar_con = args.comparar_con;
      if (args.comp_inicio) params.comp_inicio = args.comp_inicio;
      if (args.comp_fin) params.comp_fin = args.comp_fin;

      const data = await apiGet<SalesComparisonResponse>(
        `/internal/dashboard/${idEmpresa}/sales-comparison`,
        idEmpresa,
        params
      );

      const p = data.periodo;
      const c = data.comparacion;
      const v = data.variacion;

      const lines = [
        `📈 REPORTE DE VENTAS Y COBROS (Empresa ${idEmpresa})`,
        `Período principal: ${p.rango.descripcion} (${p.rango.inicio} al ${p.rango.fin})`,
        `  - Total Facturado: ${money(p.ventas)} (${p.total_ordenes} órdenes)`,
        `  - Total Cobrado: ${money(p.cobrado)} (${p.porcentaje_cobrado}% de recaudación)`,
        `  - Saldo por cobrar pendiente: ${money(p.saldo_por_cobrar)}`,
        `  - Descuentos aplicados: ${money(p.descuentos)}`,
        `  - Ticket promedio: ${money(p.ticket_promedio)} por orden`,
      ];

      if (c && v) {
        lines.push(
          "",
          `⚖️ COMPARATIVA CON: ${c.rango.descripcion} (${c.rango.inicio} al ${c.rango.fin})`,
          `  - Ventas período comparación: ${money(c.ventas)} (${c.total_ordenes} órdenes)`,
          `  - Cobrado período comparación: ${money(c.cobrado)}`,
          `  - Variación en Ventas: ${v.diferencia_ventas >= 0 ? "+" : ""}${money(v.diferencia_ventas)} (${pct(v.porcentaje_variacion_ventas)})`,
          `  - Variación en Cobrado: ${v.diferencia_cobrado >= 0 ? "+" : ""}${money(v.diferencia_cobrado)} (${pct(v.porcentaje_variacion_cobrado)})`,
          `  - Variación en Órdenes: ${v.diferencia_ordenes >= 0 ? "+" : ""}${v.diferencia_ordenes} órdenes (${pct(v.porcentaje_variacion_ordenes)})`,
          `  - Variación Ticket Promedio: ${v.diferencia_ticket >= 0 ? "+" : ""}${money(v.diferencia_ticket)} (${pct(v.porcentaje_variacion_ticket)})`
        );
      }

      return ok(lines.join("\n"), { ...data });
    })
  );

  // =========================================================================
  // TOOL 3: ninesys_get_top_products_ranking
  // =========================================================================
  server.registerTool(
    "ninesys_get_top_products_ranking",
    {
      title: "Ranking de productos más producidos o pedidos",
      description: `Consulta el ranking de los productos más elaborados en el taller o pedidos en órdenes para cualquier rango de fechas o período (semana actual, semana anterior, mes actual, mes anterior, año, etc.).

Criterios:
- 'producidos' (default): Unidades efectivamente finalizadas en el taller durante el período (mismo criterio del gráfico del Dashboard).
- 'pedidos': Unidades solicitadas en órdenes creadas durante el período.

Úsala ante preguntas como:
- "¿Cuáles son los productos más vendidos esta semana?"
- "¿Qué se fabricó más la semana pasada?"
- "¿Cuál es el top de productos de este mes?"
NO modifica nada.`,
      inputSchema: {
        periodo: z
          .enum([
            "semana_actual",
            "semana_anterior",
            "mes_actual",
            "mes_anterior",
            "ano_actual",
            "ano_anterior",
            "custom",
          ])
          .default("semana_actual")
          .describe("Período a consultar. Default 'semana_actual'."),
        criterio: z
          .enum(["producidos", "pedidos"])
          .default("producidos")
          .describe("Criterio: 'producidos' (unidades terminadas en taller) o 'pedidos' (unidades en órdenes creadas)."),
        inicio: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Fecha inicio YYYY-MM-DD si periodo='custom'."),
        fin: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Fecha fin YYYY-MM-DD si periodo='custom'."),
        limit: z.number().int().min(1).max(50).default(10).describe("Cantidad de productos a mostrar (1 a 50)."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_get_top_products_ranking", async (args) => {
      const params: Record<string, unknown> = {
        periodo: args.periodo || "semana_actual",
        criterio: args.criterio || "producidos",
        limit: args.limit || 10,
      };
      if (args.inicio) params.inicio = args.inicio;
      if (args.fin) params.fin = args.fin;

      const data = await apiGet<TopProductsResponse>(
        `/internal/dashboard/${idEmpresa}/top-products`,
        idEmpresa,
        params
      );

      const critDesc = data.criterio === "producidos" ? "unidades producidas/terminadas" : "unidades pedidas";
      const lines = [
        `🏆 TOP ${data.ranking.length} PRODUCTOS (${data.rango.descripcion})`,
        `Criterio: ${critDesc} | Total unidades en ranking: ${data.total_unidades}`,
        "",
      ];

      if (data.ranking.length === 0) {
        lines.push("(no se registraron productos en este período)");
      } else {
        data.ranking.forEach((p) => {
          lines.push(`  ${p.posicion}. ${p.nombre}: ${p.unidades} unidades (${p.porcentaje}%)`);
        });
      }

      return ok(lines.join("\n"), { ...data });
    })
  );
}
