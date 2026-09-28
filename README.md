# ninesys-mcp-server

Servidor **MCP (Model Context Protocol)** del ecosistema Ninesys. Expone una
**única capa de herramientas de lectura** sobre los endpoints `/internal/*` de
`ninesys-api`, para que cualquier aplicación con IA (msg_ninesys, app_multi,
19print, …) obtenga datos de la base de datos vía **tool-use** en lugar de
reimplementar la lógica de acceso en cada app.

> **Alcance v1: solo lectura.** Las escrituras (crear presupuesto/orden/cliente)
> se agregarán en una fase 2 y **solo a través de endpoints de la API**, nunca con
> acceso directo a la base de datos.

## Arquitectura

```
apps con IA (corren su propio LLM)
      │  MCP sobre HTTP  (Authorization: Bearer <token de app>)
      ▼
ninesys-mcp-server  ──X-Internal-Token + Authorization:{id_empresa}──►  ninesys-api /internal/*
```

- El MCP es un **cliente ligero de la API**: no toca la BD, no tiene lógica de
  negocio. Cada tool = una llamada a `/internal/*` (o al CDN) + formateo.
- Transporte: **Streamable HTTP stateless (JSON)**, sencillo de escalar con
  Nginx + PM2.
- Gemini no habla MCP nativamente: cada app consumidora necesita un pequeño
  adaptador MCP→function-calling (ver "Integración" abajo).

## Tools (v1)

| Tool | Endpoint respaldo |
|---|---|
| `ninesys_search_products` | `GET /internal/catalog/{id}?search=` |
| `ninesys_list_design_services` | `GET /internal/catalog/{id}?only_design=1` |
| `ninesys_get_orders_by_phone` | `GET /internal/ordenes/{id}/by-phone?phone=` |
| `ninesys_get_customer_by_phone` | `GET /internal/cliente/{id}/by-phone?phone=` |
| `ninesys_list_fabrics` | `GET /telas` |
| `ninesys_list_sizes` | `GET /sizes` |
| `ninesys_get_business_hours` | `GET /internal/business-hours` |
| `ninesys_list_gallery_categories` | `GET {CDN}/?action=gallery_categories` |
| `ninesys_list_gallery_images` | `GET {CDN}/?action=catalog&product=` |

**La empresa NO es argumento de las tools.** Se identifica a nivel de acceso: cada
petición a `/mcp` debe traer la cabecera **`X-Ninesys-Empresa: <id>`** (además del
`Authorization: Bearer`). El servidor valida la empresa y la inyecta a cada tool y
a la API; el LLM nunca la ve ni la controla, eliminando el riesgo cross-empresa.
Sin empresa válida → 400. Las tools solo aceptan sus parámetros propios (p.ej.
`search`, `phone`, `product`) y `response_format` = `markdown` (default) o `json`.

## Configuración

Copia `.env.example` a `.env` y complétalo. Claves críticas:

- `NINESYS_API_URL`, `NINESYS_CDN_URL` — URLs de la API y el CDN del servidor.
- `MSG_SERVICE_INTERNAL_TOKEN` — debe coincidir con el de `ninesys-api` en el
  mismo servidor.
- `MCP_CLIENT_TOKENS` — tokens Bearer por app, formato `nombre:token,nombre2:token2`.

## Desarrollo

```bash
npm install
cp .env.example .env   # y completar
npm run dev            # tsx watch
npm run build          # compila a dist/
npm start              # node dist/index.js
```

### Probar con MCP Inspector

```bash
npm run inspector
# Transport: Streamable HTTP
# URL: http://localhost:3100/mcp
# Headers:
#   Authorization: Bearer <uno de MCP_CLIENT_TOKENS>
#   X-Ninesys-Empresa: <id de empresa, ej. 208>
```

## Despliegue

- **Dev**: `mcp.nineteengreen.com` (vps-contabo-dev).
- **Prod**: `mcp.ninesys19.com` (vps-contabo-prod).
- Nginx reverse-proxy HTTPS → `PORT` local; proceso con PM2:
  `npm run build && pm2 start ecosystem.config.cjs`.

## Integración (apps consumidoras)

Como Gemini no es cliente MCP nativo, cada app conecta al MCP con el cliente MCP
oficial, mapea los `inputSchema` de las tools a `functionDeclarations` de Gemini,
y enruta cada `functionCall` del modelo a `callTool`. En `msg_ninesys` esto
reemplaza al `contextEnricher` especulativo por tool-use bajo demanda.
