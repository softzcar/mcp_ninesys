// Formas de respuesta de los endpoints /internal/* de ninesys-api y del CDN.
// Derivadas de ninesys-api/app/routes/msg_service.php y los clientes actuales
// de msg_ninesys/src/lib/*.

export interface CatalogPrice {
  price: number;
  descripcion: string;
}

export interface CatalogAttribute {
  name: string;
  values: string[];
}

export interface CatalogProduct {
  id: number;
  name: string;
  description: string;
  is_physical: boolean;
  is_design: boolean;
  prices: CatalogPrice[];
  categories: string[];
  category_id: number;
  attributes: CatalogAttribute[];
}

export interface CatalogResponse {
  id_empresa: number;
  search_term: string | null;
  only_design: boolean;
  product_count: number;
  products: CatalogProduct[];
}

export interface CustomerSearchRow {
  _id: number;
  first_name: string;
  last_name: string;
  phone: string;
  cedula: string;
  email: string;
  ordenes_en_curso: number;
  ultima_orden: number | null;
  fecha_ultima_orden: string | null;
}
export interface CustomerSearchResponse {
  count: number;
  customers: CustomerSearchRow[];
}

// Convención para que el chat muestre imágenes: cualquier tool puede devolver
// structuredContent.images = ChatImage[]. El agente las recoge (nunca del texto).
export interface ChatImage {
  url: string;
  caption: string;
}

export interface DesignRevision {
  _id: number;
  revision: number | null;
  tipo: string;
  estatus: string;
  url_image: string | null;
  detalles: string | null;
  fecha: string;
  id_product: number | null;
}
export interface OrderDesignsResponse {
  found: boolean;
  id_orden?: number;
  revisiones?: DesignRevision[];
}
export interface PendingDesign {
  _id: number;
  id_orden: number;
  revision: number | null;
  tipo: string;
  url_image: string;
  detalles: string | null;
  fecha: string;
  status_orden: string;
  cliente: string;
}
export interface PendingDesignsResponse {
  count: number;
  pendientes: PendingDesign[];
}
export interface CdnApprovedResponse {
  url: string;
}

export interface StatementOrder {
  id_orden: number;
  status: string;
  fecha_creacion: string | null;
  fecha_entrega: string | null;
  pago_total: number;
  total_abonos: number;
  total_descuentos: number;
  total_notas_credito: number;
  saldo_pendiente: number;
  entregada_con_deuda: boolean;
}
export interface StatementPayment {
  fecha: string;
  id_orden: number;
  metodo_pago: string;
  moneda: string;
  monto: number;
  tasa: number;
  monto_base: number;
  referencia: string | null;
  tipo_de_pago: string | null;
  verificado: boolean;
  sin_abono: boolean;
}
export interface StatementAdjustment {
  fecha: string;
  id_orden: number;
  descuento: number;
  nota_credito: number;
  detalle: string | null;
}
export interface AccountStatementResponse {
  found: boolean;
  motivo?: "orden_no_existe" | "cliente_no_existe" | "id_no_coincide_con_nombre";
  nombre_dado?: string;
  nombre_del_id?: string;
  customer_id?: number;
  id_orden?: number | null;
  advertencia?: string | null;
  customer?: { _id: number; nombre: string; phone: string; cedula: string };
  resumen?: {
    ordenes_listadas: number;
    total_facturado: number;
    total_abonado: number;
    total_descuentos: number;
    total_notas_credito: number;
    saldo_total_pendiente: number;
    entregadas_con_deuda: number;
    pagos_sin_verificar: number;
    pagos_sin_abono: number;
  };
  ordenes?: StatementOrder[];
  pagos?: StatementPayment[];
  ajustes?: StatementAdjustment[];
}

export interface CustomerByPhoneResponse {
  found: boolean;
  customer?: {
    _id: number;
    first_name: string;
    last_name: string;
    cedula: string;
    phone: string;
    email: string;
    address: string;
  };
  last_vendedor_id?: number | null;
}

export interface OrderProduct {
  id?: number;
  cod?: number | null;
  sku?: string;
  name: string;
  cantidad: number;
  precio?: number;
  subtotal?: number;
  talla?: string;
  detalle_tallas?: string;
  tela?: string;
  corte?: string;
  atributo?: string;
}

