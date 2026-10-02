import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiPost } from "../services/apiClient.js";
import { ok, guard } from "./helpers.js";
import type { RequestContext } from "./index.js";
import type {
  CalculateQuoteResponse,
  CreatePresupuestoResponse,
} from "../types/api.js";

const money = (n: number) => `$${Number(n).toFixed(2)}`;

const quoteItemSchema = z.object({
  cod: z
    .number()
    .int()
    .optional()
    .describe("ID numérico del producto en el catálogo (ej: 12)."),
  productoNombre: z
    .string()
    .optional()
    .describe("Nombre o descripción del producto si no se conoce el código (ej: 'Franela Clásica')."),
  cantidad: z
    .number()
    .int()
    .min(1)
    .describe("Cantidad de prendas para esta combinación de talla/corte."),
  talla: z
    .string()
    .optional()
    .default("M")
    .describe("Talla (ej: 'S', 'M', 'L', 'XL', '2XL', 'XXL', '14')."),
  corte: z
    .enum(["Caballeros", "Damas", "Niños", "Unisex"])
    .optional()
    .default("Caballeros")
    .describe("Corte de la prenda: 'Caballeros', 'Damas', 'Niños' o 'Unisex'."),
  tela: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Nombre o ID de la tela del catálogo (ej: 'Microfibra', 'Atlética', o ID 3)."),
  precio: z
    .number()
    .optional()
    .describe("Precio unitario acordado o base. Si se omite, se toma del catálogo."),
});

export function registerQuoteTools(server: McpServer, ctx: RequestContext): void {
  const { idEmpresa } = ctx;

  // =========================================================================
  // TOOL 1: ninesys_calculate_quote (Solo lectura / Cálculo previo)
  // =========================================================================
  server.registerTool(
    "ninesys_calculate_quote",
    {
      title: "Calcular cotización previa de productos sin guardar",
      description: `Calcula los precios base, recargo determinístico por tallas XL (+$1 por cada X adicional), subtotales y gran total de una cotización, validando los productos contra el catálogo real de la empresa.

NO modifica ni guarda nada en la base de datos (es de solo lectura).
Úsala siempre antes de presentar una cotización o presupuesto al usuario o cliente, para verificar que los productos existen y los cálculos son 100% exactos.`,
      inputSchema: {
        items: z
          .array(quoteItemSchema)
          .min(1)
          .describe("Lista de productos con cantidades, tallas y telas a cotizar."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_calculate_quote", async (args) => {
      const data = await apiPost<CalculateQuoteResponse>(
        `/internal/presupuestos/${idEmpresa}/calcular`,
        idEmpresa,
        { items: args.items }
      );

      const lines = [
        `📋 CÁLCULO DE COTIZACIÓN (Empresa ${idEmpresa})`,
        `Prendas totales: ${data.total_prendas} | Gran Total: ${money(data.total)}`,
        "",
        "Desglose de productos:",
        "--------------------------------------------------------------------------------",
      ];

      data.items.forEach((item, idx) => {
        const xlNote = item.recargo_xl > 0 ? ` (+$${item.recargo_xl} recargo XL)` : "";
        lines.push(
          `${idx + 1}. [Cod: ${item.cod}] ${item.productoNombre} (${item.categoryName})`
        );
        lines.push(
          `   ${item.cantidad} unds | Talla: ${item.talla}${xlNote} | Corte: ${item.corte} | Tela: ${item.tela || "N/A"}`
        );
        lines.push(
          `   P. Unitario: ${money(item.precio_unitario)} (Base: ${money(item.precio_base)}) -> Subtotal: ${money(item.subtotal)}`
        );
      });

      lines.push("--------------------------------------------------------------------------------");
      lines.push(`💰 TOTAL ESTIMADO: ${money(data.total)}`);

      return ok(lines.join("\n"), { ...data });
    })
  );

  // =========================================================================
  // TOOL 2: ninesys_create_presupuesto (Mutación ACID / INSERT)
  // =========================================================================
  server.registerTool(
    "ninesys_create_presupuesto",
    {
      title: "Crear y registrar presupuesto en el sistema (INSERT)",
      description: `Registra formalmente un presupuesto confirmado en la base de datos de la empresa:
1. Registra o actualiza al cliente en el directorio de 'customers' (por cédula o teléfono, sin duplicados).
2. Valida los productos contra el catálogo real y aplica automáticamente los recargos por talla XL.
3. Inserta la cabecera del presupuesto ('presupuestos') con estatus 'En espera'.
4. Inserta las líneas de detalle ('presupuestos_productos') enlazadas.
5. Asigna automáticamente un vendedor responsable (vendedor previo recurrente o rotación equitativa en Comercialización).

⚠️ IMPORTANTE: Esta herramienta MODIFICA la base de datos (INSERT). Úsala ÚNICAMENTE cuando el cliente o usuario haya confirmado explícitamente que desea generar o registrar el presupuesto.`,
      inputSchema: {
        cliente: z
          .object({
            nombre: z.string().describe("Nombre del cliente."),
            apellido: z.string().optional().describe("Apellido del cliente."),
            telefono: z.string().optional().describe("Teléfono de contacto o WhatsApp."),
            cedula: z.string().optional().describe("Cédula o RIF del cliente."),
            email: z.string().optional().describe("Correo electrónico del cliente."),
            direccion: z.string().optional().describe("Dirección de entrega o ciudad."),
          })
          .describe("Datos de identificación y contacto del cliente."),
        items: z
          .array(quoteItemSchema)
          .min(1)
          .describe("Lista de prendas o artículos a incluir en el presupuesto."),
        observaciones: z
          .string()
          .optional()
          .describe("Observaciones o especificaciones técnicas del diseño y acabados."),
        origen: z
          .string()
          .optional()
          .default("ia_assistant")
          .describe("Canal de origen del pedido ('whatsapp', 'ia_chat', 'web')."),
        responsable: z
          .number()
          .int()
          .optional()
          .describe("ID opcional del vendedor a asignar. Si se omite, se asigna automáticamente."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    guard("ninesys_create_presupuesto", async (args) => {
      const data = await apiPost<CreatePresupuestoResponse>(
        `/internal/presupuestos/${idEmpresa}/crear`,
        idEmpresa,
        {
          cliente: args.cliente,
          items: args.items,
          observaciones: args.observaciones,
          origen: args.origen || "ia_assistant",
          responsable: args.responsable,
        }
      );

      const lines = [
        `🎉 ¡PRESUPUESTO CREADO EXITOSAMENTE! (Empresa ${idEmpresa})`,
        `Número de Presupuesto: #${data.id_presupuesto}`,
        `Estado: ${data.status} | Fecha: ${data.moment}`,
        "",
        `👤 Cliente: ${data.cliente.nombre}` +
          (data.cliente.telefono ? ` | Tel: ${data.cliente.telefono}` : "") +
          (data.cliente.cedula ? ` | Cédula: ${data.cliente.cedula}` : ""),
        `💼 Asesor asignado: #${data.responsable.id_usuario ?? "-"} ${data.responsable.nombre}`,
        `Prendas: ${data.total_prendas} | Gran Total: ${money(data.total)}`,
        "",
        "Líneas registradas:",
      ];

      data.items.forEach((item, idx) => {
        lines.push(
          `  ${idx + 1}. ${item.productoNombre} - ${item.cantidad} unds (Talla ${item.talla}, ${item.corte}, ${item.tela}) -> ${money(item.subtotal)}`
        );
      });

      return ok(lines.join("\n"), { ...data });
    })
  );
}
