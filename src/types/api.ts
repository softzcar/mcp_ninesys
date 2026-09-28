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
}
export interface CustomerSearchResponse {
  count: number;
  customers: CustomerSearchRow[];
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
  name: string;
  cantidad: number;
  detalle_tallas: string;
}

export interface Order {
  id_orden: number;
  status: string;
  fecha_entrega: string | null;
  pago_total: number;
  total_abonos: number;
  total_descuentos: number;
  saldo_pendiente: number;
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
  orden?: Order;
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