export interface OrderPaymentMethod {
  moneda: string;
  metodo_pago: string;
  monto: number;
  tasa: number;
  detalle: string;
}

export interface OrderCustomerInfo {
  id: number;
  nombre: string;
  telefono: string;
  cedula: string;
  email: string;
  direccion: string;
}

export interface Order {
  id_orden: number;
  status: string;
  cliente_nombre?: string;
  vendedor?: string;
  fecha_inicio?: string | null;
  fecha_entrega: string | null;
  pago_total: number;
  total_abonos: number;
  total_descuentos: number;
  total_notas_credito?: number;
  saldo_pendiente: number;
  sobrepago?: number;
  estado_pago?: string;
  descuento_detalle?: string;
  diseno_tipo?: string;
  observaciones?: string;
  metodos_pago?: OrderPaymentMethod[];
  productos: OrderProduct[];
  imagenes_observaciones?: Array<{ url: string; caption: string }>;
  reposiciones?: Array<{ id_reposicion: number; producto: string | null; unidades: number; motivo: string | null; fecha: string; estado: string }>;
}

export interface OrdersByPhoneResponse {
  found: boolean;
  customer_id?: number;
  customer_name?: string;
  ordenes?: Order[];
}

export interface OrderByIdResponse {
  found: boolean;
  customer_id?: number;
  customer_name?: string;
  cliente?: OrderCustomerInfo;
  orden?: Order;
}

export interface OrderSummaryByStatus {
  id_orden: number;
  status: string;
  cliente_nombre: string;
  vendedor: string;
  fecha_inicio: string | null;
  fecha_entrega: string | null;
  pago_total: number;
  total_abonos: number;
  total_descuentos: number;
  saldo_pendiente: number;
  sobrepago: number;
  estado_pago: string;
  productos_resumen: Array<{
    name: string;
    cantidad: number;
    talla?: string;
  }>;
}

export interface OrdersByStatusResponse {
  total: number;
  devueltas?: number;
  status_filter: string;
  ordenes: OrderSummaryByStatus[];
}

// Órdenes en curso con el mismo criterio que la pantalla Control de
// producción de app_multi (GET /internal/ordenes/{id}/en-curso).
export interface OrderEnCurso {
  id_orden: number;
  status: string;
  cliente: string | null;
  paso: string;
  progreso: number;
  unidades: number;
  urgente: boolean;
  fecha_inicio: string | null;
  fecha_entrega: string | null;
  atrasada: boolean;
  solo_impresion: boolean;
}

export interface OrdersEnCursoResponse {
  total: number;
  resumen: {
    por_estado: Record<string, number>;
    por_paso: Record<string, number>;
    urgentes: number;
    atrasadas: number;
    por_asignar: number;
    solo_impresion: number;
  };
  ordenes: OrderEnCurso[];
}

export interface OrderSearchProductItem {
  id: number;
  name: string;
  cantidad: number;
  talla: string;
  tela: string;
  corte: string;
  precio: number;
  subtotal: number;
}

export interface OrderSearchSummary {
  total_ordenes: number;
  total_unidades: number;
  unidades_por_talla: Record<string, number>;
  unidades_por_tela: Record<string, number>;
  unidades_por_producto: Record<string, number>;
}

export interface OrderSearchItem {
  id_orden: number;
  status: string;
  cliente_nombre: string;
  vendedor: string;
  fecha_inicio: string | null;
  fecha_entrega: string | null;
  pago_total: number;
  total_abonos: number;
  total_descuentos: number;
  saldo_pendiente: number;
  sobrepago: number;
  estado_pago: string;
  productos_coincidentes: OrderSearchProductItem[];
  total_productos_orden: number;
}

export interface OrdersSearchByProductResponse {
  total: number;
  devueltas?: number;
  resumen?: OrderSearchSummary;
  filters: {
    producto?: string | null;
    talla?: string | null;
    tela?: string | null;
    corte?: string | null;
    status?: string | null;
  };
  ordenes: OrderSearchItem[];
}

export interface BusinessHours {
  horaInicioManana: number | string;
  horaFinManana: number | string;
  horaInicioTarde: number | string;
  horaFinTarde: number | string;
  horaInicioNoche?: number | string;
  horaFinNoche?: number | string;
  diasLaborales: number[];
  diasManana?: number[];
  diasTarde?: number[];
  diasNoche?: number[];
}

