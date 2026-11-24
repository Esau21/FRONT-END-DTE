// Cliente del servicio Go (SMPT-DTE). Las rutas son relativas: en desarrollo
// Vite las reenvía al backend (ver vite.config.ts).
const BASE = '/api/v1/mail'

/** Navegar aquí inicia el login con Google (el backend redirige). */
export const LOGIN_URL = `${BASE}/auth`

export interface Me {
  id: string
  email: string
}

export interface MessageSummary {
  id: string
  threadId: string
  from: string
  subject: string
  date: string
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
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
  login_required: 'Tu sesión expiró. Inicia sesión de nuevo.',
  unreadable_message: 'No se pudo leer este correo.',
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
