import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowsClockwiseIcon,
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  BracketsCurlyIcon,
  CloudIcon,
  DownloadSimpleIcon,
  FolderSimpleIcon,
  EnvelopeSimpleIcon,
  FileIcon,
  FilePdfIcon,
  MagnifyingGlassIcon,
  MicrosoftExcelLogoIcon,
  ReceiptIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react'
import {
  deleteFile,
  errorText,
  exportUrl,
  getCloud,
  getSummary,
  isUnauthorized,
  listInvoices,
  savedFileUrl,
  updateInvoice,
} from './api'
import type { Cloud, Invoice, InvoiceFilter, InvoiceStatus, SavedFile, Summary, Totals } from './api'
import {
  TIPOS_CORTOS,
  haciendaUrl,
  isoDate,
  money,
  monthLabel,
  shortDate,
  tipoName,
} from './format'
import type { Sync } from './useSync'
import './Invoices.css'

const PAGE = 50

const STATUS: Record<InvoiceStatus, { label: string; tone: string }> = {
  pendiente: { label: 'Pendiente', tone: 'peach' },
  revisada: { label: 'Revisada', tone: 'sky' },
  pagada: { label: 'Pagada', tone: 'mint' },
}
const STATUSES = Object.keys(STATUS) as InvoiceStatus[]

/** Las notas de crédito restan. */
const signed = (invoice: Invoice, amount: number) => (invoice.tipoDte === '05' ? -amount : amount)

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const info = STATUS[status] ?? STATUS.pendiente
  return <span className={`badge ${info.tone}`}>{info.label}</span>
}

function SyncButton({ sync }: { sync: Sync }) {
  return (
    <button className="btn btn-primary" onClick={() => sync.start()} disabled={sync.running}>
      <ArrowsClockwiseIcon weight="bold" className={sync.running ? 'spin' : undefined} />
      {sync.running ? 'Revisando correo…' : 'Traer facturas del correo'}
    </button>
  )
}

/** Una línea que cuenta qué pasó (o está pasando) con la sincronización. */
function SyncStatus({ sync }: { sync: Sync }) {
  if (sync.error) {
    return (
      <p className="alert danger sync-note">
        <WarningCircleIcon />
        {sync.error}
      </p>
    )
  }
  if (sync.running) {
    return (
      <p className="sync-note">
        Revisando tu correo: {sync.scanned} correos revisados, {sync.imported} facturas nuevas.
      </p>
    )
  }
  if (sync.version > 0 && sync.imported > 0) {
    return <p className="sync-note">Se agregaron {sync.imported} facturas nuevas.</p>
  }
  return null
}

function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="blank">
      <span className="blank-icon">{icon}</span>
      {children}
    </div>
  )
}

/* =====================================================================
   Resumen
   ===================================================================== */

/** Los 12 meses del resumen, también los que no tuvieron facturas. */
function fillMonths(summary: Summary) {
  const byMonth = new Map(summary.months.map((m) => [m.month, m]))
  const [year, month] = summary.since.split('-').map(Number)
  return Array.from({ length: 12 }, (_, i) => {
    const date = new Date(year, month - 1 + i, 1)
    const key = isoDate(date).slice(0, 7)
    return byMonth.get(key) ?? { month: key, count: 0, gravado: 0, iva: 0, total: 0 }
  })
}

export function Dashboard(props: {
  sync: Sync
  onSessionLost: () => void
  onOpenInvoices: () => void
}) {
  const { sync, onSessionLost, onOpenInvoices } = props
  return (
    <main className="page">
      <div className="page-actions">
        <SyncStatus sync={sync} />
        <SyncButton sync={sync} />
      </div>
      <DashboardData key={sync.version} onSessionLost={onSessionLost} onOpenInvoices={onOpenInvoices} />
    </main>
  )
}