export interface BusinessHoursResponse {
  id_empresa: number;
  nombre: string;
  horario_laboral: BusinessHours;
}

// GET /telas -> { data: [{ _id, tela, ... }] }
export interface FabricRow {
  _id: number;
  tela: string;
  [k: string]: unknown;
}
export interface FabricsResponse {
  data: FabricRow[];
}

// GET /sizes -> { data: [...] } (shape de WooMe::getSizes, campos variables)
export interface SizesResponse {
  data: unknown[];
}

// CDN ?action=catalog -> { images: string[] }
export interface GalleryImagesResponse {
  images: string[];
}

// CDN ?action=gallery_categories -> { categories: [{ name, count }] }
export interface GalleryCategory {
  name: string;
  count: number;
}
export interface GalleryCategoriesResponse {
  categories: GalleryCategory[];
}

// ---------------------------------------------------------------------------
// Dashboard de Administración & Analítica (/internal/dashboard/*)
// ---------------------------------------------------------------------------
export interface DashboardSummaryResponse {
  success: boolean;
  id_empresa: number;
  tasas: Record<string, { es_base: boolean; tasa_manual: number | null; actualizado: string | null }>;
  tiempos_entrega: {
    por_iniciar: number;
    retrasado: number;
    en_el_dia: number;
    a_tiempo: number;
    pausadas: number;
    total_cola: number;
  };
  estado_ordenes: {
    en_espera: number;
    pausadas: number;
    activas: number;
    terminadas: number;
    total: number;
  };
  ordenes_por_departamento: Array<{ departamento: string; cantidad: number }>;
  ventas_mes_actual: {
    ventas: number;
    cobrado: number;
    saldo_por_cobrar: number;
    porcentaje_cobrado: number;
    total_ordenes: number;
  };
  estado_disenos: {
    asignados: number;
    propuestas_enviadas: number;
    aprobados_pagados: number;
  };
  resumen_semanal: Array<{ dia: string; fecha: string; total_ordenes: number }>;
}

export interface SalesPeriodData {
  rango: { inicio: string; fin: string; descripcion: string; dias?: number };
  ventas: number;
  cobrado: number;
  saldo_por_cobrar: number;
  descuentos: number;
  total_ordenes: number;
  ticket_promedio: number;
  porcentaje_cobrado: number;
}

export interface SalesComparisonResponse {
  success: boolean;
  id_empresa: number;
  periodo: SalesPeriodData;
  comparacion: SalesPeriodData | null;
  variacion: {
    diferencia_ventas: number;
    porcentaje_variacion_ventas: number | null;
    diferencia_cobrado: number;
    porcentaje_variacion_cobrado: number | null;
    diferencia_ordenes: number;
    porcentaje_variacion_ordenes: number | null;
    diferencia_ticket: number;
    porcentaje_variacion_ticket: number | null;
  } | null;
}

export interface TopProductItem {
  id_producto: number;
  nombre: string;
  unidades: number;
  posicion: number;
  porcentaje: number;
}

export interface TopProductsResponse {
  success: boolean;
  id_empresa: number;
  rango: { inicio: string; fin: string; descripcion: string };
  criterio: "producidos" | "pedidos";
  total_unidades: number;
  ranking: TopProductItem[];
}

// ---------------------------------------------------------------------------
// Empleados y Ventas (/internal/empleados/*)
// ---------------------------------------------------------------------------
export interface EmployeeItem {
  id_usuario: number;
  nombre: string;
  email: string;
  telefono: string;
  departamento_principal: string;
  departamentos_asignados: string[];
  activo: boolean;
  acceso_sistema: boolean;
  status: "activo" | "inactivo";
}

export interface EmployeeListResponse {
  success: boolean;
  total: number;
  empleados: EmployeeItem[];
}

export interface EmployeeSalesMetrics {
  total_ordenes: number;
  total_ventas: number;
  total_cobrado: number;
  saldo_por_cobrar: number;
  total_descuentos: number;
  ticket_promedio: number;
  porcentaje_cobrado: number;
}

