import { useEffect, useState } from 'react'
import { FolderSimpleIcon, MagicWandIcon, XIcon } from '@phosphor-icons/react'
import { errorText, getCloud, isUnauthorized } from './api'
import type { Cloud } from './api'
import { allFolders, folderLabel } from './folders'

const AUTO = '\u0000auto'

/**
 * Ventana para elegir en qué carpeta guardar (o a cuál mover) un archivo.
 * Permite también crear una carpeta nueva dentro de la elegida.
 *
 * `onPick` recibe la ruta de la carpeta ("" es la raíz), o `undefined` si el
 * usuario prefiere que la app ordene el archivo sola.
 */
export function FolderPicker(props: {
  title: string
  confirm: string
  /** Ofrece la opción de ordenar automáticamente por año, mes y emisor. */
  allowAuto?: boolean
  /** Carpeta que aparece elegida al abrir. */
  start?: string
  onPick: (folder: string | undefined) => void
  onClose: () => void
  onSessionLost: () => void
}) {
  const { title, confirm, allowAuto, start, onPick, onClose, onSessionLost } = props
  const [cloud, setCloud] = useState<Cloud | null>(null)
  const [error, setError] = useState('')
  const [choice, setChoice] = useState(start ?? (allowAuto ? AUTO : ''))
  const [newName, setNewName] = useState('')

  useEffect(() => {
    let alive = true
    getCloud()
      .then((data) => alive && setCloud(data))
      .catch((err: unknown) => {
        if (!alive) return
        if (isUnauthorized(err)) onSessionLost()
        else setError(errorText(err))
      })
    return () => {
      alive = false
    }
  }, [onSessionLost])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function submit(e: { preventDefault(): void }) {
    e.preventDefault()
    if (choice === AUTO) return onPick(undefined)
    onPick([choice, newName.trim()].filter(Boolean).join('/'))
  }

  const option = (value: string, depth: number, icon: React.ReactNode, label: React.ReactNode) => (
    <label
      key={value}
      className={choice === value ? 'pick on' : 'pick'}
      style={{ paddingLeft: 14 + depth * 20 }}
    >
      <input
        type="radio"
        name="folder"
        checked={choice === value}
        onChange={() => setChoice(value)}
      />
      {icon}
      <span>{label}</span>
    </label>
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Cerrar">
            <XIcon weight="bold" />
          </button>
        </header>

        <div className="modal-body">
          {error && <p className="alert danger">{error}</p>}
          {!cloud && !error && (
            <div className="page-loading">
              <span className="spinner" />
            </div>
          )}
          {cloud && (
            <>
              {allowAuto &&
                option(
                  AUTO,
                  0,
                  <MagicWandIcon />,
                  <>
                    <strong>Ordenar automáticamente</strong>
                    <small>En la carpeta del año, el mes y el emisor de la factura</small>
                  </>,
                )}
              {option(
                '',
                0,
                <FolderSimpleIcon weight="fill" />,
                <>
                  <strong>{cloud.bucket}</strong>
                  <small>Carpeta principal</small>
                </>,
              )}
              {allFolders(cloud).map((path) =>
                option(
                  path.join('/'),
                  path.length,
                  <FolderSimpleIcon weight="fill" />,
                  folderLabel(path),
                ),
              )}
            </>
          )}
        </div>

        {choice !== AUTO && (
          <label className="modal-new">
            Crear una carpeta nueva dentro de la elegida (opcional)
            <input
              className="input"
              value={newName}
              maxLength={80}
              placeholder="Nombre de la carpeta nueva"
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
        )}

        <footer className="modal-foot">
          <button type="button" className="btn btn-light" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={!cloud}>
            {confirm}
          </button>
        </footer>
      </form>
    </div>
  )
}
