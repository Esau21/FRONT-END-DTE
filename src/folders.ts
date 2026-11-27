// Utilidades para tratar las rutas del bucket como carpetas.
import type { Cloud, SavedFile } from './api'
import { monthLabel } from './format'

/**
 * Carpetas de un archivo dentro del bucket, sin la cuenta ni el nombre:
 * "ana@x.com/2026/11/Emisor/a.pdf" → ["2026", "11", "Emisor"]
 */
export function foldersOf(file: SavedFile): string[] {
  return file.path.split('/').slice(1, -1)
}

/** Nombre que se muestra para una carpeta, según su lugar en la ruta. */
export function folderLabel(path: string[]): string {
  const name = path[path.length - 1]
  if (name === 'sin-clasificar') return 'Sin clasificar'
  // La carpeta que sigue al año es el mes: "11" → "Noviembre"
  if (path.length === 2 && /^\d{4}$/.test(path[0]) && /^\d{2}$/.test(name)) {
    const month = monthLabel(`${path[0]}-${name}`, true).replace(/ de \d+$/, '')
    return month.charAt(0).toUpperCase() + month.slice(1)
  }
  return name
}

/** "2026 › Noviembre › Emisor" */
export function folderTrail(path: string[]): string {
  return path.map((_, i) => folderLabel(path.slice(0, i + 1))).join(' › ')
}

export const startsWith = (path: string[], prefix: string[]) =>
  prefix.every((name, i) => path[i] === name)

/**
 * Todas las carpetas que existen, incluidas las intermedias: las que tienen
 * archivos y las que el usuario creó a mano aunque estén vacías.
 */
export function allFolders(cloud: Cloud): string[][] {
  const seen = new Map<string, string[]>()
  const add = (path: string[]) => {
    for (let depth = 1; depth <= path.length; depth++) {
      const parent = path.slice(0, depth)
      seen.set(parent.join('/'), parent)
    }
  }
  cloud.files.forEach((file) => add(foldersOf(file)))
  cloud.folders.forEach((folder) => add(folder.split('/')))
  return [...seen.values()].sort((a, b) => a.join('/').localeCompare(b.join('/'), 'es'))
}
