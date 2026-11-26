import { useCallback, useRef, useState } from 'react'
import { errorText, isUnauthorized, syncInvoices } from './api'

export interface Sync {
  running: boolean
  /** Correos revisados en la sincronización en curso (o en la última). */
  scanned: number
  /** Facturas nuevas guardadas en la sincronización en curso (o en la última). */
  imported: number
  error: string
  /** Aumenta cada vez que termina una sincronización: sirve para recargar datos. */
  version: number
  start: (full?: boolean) => void
}

/**
 * Trae las facturas nuevas del correo a la base de datos. El backend revisa
 * una página de correos por llamada; aquí se repite hasta terminar.
 */
export function useSync(onSessionLost: () => void): Sync {
  const [state, setState] = useState({
    running: false,
    scanned: 0,
    imported: 0,
    error: '',
    version: 0,
  })
  const busy = useRef(false)

  const start = useCallback(
    async (full = false) => {
      if (busy.current) return
      busy.current = true
      setState((s) => ({ ...s, running: true, scanned: 0, imported: 0, error: '' }))

      let error = ''
      try {
        let token = ''
        // Tope de seguridad: 500 páginas son 10 000 correos
        for (let page = 0; page < 500; page++) {
          const result = await syncInvoices(token, full)
          setState((s) => ({
            ...s,
            scanned: s.scanned + result.scanned,
            imported: s.imported + result.imported,
          }))
          if (result.done || !result.nextPageToken) break
          token = result.nextPageToken
        }
      } catch (err) {
        if (isUnauthorized(err)) onSessionLost()
        else error = errorText(err)
      } finally {
        busy.current = false
        setState((s) => ({ ...s, running: false, error, version: s.version + 1 }))
      }
    },
    [onSessionLost],
  )

  return { ...state, start }
}
