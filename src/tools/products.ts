import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet } from "../services/apiClient.js";
import { cached } from "../services/cache.js";
import { CACHE_TTL, MAX_CATALOG_ITEMS } from "../constants.js";
import { responseFormat } from "../schemas/inputs.js";
import { ok, guard } from "./helpers.js";
import type { RequestContext } from "./index.js";
import type { CatalogResponse, CatalogProduct } from "../types/api.js";

// Formatea un producto con sus tramos de precio por cantidad (portado de
// msg_ninesys/src/lib/contextEnricher.js::formatCatalogProducts, sin emojis).
function formatProduct(p: CatalogProduct): string {
  const lines: string[] = [];
  const cats = p.categories.length ? ` (categorías: ${p.categories.join(", ")})` : "";
  lines.push(`- ${p.name} [id:${p.id}][idCat:${p.category_id}]${cats}`);
  if (p.description) lines.push(`  ${p.description}`);

  if (p.is_design && (!p.prices || p.prices.length === 0)) {
    lines.push(`  Precio: diseño personalizado (solicitar cotización)`);
  } else if (p.prices && p.prices.length) {
    const sorted = [...p.prices].sort((a, b) => {
      const qa = parseInt(a.descripcion.match(/\d+/)?.[0] || "1", 10);
      const qb = parseInt(b.descripcion.match(/\d+/)?.[0] || "1", 10);
      return qa - qb;
    });
    sorted.forEach((pr, i) => {
      const thisQty = parseInt(pr.descripcion.match(/\d+/)?.[0] || "1", 10);
      const next = sorted[i + 1];
      const nextQty = next ? parseInt(next.descripcion.match(/\d+/)?.[0] || "99999", 10) : null;
      let range: string;
      if (nextQty) {
        const maxQty = nextQty - 1;
        range = thisQty === maxQty ? `${thisQty} unidad` : `${thisQty} a ${maxQty} unidades`;
      } else {
        range = `${thisQty} o más unidades`;
      }
      lines.push(`  ${range}: $${pr.price.toFixed(2)} c/u`);
    });
  } else {
    lines.push(`  Precio no especificado`);
  }

  if (p.attributes.length) {
    for (const a of p.attributes) {
      lines.push(`  ${a.name}: ${a.values.join(", ")}`);
    }
  }
  return lines.join("\n");
}

export function registerProductTools(server: McpServer, ctx: RequestContext): void {
  const { idEmpresa: id_empresa } = ctx;
  server.registerTool(
    "ninesys_search_products",
    {
      title: "Buscar productos del catálogo",
      description: `Busca productos en el catálogo de la empresa por nombre y devuelve sus tramos de precio por cantidad, categorías y atributos (tallas, colores).

Úsala cuando el cliente pregunta por un producto, su precio, o quiere cotizar (ej: "cuánto cuestan las franelas", "tienen gorras", "precio de buzos para 20"). Busca por coincidencia parcial de nombre. NO crea ni modifica nada. La empresa ya está fijada por la sesión; no la pidas ni la pases.

Args:
  - search (string): término de búsqueda del producto (ej: "franela", "gorra"). Usa el término nativo del catálogo.
  - response_format ('markdown' | 'json'): formato de salida (default: markdown).

Devuelve: lista de productos con id, category_id, precios por tramo de cantidad, categorías y atributos. En JSON, la forma es { product_count, products: [{ id, name, description, is_physical, is_design, prices, categories, category_id, attributes }] }.

No usar para: catálogo de servicios de diseño gráfico (usa ninesys_list_design_services).`,
      inputSchema: {
        search: z
          .string()
          .trim()
          .min(2, "El término de búsqueda debe tener al menos 2 caracteres.")
          .describe("Término de búsqueda del producto (coincidencia parcial de nombre)."),
        response_format: responseFormat,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard("ninesys_search_products", async (args) => {
      const { search, response_format } = args as {
        search: string;
        response_format: "markdown" | "json";
      };
      const data = await cached(
        `catalog:${id_empresa}:${search.toLowerCase().trim()}`,
        CACHE_TTL.catalog,
        () => apiGet<CatalogResponse>(`/internal/catalog/${id_empresa}`, id_empresa, { search })
      );

      const products = (data.products || []).slice(0, MAX_CATALOG_ITEMS);
      if (!products.length) {
        return ok(`No se encontraron productos para "${search}" en la empresa ${id_empresa}.`, {
          product_count: 0,
          products: [],
        });
      }

      if (response_format === "json") {
        return ok(JSON.stringify({ product_count: products.length, products }, null, 2), {
          product_count: products.length,
          products: products as unknown as Record<string, unknown>[],
        });
      }
      const text = [`Productos encontrados para "${search}":`, "", ...products.map(formatProduct)].join("\n");
      return ok(text, { product_count: products.length, products: products as unknown as Record<string, unknown>[] });
    })
  );

  server.registerTool(
    "ninesys_list_design_services",
    {
      title: "Listar servicios de diseño gráfico",
      description: `Lista los servicios de diseño gráfico (logo, dibujo, arte, redibujo) de la empresa, con su id, category_id y precio (tarifa única).

Úsala cuando el cliente quiere agregar un servicio de diseño a su pedido o pregunta qué servicios de diseño ofrece la empresa. NO crea ni modifica nada. La empresa ya está fijada por la sesión.

Args:
  - response_format ('markdown' | 'json'): formato de salida (default: markdown).

Devuelve: lista de servicios con id, name, category_id y precio unitario (tarifa única por presupuesto, no se multiplica por cantidad).`,
      inputSchema: {
        response_format: responseFormat,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    guard("ninesys_list_design_services", async (args) => {
      const { response_format } = args as {
        response_format: "markdown" | "json";
      };
      const data = await cached(
        `catalog:${id_empresa}:__only_design__`,
        CACHE_TTL.catalog,
        () => apiGet<CatalogResponse>(`/internal/catalog/${id_empresa}`, id_empresa, { only_design: 1 })
      );

      const usable = (data.products || []).filter(
        (p) => Array.isArray(p.prices) && p.prices.length > 0 && Number(p.prices[0].price) > 0
      );
      if (!usable.length) {
        return ok(`La empresa ${id_empresa} no tiene servicios de diseño con precio configurado.`, {
          count: 0,
          services: [],
        });
      }

      if (response_format === "json") {
        const services = usable.map((p) => ({
          id: p.id,
          name: p.name,
          category_id: p.category_id,
          price: Number(p.prices[0].price),
        }));
        return ok(JSON.stringify({ count: services.length, services }, null, 2), {
          count: services.length,
          services,
        });
      }
      const text = [
        "Servicios de diseño gráfico disponibles (tarifa única por presupuesto):",
        "",
        ...usable.map(
          (p) => `- ${p.name} [id:${p.id}][idCat:${p.category_id}]: $${Number(p.prices[0].price).toFixed(2)}`
        ),
      ].join("\n");
      return ok(text, {
        count: usable.length,
        services: usable.map((p) => ({
          id: p.id,
          name: p.name,
          category_id: p.category_id,
          price: Number(p.prices[0].price),
        })),
      });
    })
  );
}
