import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cdnGet } from "../services/apiClient.js";
import { cached } from "../services/cache.js";
import { CACHE_TTL } from "../constants.js";
import { responseFormat } from "../schemas/inputs.js";
import { ok, guard } from "./helpers.js";
import type { RequestContext } from "./index.js";
import type { GalleryImagesResponse, GalleryCategoriesResponse } from "../types/api.js";

export function registerGalleryTools(server: McpServer, ctx: RequestContext): void {
  const { idEmpresa: id_empresa } = ctx;
  server.registerTool(
    "ninesys_list_gallery_categories",
    {
      title: "Listar categorías de galería",
      description: `Lista las categorías (carpetas) de galería de imágenes de la empresa que tienen al menos una imagen.

Úsala para saber de qué productos hay fotos disponibles antes de pedir las imágenes. NO crea ni modifica nada. La empresa ya está fijada por la sesión.

Args:
  - response_format ('markdown' | 'json'): formato de salida (default: markdown).

Devuelve: { count, categories: [{ name, count }] }.`,
      inputSchema: { response_format: responseFormat },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_list_gallery_categories", async (args) => {
      const { response_format } = args as {
        response_format: "markdown" | "json";
      };
      const data = await cached(`gcats:${id_empresa}`, CACHE_TTL.galleryCategories, () =>
        cdnGet<GalleryCategoriesResponse>({ action: "gallery_categories", id_empresa })
      );
      const cats = (Array.isArray(data?.categories) ? data.categories : []).filter((c) => c.count > 0);
      if (!cats.length) {
        return ok(`La empresa ${id_empresa} no tiene categorías de galería con imágenes.`, {
          count: 0,
          categories: [],
        });
      }
      const structured = { count: cats.length, categories: cats };
      if (response_format === "json") return ok(JSON.stringify(structured, null, 2), structured);
      const text = ["Categorías de galería disponibles:", "", ...cats.map((c) => `- ${c.name} (${c.count} imágenes)`)].join("\n");
      return ok(text, structured);
    })
  );

  server.registerTool(
    "ninesys_list_gallery_images",
    {
      title: "Listar imágenes de galería de un producto",
      description: `Devuelve las URLs de las imágenes de galería de un producto/categoría de la empresa.

Úsala cuando el cliente quiere ver fotos o modelos de un producto (ej: "muéstrame franelas", "tienen fotos de gorras"). Devuelve URLs listas para enviar. NO crea ni modifica nada. La empresa ya está fijada por la sesión.

Args:
  - product (string): nombre del producto o categoría de galería (ej: "franela", "gorra"). El CDN hace coincidencia por prefijo (singular/plural).
  - response_format ('markdown' | 'json'): formato de salida (default: markdown).

Devuelve: { product, count, images: string[] }. Si no hay imágenes, count=0.`,
      inputSchema: {
        product: z
          .string()
          .trim()
          .min(2, "El nombre del producto debe tener al menos 2 caracteres.")
          .describe("Nombre del producto/categoría de galería."),
        response_format: responseFormat,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    guard("ninesys_list_gallery_images", async (args) => {
      const { product, response_format } = args as {
        product: string;
        response_format: "markdown" | "json";
      };
      const term = product.toLowerCase().trim();
      const data = await cached(`gimg:${id_empresa}:${term}`, CACHE_TTL.galleryImages, () =>
        cdnGet<GalleryImagesResponse>({ action: "catalog", id_empresa, product: term })
      );
      const images = Array.isArray(data?.images) ? data.images : [];
      const structured = { product: term, count: images.length, images };
      if (!images.length) {
        return ok(`No hay imágenes de "${product}" en la galería de la empresa ${id_empresa}.`, structured);
      }
      if (response_format === "json") return ok(JSON.stringify(structured, null, 2), structured);
      const text = [`Imágenes de "${product}" (${images.length}):`, "", ...images.map((u) => `- ${u}`)].join("\n");
      return ok(text, structured);
    })
  );
}
