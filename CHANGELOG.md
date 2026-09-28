# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/).

## [v0.1.0] - 2026-09-28
- Versión inicial del servidor MCP del ecosistema Ninesys (solo lectura).
- 9 tools sobre los endpoints `/internal/*` de ninesys-api y el CDN de galería:
  `ninesys_search_products`, `ninesys_list_design_services`,
  `ninesys_get_orders_by_phone`, `ninesys_get_customer_by_phone`,
  `ninesys_list_fabrics`, `ninesys_list_sizes`, `ninesys_get_business_hours`,
  `ninesys_list_gallery_categories`, `ninesys_list_gallery_images`.
- Transporte Streamable HTTP stateless (JSON) sobre Express; `/health` público.
- Seguridad: auth Bearer por app (`MCP_CLIENT_TOKENS`) + empresa obligatoria por
  petición vía cabecera `X-Ninesys-Empresa` (inyectada server-side a las tools y a
  la API; el LLM nunca controla la empresa).
- Cliente API con timeout + reintentos + circuit breaker + caché TTL.
