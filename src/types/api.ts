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
  status_filter: string;
  ordenes: OrderSummaryByStatus[];
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
