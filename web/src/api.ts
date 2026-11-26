// Cliente del servicio Go (SMPT-DTE). Las rutas son relativas: en desarrollo
// Vite las reenvía al backend (ver vite.config.ts).
const BASE = '/api/v1/mail'

/** Navegar aquí inicia el login con Google (el backend redirige). */
export const LOGIN_URL = `${BASE}/auth`

export type Provider = 'gmail' | 'outlook'

/** Dirección que inicia el login con un proveedor (el backend redirige). */
export const loginUrl = (provider: Provider) => `${BASE}/auth?provider=${provider}`

export interface Me {
  id: string
  email: string
  /** De dónde viene el correo de esta sesión. */
  provider?: Provider
}

export interface MessageSummary {
  id: string
  threadId: string
  from: string
  subject: string
  date: string
  /** Primeras palabras del correo (solo en la lista). */
  snippet?: string
  /** El correo aún no se ha leído en Gmail (solo en la lista). */
  unread?: boolean
}

export interface Attachment {
  index: number
  filename: string
  contentType: string
  size: number
}

export interface MessageDetail extends MessageSummary {
  to: string
  text: string
  /** Versión HTML del correo; vacío si el correo solo trae texto. */
  html?: string
  /** Archivos adjuntos (el .json, el .pdf, ...). */
  attachments?: Attachment[]
}

export interface MessagePage {
  messages: MessageSummary[]
  nextPageToken?: string
}

export type Json = Record<string, unknown>

export interface Dte {
  identificacion: {
    version: number
    ambiente: string
    tipoDte: string
    numeroControl: string
    codigoGeneracion: string
    fecEmi: string
    horEmi: string
    tipoMoneda: string
  }
  emisor: { nit: string; nrc: string; nombre: string }
  receptor: Json | null
  cuerpoDocumento: Json[] | null
  resumen: Json | null
  selloRecibido: string
}

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string) {
    super(code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      ...init,
    })
  } catch {
    throw new ApiError(0, 'network_error')
  }

  if (res.status === 204) return undefined as T

  // El backend responde los errores como {"error": "codigo"}
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const code =
      body && typeof body === 'object' && 'error' in body
        ? String(body.error)
        : res.status >= 500
          ? 'service_unavailable'
          : `http_${res.status}`
    throw new ApiError(res.status, code)
  }
  if (body === null) throw new ApiError(res.status, 'service_unavailable')
  return body as T
}

const request = <T>(path: string, init?: RequestInit) => send<T>(BASE + path, init)

/** Con qué proveedores se puede iniciar sesión en este servidor. */
export const getProviders = () =>
  request<{ providers: Provider[] }>('/providers').then((data) => data.providers)

export const getMe = () => request<Me>('/me')

export const logout = () => request<void>('/session', { method: 'DELETE' })

export function listMessages(opts: {
  q?: string
  limit?: number
  pageToken?: string
}) {
  const params = new URLSearchParams()
  if (opts.q) params.set('q', opts.q)
  if (opts.limit) params.set('limit', String(opts.limit))
  if (opts.pageToken) params.set('pageToken', opts.pageToken)
  return request<MessagePage>(`/messages?${params}`)
}

export const getMessage = (id: string) =>
  request<MessageDetail>(`/messages/${encodeURIComponent(id)}`)

/** URL de un adjunto. Los PDF se abren en el navegador salvo que se pida descarga. */
export const attachmentUrl = (id: string, index: number, download = false) =>
  `${BASE}/messages/${encodeURIComponent(id)}/attachments/${index}${download ? '?download=1' : ''}`

export const getDte = (id: string) =>
  request<Dte>(`/messages/${encodeURIComponent(id)}/dte`)

const MESSAGES: Record<string, string> = {
  network_error: 'No se pudo conectar con el servicio.',
  service_unavailable:
    'El servicio no responde. Verifica que la API de Go esté corriendo en el puerto 8080.',
  unknown_provider: 'Ese proveedor de correo no está disponible.',
  login_required: 'Tu sesión expiró. Inicia sesión de nuevo.',
  unreadable_message: 'No se pudo leer este correo.',
  storage_unavailable:
    'El almacenamiento no está disponible. Las facturas y los archivos guardados no se pueden consultar.',
  storage_error: 'No se pudo usar el almacenamiento. Intenta de nuevo.',
  invoice_not_found: 'La factura ya no existe.',
  export_failed: 'No se pudo generar el archivo de Excel.',
  file_too_large: 'El archivo es demasiado grande para guardarlo (máximo 20 MB).',
  invalid_folder: 'Ese nombre de carpeta no se puede usar.',
  folder_not_empty: 'La carpeta todavía tiene archivos o carpetas dentro.',
  folder_not_found: 'La carpeta ya no existe.',
  file_not_found: 'El archivo guardado ya no existe.',
  attachment_not_found: 'El adjunto ya no está disponible.',
  dte_not_found: 'Este correo no trae un DTE (.json) adjunto.',
  invalid_dte: 'El adjunto .json no es un DTE válido.',
  limit_must_be_1_to_25: 'El límite debe estar entre 1 y 25.',
  'Too Many Requests': 'Gmail está limitando las consultas. Intenta en un momento.',
  'Gateway Timeout': 'Gmail tardó demasiado en responder. Intenta de nuevo.',
  'Bad Gateway': 'Gmail no respondió correctamente. Intenta de nuevo.',
  'Not Found': 'El correo ya no existe.',
  'Bad Request': 'La búsqueda no es válida.',
  Forbidden: 'Gmail rechazó la consulta por falta de permisos.',
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return MESSAGES[err.code] ?? `Error: ${err.code}`
  return 'Ocurrió un error inesperado.'
}

export const isUnauthorized = (err: unknown) =>
  err instanceof ApiError && err.status === 401