function DashboardData(props: { onSessionLost: () => void; onOpenInvoices: () => void }) {
  const { onSessionLost, onOpenInvoices } = props
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    getSummary()
      .then((data) => alive && setSummary(data))
      .catch((err: unknown) => {
        if (!alive) return
        if (isUnauthorized(err)) onSessionLost()
        else setError(errorText(err))
      })
    return () => {
      alive = false
    }
  }, [onSessionLost])

  if (error) {
    return (
      <p className="alert danger">
        <WarningCircleIcon />
        {error}
      </p>
    )
  }
  if (!summary) return <div className="card page-loading"><span className="spinner" /></div>

  const months = fillMonths(summary)
  const current = months[months.length - 1]
  const previous = months[months.length - 2]
  const max = Math.max(...months.map((m) => m.total), 1)
  const topIssuer = Math.max(...summary.issuers.map((i) => i.total), 1)
  const total = Object.values(summary.byStatus).reduce((a, b) => a + b, 0)

  if (total === 0) {
    return (
      <div className="card">
        <Empty icon={<ReceiptIcon />}>
          <p>
            Aún no hay facturas guardadas. Usa “Traer facturas del correo” para buscarlas en tu
            buzón.
          </p>
        </Empty>
      </div>
    )
  }

  const diff = current.total - previous.total

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <span>Compras de {monthLabel(current.month, true)}</span>
          <strong>{money(current.total)}</strong>
          <small>
            {previous.total === 0
              ? 'Sin compras el mes anterior'
              : `${money(Math.abs(diff))} ${diff >= 0 ? 'más' : 'menos'} que el mes anterior`}
          </small>
        </div>
        <div className="tile">
          <span>IVA del mes</span>
          <strong>{money(current.iva)}</strong>
          <small>Crédito fiscal de las facturas recibidas</small>
        </div>
        <div className="tile">
          <span>Facturas del mes</span>
          <strong>{current.count}</strong>
          <small>{total} guardadas en total</small>
        </div>
        <button className="tile tile-link" onClick={onOpenInvoices}>
          <span>Pendientes de revisar</span>
          <strong>{summary.byStatus.pendiente ?? 0}</strong>
          <small>
            {summary.byStatus.revisada ?? 0} revisadas · {summary.byStatus.pagada ?? 0} pagadas
          </small>
        </button>
      </div>

      <div className="panels">
        <section className="card panel">
          <h2>Compras por mes</h2>
          <p className="panel-sub">Últimos 12 meses. Las notas de crédito restan.</p>
          <div className="chart">
            {months.map((m) => {
              const height = Math.max(0, m.total) / max
              return (
                <div className="chart-col" key={m.month} tabIndex={0}>
                  <div className="chart-tip" role="tooltip">
                    <span>{monthLabel(m.month, true)}</span>
                    <strong>{money(m.total)}</strong>
                    <span>
                      {m.count} {m.count === 1 ? 'factura' : 'facturas'} · IVA {money(m.iva)}
                    </span>
                  </div>
                  <div className="chart-track">
                    <div className="chart-bar" style={{ height: `${height * 100}%` }} />
                  </div>
                  <span className={m === current ? 'chart-label now' : 'chart-label'}>
                    {monthLabel(m.month)}
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        <section className="card panel">
          <h2>A quién le compras más</h2>
          <p className="panel-sub">Últimos 12 meses.</p>
          <ol className="ranking">
            {summary.issuers.map((issuer) => (
              <li key={issuer.nit || issuer.nombre}>
                <div className="ranking-row">
                  <span title={issuer.nombre}>{issuer.nombre || 'Sin nombre'}</span>
                  <strong>{money(issuer.total)}</strong>
                </div>
                <div className="ranking-track">
                  <div
                    className="ranking-bar"
                    style={{ width: `${(Math.max(0, issuer.total) / topIssuer) * 100}%` }}
                  />
                </div>
                <small>
                  {issuer.count} {issuer.count === 1 ? 'factura' : 'facturas'}
                </small>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  )
}

/* =====================================================================
   Facturas
   ===================================================================== */

type Period = 'mes' | 'anterior' | 'anio' | 'todo' | 'custom'

const PERIODS: Record<Period, string> = {
  mes: 'Este mes',
  anterior: 'Mes anterior',
  anio: 'Este año',
  todo: 'Todas las fechas',
  custom: 'Elegir fechas',
}

function periodRange(period: Period): { from: string; to: string } {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  switch (period) {
    case 'mes':
      return { from: isoDate(new Date(year, month, 1)), to: isoDate(new Date(year, month + 1, 0)) }
    case 'anterior':
      return { from: isoDate(new Date(year, month - 1, 1)), to: isoDate(new Date(year, month, 0)) }
    case 'anio':
      return { from: `${year}-01-01`, to: `${year}-12-31` }
    default:
      return { from: '', to: '' }
  }
}

export function InvoicesView(props: {
  sync: Sync
  onSessionLost: () => void
  onOpenMessage: (messageId: string) => void
}) {
  const { sync, onSessionLost, onOpenMessage } = props
  const [period, setPeriod] = useState<Period>('mes')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [status, setStatus] = useState('')
  const [tipo, setTipo] = useState('')
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')

  // Busca sola al dejar de escribir
  useEffect(() => {
    const timer = setTimeout(() => setQ(draft.trim()), 400)
    return () => clearTimeout(timer)
  }, [draft])

  const range = period === 'custom' ? custom : periodRange(period)
  const filter: InvoiceFilter = { ...range, status, tipo, q }

  return (
    <main className="page">
      <div className="page-actions">
        <SyncStatus sync={sync} />
        <a className="btn btn-light" href={exportUrl('compras', filter)} download>
          <MicrosoftExcelLogoIcon />
          Libro de compras
        </a>
        <a className="btn btn-light" href={exportUrl('detalle', filter)} download>
          <MicrosoftExcelLogoIcon />
          Detalle en Excel
        </a>
        <SyncButton sync={sync} />
      </div>

      <div className="card">
        <div className="toolbar">
          <label className="toolbar-search">
            <MagnifyingGlassIcon />
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Buscar emisor, NIT o categoría…"
              aria-label="Buscar facturas"
            />
          </label>
          <select
            className="input"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            aria-label="Periodo"
          >
            {(Object.keys(PERIODS) as Period[]).map((p) => (
              <option key={p} value={p}>
                {PERIODS[p]}
              </option>
            ))}
          </select>
          {period === 'custom' && (
            <>
              <input
                type="date"
                className="input"
                value={custom.from}
                max={custom.to || undefined}
                onChange={(e) => setCustom({ ...custom, from: e.target.value })}
                aria-label="Desde"
              />
              <input
                type="date"
                className="input"
                value={custom.to}
                min={custom.from || undefined}
                onChange={(e) => setCustom({ ...custom, to: e.target.value })}
                aria-label="Hasta"
              />
            </>
          )}
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Estado"
          >
            <option value="">Todos los estados</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS[s].label}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            aria-label="Tipo de documento"
          >
            <option value="">Todos los tipos</option>
            {Object.keys(TIPOS_CORTOS).map((code) => (
              <option key={code} value={code}>
                {TIPOS_CORTOS[code]}
              </option>
            ))}
          </select>
        </div>

        <InvoiceTable
          key={JSON.stringify(filter) + sync.version}
          filter={filter}
          onSessionLost={onSessionLost}
          onOpenMessage={onOpenMessage}
        />
      </div>
    </main>
  )
}

interface TableState {
  status: 'loading' | 'ready' | 'more'
  items: Invoice[]
  totals: Totals
  error: string
}

function InvoiceTable(props: {
  filter: InvoiceFilter
  onSessionLost: () => void
  onOpenMessage: (messageId: string) => void
}) {
  const { filter, onSessionLost, onOpenMessage } = props
  const [state, setState] = useState<TableState>({
    status: 'loading',
    items: [],
    totals: { count: 0, gravado: 0, iva: 0, total: 0 },
    error: '',
  })
  const [selectedId, setSelectedId] = useState<number | null>(null)

  function fail(err: unknown) {
    if (isUnauthorized(err)) return onSessionLost()
    setState((s) => ({ ...s, status: 'ready', error: errorText(err) }))
  }

  // `filter` no cambia mientras este componente vive: el padre lo vuelve a
  // montar (con otra `key`) cada vez que cambia.
  useEffect(() => {
    let alive = true
    listInvoices(filter, PAGE, 0)
      .then((page) => {
        if (alive) setState({ status: 'ready', items: page.items, totals: page.totals, error: '' })
      })
      .catch((err: unknown) => {
        if (!alive) return
        if (isUnauthorized(err)) onSessionLost()
        else setState((s) => ({ ...s, status: 'ready', error: errorText(err) }))
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadMore() {
    setState((s) => ({ ...s, status: 'more', error: '' }))
    try {
      const page = await listInvoices(filter, PAGE, state.items.length)
      setState((s) => ({ ...s, status: 'ready', items: [...s.items, ...page.items] }))
    } catch (err) {
      fail(err)
    }
  }

  function replace(updated: Invoice) {
    setState((s) => ({
      ...s,
      items: s.items.map((item) => (item.id === updated.id ? updated : item)),
    }))
  }

  if (state.status === 'loading') {
    return <div className="page-loading"><span className="spinner" /></div>
  }

  const { items, totals } = state
  const selected = items.find((item) => item.id === selectedId) ?? null
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))].sort()

  return (
    <>
      {state.error && (
        <p className="alert danger">
          <WarningCircleIcon />
          {state.error}
        </p>
      )}

      {items.length === 0 && !state.error ? (
        <Empty icon={<ReceiptIcon />}>
          <p>No hay facturas con estos filtros. Prueba con otro periodo o trae las del correo.</p>
        </Empty>
      ) : (
        <div className={selected ? 'inv-layout has-selection' : 'inv-layout'}>
          <div className="inv-list">
            <dl className="inv-totals">
              <div>
                <dt>Facturas</dt>
                <dd>{totals.count}</dd>
              </div>
              <div>
                <dt>Gravado</dt>
                <dd>{money(totals.gravado)}</dd>
              </div>
              <div>
                <dt>IVA</dt>
                <dd>{money(totals.iva)}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>{money(totals.total)}</dd>
              </div>
            </dl>

            <div className="inv-table-wrap">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Emisor</th>
                    <th className="col-tipo">Tipo</th>
                    <th className="right col-iva">IVA</th>
                    <th className="right">Total</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className={item.id === selectedId ? 'active' : undefined}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <td className="nowrap">{shortDate(item.fecha)}</td>
                      <td>
                        <button className="inv-name" onClick={() => setSelectedId(item.id)}>
                          {item.emisorNombre || 'Sin nombre'}
                        </button>
                        {item.category && <span className="inv-category">{item.category}</span>}
                      </td>
                      <td className="col-tipo">{TIPOS_CORTOS[item.tipoDte] ?? tipoName(item.tipoDte)}</td>
                      <td className="right col-iva">{money(signed(item, item.iva), item.moneda)}</td>
                      <td className="right strong">{money(signed(item, item.total), item.moneda)}</td>
                      <td>
                        <StatusBadge status={item.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {items.length < totals.count && (
              <button
                className="btn btn-light more"
                onClick={loadMore}
                disabled={state.status === 'more'}
              >
                {state.status === 'more' ? 'Cargando…' : `Cargar más (${totals.count - items.length})`}
              </button>
            )}
          </div>

          {selected && (
            <InvoicePanel
              key={selected.id}
              invoice={selected}
              categories={categories}
              onClose={() => setSelectedId(null)}
              onSaved={replace}
              onFail={fail}
              onOpenMessage={onOpenMessage}
            />
          )}
        </div>
      )}
    </>
  )
}

function InvoicePanel(props: {
  invoice: Invoice
  categories: string[]
  onClose: () => void
  onSaved: (invoice: Invoice) => void
  onFail: (err: unknown) => void
  onOpenMessage: (messageId: string) => void
}) {
  const { invoice, categories, onClose, onSaved, onFail, onOpenMessage } = props
  const [category, setCategory] = useState(invoice.category)
  const [notes, setNotes] = useState(invoice.notes)
  const [saving, setSaving] = useState(false)

  async function save(patch: Partial<Pick<Invoice, 'status' | 'category' | 'notes'>>) {
    setSaving(true)
    try {
      onSaved(await updateInvoice(invoice.id, patch))
    } catch (err) {
      onFail(err)
    } finally {
      setSaving(false)
    }
  }

  const amounts: [string, number][] = [
    ['Gravado', invoice.gravado],
    ['Exento', invoice.exento],
    ['No sujeto', invoice.noSujeto],
    ['IVA', invoice.iva],
    ['IVA percibido', invoice.ivaPercibido],
    ['IVA retenido', invoice.ivaRetenido],
  ]

  return (
    <aside className="inv-panel">
      <div className="inv-panel-head">
        <div>
          <span className="inv-kicker">{tipoName(invoice.tipoDte)}</span>
          <h2>{invoice.emisorNombre || 'Sin nombre'}</h2>
          <span className="inv-kicker">{shortDate(invoice.fecha)}</span>
        </div>
        <button className="btn-icon" onClick={onClose} aria-label="Cerrar">
          <XIcon weight="bold" />
        </button>
      </div>

      <div className="inv-total">
        <span>Total</span>
        <strong>{money(signed(invoice, invoice.total), invoice.moneda)}</strong>
      </div>

      <div className="inv-field">
        <span className="inv-label">Estado</span>
        <div className="segmented">
          {STATUSES.map((s) => (
            <button
              key={s}
              className={invoice.status === s ? 'on' : ''}
              disabled={saving}
              onClick={() => invoice.status !== s && save({ status: s })}
            >
              {STATUS[s].label}
            </button>
          ))}
        </div>
      </div>

      <label className="inv-field">
        <span className="inv-label">Categoría</span>
        <input
          className="input"
          list="inv-categories"
          value={category}
          maxLength={60}
          placeholder="Por ejemplo: Inventario, Servicios, Alquiler"
          onChange={(e) => setCategory(e.target.value)}
          onBlur={() => category.trim() !== invoice.category && save({ category: category.trim() })}
        />
        <datalist id="inv-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>

      <label className="inv-field">
        <span className="inv-label">Notas</span>
        <textarea
          className="input"
          rows={3}
          value={notes}
          maxLength={2000}
          placeholder="Algo que quieras recordar de esta factura"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== invoice.notes && save({ notes })}
        />
      </label>
      <p className="inv-saving" aria-live="polite">
        {saving ? 'Guardando…' : 'Los cambios se guardan solos.'}
      </p>

      <dl className="inv-amounts">
        {amounts
          .filter(([, value]) => value !== 0)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{money(signed(invoice, value), invoice.moneda)}</dd>
            </div>
          ))}
      </dl>

      <dl className="inv-ids">
        <div>
          <dt>NIT del emisor</dt>
          <dd>{invoice.emisorNit || '—'}</dd>
        </div>
        <div>
          <dt>NRC del emisor</dt>
          <dd>{invoice.emisorNrc || '—'}</dd>
        </div>
        <div>
          <dt>Número de control</dt>
          <dd>{invoice.numeroControl || '—'}</dd>
        </div>
        <div>
          <dt>Código de generación</dt>
          <dd>{invoice.codigoGeneracion}</dd>
        </div>
      </dl>

      <div className="inv-actions">
        <a
          className="btn btn-light"
          href={haciendaUrl(invoice.ambiente, invoice.codigoGeneracion, invoice.fecha)}
          target="_blank"
          rel="noreferrer"
        >
          <ArrowSquareOutIcon />
          Verificar en Hacienda
        </a>
        {invoice.messageId && (
          <button className="btn btn-light" onClick={() => onOpenMessage(invoice.messageId)}>
            <EnvelopeSimpleIcon />
            Ver correo y PDF
          </button>
        )}
      </div>
    </aside>
  )
}

/* =====================================================================
   Archivos en la nube
   ===================================================================== */

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Carpeta de un archivo dentro del bucket, sin la cuenta ni el nombre:
 * "ana@x.com/2026/11/Emisor/a.pdf" → ["2026", "noviembre", "Emisor"]
 */
function folderOf(file: SavedFile): string[] {
  const parts = file.path.split('/').slice(1, -1)
  if (parts.length === 0) return ['Sin carpeta']
  if (parts[0] === 'sin-clasificar') return ['Sin clasificar']
  const [year, month, ...rest] = parts
  return [year, monthLabel(`${year}-${month}`, true).replace(/ de \d+$/, ''), ...rest]
}

interface Folder {
  key: string
  /** ["2026", "noviembre", "Emisor"] */
  path: string[]
  files: SavedFile[]
  size: number
}

/** Agrupa los archivos por carpeta, respetando el orden en que llegan. */
function byFolder(files: SavedFile[]): Folder[] {
  const folders = new Map<string, Folder>()
  for (const file of files) {
    const path = folderOf(file)
    const key = path.join('/')
    const folder = folders.get(key) ?? { key, path, files: [], size: 0 }
    folder.files.push(file)
    folder.size += file.size
    folders.set(key, folder)
  }
  return [...folders.values()]
}

function FileGlyph({ name }: { name: string }) {
  if (/\.pdf$/i.test(name)) return <FilePdfIcon />
  if (/\.json$/i.test(name)) return <BracketsCurlyIcon />
  return <FileIcon />
}

/** Los archivos guardados en el bucket: primero las carpetas, luego su contenido. */
export function FilesView(props: {
  onSessionLost: () => void
  onOpenMessage: (messageId: string) => void
}) {
  const { onSessionLost, onOpenMessage } = props
  const [cloud, setCloud] = useState<Cloud | null>(null)
  const [error, setError] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<number | null>(null)

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

  async function remove(id: number) {
    try {
      await deleteFile(id)
      setCloud((data) => data && { ...data, files: data.files.filter((file) => file.id !== id) })
    } catch (err) {
      if (isUnauthorized(err)) onSessionLost()
      else setError(errorText(err))
    } finally {
      setConfirming(null)
    }
  }

  if (!cloud) {
    return (
      <main className="page">
        {error ? (
          <p className="alert danger">
            <WarningCircleIcon />
            {error}
          </p>
        ) : (
          <div className="page-loading">
            <span className="spinner" />
          </div>
        )}
      </main>
    )
  }

  const folders = byFolder(cloud.files)
  // Si se borra el último archivo de la carpeta abierta, se vuelve a la lista
  const open = folders.find((folder) => folder.key === openKey) ?? null

  return (
    <main className="page">
      {error && (
        <p className="alert danger">
          <WarningCircleIcon />
          {error}
        </p>
      )}

      {/* Dónde estamos: bucket › carpeta */}
      <nav className="crumb" aria-label="Ubicación">
        {open && (
          <button className="btn-icon" onClick={() => setOpenKey(null)} aria-label="Volver a las carpetas">
            <ArrowLeftIcon weight="bold" />
          </button>
        )}
        <button className="crumb-item" onClick={() => setOpenKey(null)} disabled={!open}>
          <CloudIcon weight="fill" />
          {cloud.bucket || 'Archivos guardados'}
        </button>
        {open?.path.map((name, i) => (
          <span className="crumb-item" key={i}>
            {name}
          </span>
        ))}
        <span className="crumb-count">
          {open
            ? `${open.files.length} ${open.files.length === 1 ? 'archivo' : 'archivos'} · ${fileSize(open.size)}`
            : `${folders.length} ${folders.length === 1 ? 'carpeta' : 'carpetas'} · ${cloud.files.length} ${cloud.files.length === 1 ? 'archivo' : 'archivos'}`}
        </span>
      </nav>

      {folders.length === 0 && (
        <div className="card">
          <Empty icon={<CloudIcon />}>
            <p>
              Aún no has guardado archivos. Abre un correo y usa “Guardar en la nube” en el PDF o
              el JSON que quieras conservar.
            </p>
          </Empty>
        </div>
      )}

      {/* Carpetas: una cajita por emisor y mes */}
      {!open && folders.length > 0 && (
        <div className="boxes">
          {folders.map((folder) => {
            const name = folder.path[folder.path.length - 1]
            const where = folder.path.slice(0, -1).reverse().join(' ')
            return (
              <button className="box" key={folder.key} onClick={() => setOpenKey(folder.key)}>
                <span className="box-icon">
                  <FolderSimpleIcon weight="fill" />
                </span>
                <strong title={name}>{name}</strong>
                {where && <span className="box-where">{where}</span>}
                <span className="box-meta">
                  {folder.files.length} {folder.files.length === 1 ? 'archivo' : 'archivos'} ·{' '}
                  {fileSize(folder.size)}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Contenido de la carpeta abierta: una cajita por archivo */}
      {open && (
        <div className="boxes">
          {open.files.map((file) => (
            <div className="box file-box" key={file.id}>
              <a
                className="box-open"
                href={savedFileUrl(file.id)}
                target="_blank"
                rel="noreferrer"
                title={`Abrir ${file.filename}`}
              >
                <span className={/\.pdf$/i.test(file.filename) ? 'box-icon pdf' : 'box-icon doc'}>
                  <FileGlyph name={file.filename} />
                </span>
                <strong>{file.filename}</strong>
              </a>
              <span className="box-meta">
                {fileSize(file.size)} · guardado el{' '}
                {new Date(file.createdAt).toLocaleDateString('es-SV', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>

              {confirming === file.id ? (
                <div className="box-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => remove(file.id)}>
                    Eliminar
                  </button>
                  <button className="btn btn-light btn-sm" onClick={() => setConfirming(null)}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="box-actions">
                  <a
                    className="btn-icon"
                    href={savedFileUrl(file.id, true)}
                    download={file.filename}
                    title="Descargar"
                    aria-label={`Descargar ${file.filename}`}
                  >
                    <DownloadSimpleIcon />
                  </a>
                  <button
                    className="btn-icon"
                    onClick={() => onOpenMessage(file.messageId)}
                    title="Ver el correo"
                    aria-label={`Ver el correo de ${file.filename}`}
                  >
                    <EnvelopeSimpleIcon />
                  </button>
                  <button
                    className="btn-icon"
                    onClick={() => setConfirming(file.id)}
                    title="Eliminar de la nube"
                    aria-label={`Eliminar ${file.filename}`}
                  >
                    <TrashIcon />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
