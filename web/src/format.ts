// Textos y formatos que comparten las pantallas.

export const TIPOS_DTE: Record<string, string> = {
  '01': 'Factura',
  '03': 'Comprobante de crédito fiscal',
  '04': 'Nota de remisión',
  '05': 'Nota de crédito',
  '06': 'Nota de débito',
  '07': 'Comprobante de retención',
  '08': 'Comprobante de liquidación',
  '09': 'Documento contable de liquidación',
  '11': 'Factura de exportación',
  '14': 'Factura de sujeto excluido',
  '15': 'Comprobante de donación',
}

export const tipoName = (code: string) => TIPOS_DTE[code] ?? `DTE tipo ${code || '?'}`

/** Nombre corto del tipo, para tablas angostas. */
export const TIPOS_CORTOS: Record<string, string> = {
  '01': 'Factura',
  '03': 'Crédito fiscal',
  '05': 'Nota de crédito',
  '06': 'Nota de débito',
  '07': 'Retención',
  '11': 'Exportación',
  '14': 'Sujeto excluido',
}

export function money(value: unknown, currency = 'USD') {
  if (typeof value !== 'number') return '—'
  try {
    return new Intl.NumberFormat('es-SV', { style: 'currency', currency }).format(value)
  } catch {
    return value.toFixed(2)
  }
}

/** Fecha local en formato AAAA-MM-DD. */
export function isoDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** "2026-11-20" → "20 nov 2026" */
export function shortDate(value: string) {
  const date = new Date(`${value}T00:00:00`)
  if (!value || Number.isNaN(date.getTime())) return value || '—'
  return date.toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "2026-11" → "nov" o "noviembre de 2026" */
export function monthLabel(month: string, long = false) {
  const date = new Date(`${month}-01T00:00:00`)
  if (Number.isNaN(date.getTime())) return month
  return long
    ? date.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' })
    : date.toLocaleDateString('es-SV', { month: 'short' }).replace('.', '')
}

/**
 * Consulta pública de Hacienda para comprobar que un DTE existe y es válido.
 * Es la misma dirección que lleva el código QR de la factura.
 */
export function haciendaUrl(ambiente: string, codigoGeneracion: string, fecha: string) {
  const params = new URLSearchParams({
    ambiente: ambiente || '01',
    codGen: codigoGeneracion,
    fechaEmi: fecha,
  })
  return `https://admin.factura.gob.sv/consultaPublica?${params}`
}

/** Monto abreviado para ejes de gráficos: 1250 → "$1.3 mil" */
export function moneyShort(value: number) {
  return new Intl.NumberFormat('es-SV', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}