/* ---------- facturas guardadas ---------- */

const INVOICES = '/api/v1/invoices'

export type InvoiceStatus = 'pendiente' | 'revisada' | 'pagada'

export interface Invoice {
  id: number
  codigoGeneracion: string
  numeroControl: string
  tipoDte: string
  ambiente: string
  fecha: string
  hora: string
  moneda: string
  emisorNit: string
  emisorNrc: string
  emisorNombre: string
  receptorDoc: string
  receptorNrc: string
  receptorNombre: string
  noSujeto: number
  exento: number
  gravado: number
  iva: number
  ivaPercibido: number
  ivaRetenido: number
  total: number
  sello: string
  messageId: string
  status: InvoiceStatus
  category: string
  notes: string
}

/** Sumas de un conjunto de facturas; las notas de crédito restan. */
export interface Totals {
  count: number
  gravado: number
  iva: number
  total: number
}

export interface InvoiceFilter {
  from?: string
  to?: string
  status?: string
  tipo?: string
  q?: string
  /** "" (lo más nuevo primero), fecha_asc, total_desc, total_asc o emisor_asc. */
  sort?: string
}

export interface SyncResult {
  scanned: number
  imported: number
  skipped: number
  nextPageToken: string
  done: boolean
}

export interface Summary {
  /** Primer mes del resumen, AAAA-MM. */
  since: string
  thisMonth: string
  months: (Totals & { month: string })[]
  issuers: (Totals & { nombre: string; nit: string })[]
  byStatus: Record<string, number>
  categories: string[]
  /** Las últimas facturas, de la más nueva a la más vieja. */
  recent: Invoice[]
  /** Sumas por tipo de documento; `name` es el código (01, 03, ...). */
  types: (Totals & { name: string })[]
  /** Sumas por categoría; las facturas sin categoría van con `name` vacío. */
  categoryTotals: (Totals & { name: string })[]
  /** Lo que suman las facturas que aún no están pagadas. */
  pending: Totals
}

function filterParams(filter: InvoiceFilter) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filter)) {
    if (value) params.set(key, value)
  }
  return params
}

/** Revisa una página de correos y guarda los DTE nuevos. */
export function syncInvoices(pageToken = '', full = false) {
  const params = new URLSearchParams()
  if (pageToken) params.set('pageToken', pageToken)
  if (full) params.set('full', '1')
  return send<SyncResult>(`${INVOICES}/sync?${params}`, { method: 'POST' })
}

export function listInvoices(filter: InvoiceFilter, limit: number, offset: number) {
  const params = filterParams(filter)
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  return send<{
    items: Invoice[]
    totals: Totals
    /** Cuántas facturas hay en cada estado con estos filtros, sin contar el filtro de estado. */
    byStatus: Record<string, number>
  }>(`${INVOICES}?${params}`)
}

export const getSummary = () => send<Summary>(`${INVOICES}/summary`)

export const updateInvoice = (
  id: number,
  patch: Partial<Pick<Invoice, 'status' | 'category' | 'notes'>>,
) =>
  send<Invoice>(`${INVOICES}/${id}`, {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })

/** Cambia el estado de varias facturas de una vez. */
export const updateInvoices = (ids: number[], status: InvoiceStatus) =>
  send<{ updated: number }>(INVOICES, {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, status }),
  })

/** Dirección para descargar el Excel: el libro de compras o el detalle. */
export function exportUrl(kind: 'compras' | 'detalle', filter: InvoiceFilter) {
  const params = filterParams(filter)
  params.set('kind', kind)
  return `${INVOICES}/export?${params}`
}

/* ---------- archivos guardados en la nube ---------- */

const FILES = '/api/v1/files'
const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' }

/** Copia de un adjunto guardada en la aplicación. */
export interface SavedFile {
  id: number
  messageId: string
  filename: string
  size: number
  mailFrom: string
  mailSubject: string
  createdAt: string
  /** Ruta dentro del bucket: cuenta/año/mes/emisor/archivo. */
  path: string
}

export interface Cloud {
  files: SavedFile[]
  /** Carpetas creadas a mano por el usuario (pueden estar vacías). */
  folders: string[]
  /** Nombre del bucket donde se guarda todo. */
  bucket: string
  account: string
}

/**
 * Guarda en la nube el adjunto número `index` de un correo. Con `folder` va
 * a esa carpeta ("" es la principal); sin ella, la app lo ordena sola por
 * año, mes y emisor.
 */
export const saveFile = (messageId: string, index: number, folder?: string) =>
  send<SavedFile>(FILES, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ messageId, index, folder }),
  })

/** Cambia un archivo guardado a otra carpeta. */
export const moveFile = (id: number, folder: string) =>
  send<SavedFile>(`${FILES}/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ folder }),
  })

const FOLDERS = '/api/v1/folders'

export const createFolder = (path: string) =>
  send<{ path: string }>(FOLDERS, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ path }),
  })

/** Borra una carpeta creada a mano; solo si está vacía. */
export const deleteFolder = (path: string) =>
  send<void>(`${FOLDERS}?path=${encodeURIComponent(path)}`, { method: 'DELETE' })

/** Todo lo guardado en la nube, ordenado por carpeta. */
export const getCloud = () => send<Cloud>(FILES)

/** Archivos guardados de un correo. */
export const listFiles = (messageId: string) =>
  send<Cloud>(`${FILES}?messageId=${encodeURIComponent(messageId)}`).then((cloud) => cloud.files)

export const deleteFile = (id: number) => send<void>(`${FILES}/${id}`, { method: 'DELETE' })

/** Los PDF se abren en el navegador salvo que se pida descarga. */
export const savedFileUrl = (id: number, download = false) =>
  `${FILES}/${id}${download ? '?download=1' : ''}`
