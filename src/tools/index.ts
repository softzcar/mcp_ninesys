import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProductTools } from "./products.js";
import { registerOrderTools } from "./orders.js";
import { registerCustomerTools } from "./customers.js";
import { registerCatalogMetaTools } from "./catalogMeta.js";
import { registerGalleryTools } from "./gallery.js";
import { registerDesignTools } from "./designs.js";
import { registerReposicionTools } from "./reposiciones.js";
import { registerDashboardTools } from "./dashboard.js";
import { registerEmployeeTools } from "./employees.js";
import { registerInventoryTools } from "./inventory.js";
import { registerPayrollTools } from "./payroll.js";
import { registerOperationTools } from "./operations.js";

// Contexto de la petición inyectado por el servidor. La empresa se identifica en
// la capa de acceso (cabecera X-Ninesys-Empresa) y las tools la reciben aquí,
// nunca como argumento del modelo.
export interface RequestContext {
  idEmpresa: number;
}

/** Registra todas las tools de lectura (v1) atadas a la empresa de la petición. */
export function registerAllTools(server: McpServer, ctx: RequestContext): void {
  registerProductTools(server, ctx);
  registerOrderTools(server, ctx);
  registerCustomerTools(server, ctx);
  registerCatalogMetaTools(server, ctx);
  registerGalleryTools(server, ctx);
  registerDesignTools(server, ctx);
  registerReposicionTools(server, ctx);
  registerDashboardTools(server, ctx);
  registerEmployeeTools(server, ctx);
  registerInventoryTools(server, ctx);
  registerPayrollTools(server, ctx);
  registerOperationTools(server, ctx);
}