export interface EmployeeRecentOrder {
  id_orden: number;
  cliente: string;
  monto: number;
  status: string;
  fecha: string;
}

export interface EmployeeSalesResponse {
  success: boolean;
  rango: { inicio: string; fin: string; descripcion: string };
  empleado?: {
    id_usuario: number;
    nombre: string;
    departamento: string;
  };
  metricas?: EmployeeSalesMetrics;
  por_estado?: Record<string, number>;
  ultimas_ordenes?: EmployeeRecentOrder[];
  totales?: {
    total_ordenes: number;
    total_ventas: number;
    total_cobrado: number;
  };
  ranking?: Array<{
    id_usuario: number | null;
    nombre: string;
    departamento: string;
    total_ordenes: number;
    total_ventas: number;
    total_cobrado: number;
    saldo_por_cobrar: number;
    ticket_promedio: number;
    posicion: number;
    porcentaje_ventas: number;
  }>;
}

// ---------------------------------------------------------------------------
// Inventario, Telas y Consumibles (/internal/inventario/*)
// ---------------------------------------------------------------------------
export interface InventoryStockItem {
  sku: string;
  insumo: string;
  tipo_insumo: string;
  unidad: string;
  departamento: string;
  stock_total: number;
  rollos_lotes: number;
  alerta_bajo: boolean;
  agotado: boolean;
}

export interface InventoryStockResponse {
  success: boolean;
  id_empresa: number;
  resumen_por_tipo: Record<string, { total_items: number; stock_total: number }>;
  filtros: {
    tipo: string;
    buscar: string | null;
    solo_bajo_stock: boolean;
    umbral: number;
  };
  total_resultados: number;
  items: InventoryStockItem[];
}

// ---------------------------------------------------------------------------
// Nómina y Comisiones (/internal/nomina/*)
// ---------------------------------------------------------------------------
export interface PayrollConceptItem {
  concepto: string;
  cantidad: number;
  monto: number;
}

export interface PayrollTaskItem {
  id_pago: number;
  id_orden: number | null;
  concepto: string;
  monto_pago: number;
  comision: number;
  fecha_tarea: string;
  fecha_pago: string | null;
  estatus: string;
}

export interface PayrollEmployeeSummary {
  id_empleado: number;
  nombre: string;
  departamento: string;
  total_tareas: number;
  monto_total: number;
}

export interface EmployeePayrollResponse {
  success: boolean;
  id_empresa: number;
  estado_filtro: 'pendientes' | 'pagadas' | 'todas';
  // Cuando se consulta un empleado específico:
  empleado?: {
    id_usuario: number;
    nombre: string;
    departamento: string;
  };
  monto_total?: number;
  total_tareas?: number;
  desglose_por_concepto?: PayrollConceptItem[];
  tareas?: PayrollTaskItem[];
  // Cuando se consulta el resumen global de nómina:
  gran_total_monto?: number;
  gran_total_tareas?: number;
  personal?: PayrollEmployeeSummary[];
}

// ---------------------------------------------------------------------------
// Operaciones de Taller y Control de Producción (/internal/taller/*)
// ---------------------------------------------------------------------------
export interface DelayedOrderItem {
  id_orden: number;
  cliente: string;
  fecha_entrega: string;
  dias_retraso: number;
  departamento_actual: string;
  pago_total: number;
  pago_abono: number;
  saldo_pendiente: number;
  productos: string;
}

export interface DelayedOrdersResponse {
  success: boolean;
  id_empresa: number;
  total_retrasadas: number;
  resumen_por_departamento: Record<string, number>;
  total_mostradas: number;
  ordenes: DelayedOrderItem[];
}

export interface DesignerWorkloadItem {
  id_empleado: number | null;
  disenador: string;
  disenos_activos: number;
  disenos_terminados: number;
  propuestas_esperando_cliente: number;
}

export interface PendingProposalItem {
  id_revision: number;
  id_orden: number;
  cliente: string;
  disenador: string;
  fecha_propuesta: string;
  url_image: string;
}

export interface DesignerWorkloadResponse {
  success: boolean;
  id_empresa: number;
  total_disenos_activos: number;
  total_esperando_cliente: number;
  disenadores: DesignerWorkloadItem[];
  propuestas_en_espera: PendingProposalItem[];
}
