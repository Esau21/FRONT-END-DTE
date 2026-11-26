import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowsClockwiseIcon,
  ArrowLeftIcon,
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowSquareOutIcon,
  BracketsCurlyIcon,
  CloudIcon,
  DownloadSimpleIcon,
  FolderSimpleIcon,
  FolderSimplePlusIcon,
  FoldersIcon,
  EnvelopeSimpleIcon,
  FileIcon,
  FilePdfIcon,
  MagnifyingGlassIcon,
  MicrosoftExcelLogoIcon,
  ReceiptIcon,
  TrashIcon,
  WarningCircleIcon,
  CheckIcon,
  XIcon,
} from '@phosphor-icons/react'
import {
  createFolder,
  deleteFile,
  deleteFolder,
  errorText,
  exportUrl,
  getCloud,
  getSummary,
  isUnauthorized,
  listInvoices,
  moveFile,
  savedFileUrl,
  updateInvoice,
  updateInvoices,
} from './api'
import type { Cloud, Invoice, InvoiceFilter, InvoiceStatus, SavedFile, Summary, Totals } from './api'
import {
  TIPOS_CORTOS,
  haciendaUrl,
  isoDate,
  money,
  moneyShort,
  monthLabel,
  shortDate,
  tipoName,
} from './format'
import { FolderPicker } from './FolderPicker'
import { folderLabel, folderTrail, foldersOf, startsWith } from './folders'
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

/** Una fila con nombre, monto y una barra proporcional. */
function BarRow(props: { name: string; detail: string; value: number; max: number }) {
  const { name, detail, value, max } = props
  return (
    <li>
      <div className="ranking-row">
        <span title={name}>{name}</span>
        <strong>{money(value)}</strong>
      </div>
      <div className="ranking-track">
        <div className="ranking-bar" style={{ width: `${(Math.max(0, value) / max) * 100}%` }} />
      </div>
      <small>{detail}</small>
    </li>
  )
}

const facturas = (n: number) => `${n} ${n === 1 ? 'factura' : 'facturas'}`

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
  if (!summary) {
    return (
      <div className="card page-loading">
        <span className="spinner" />
      </div>
    )
  }

  const saved = Object.values(summary.byStatus).reduce((a, b) => a + b, 0)
  if (saved === 0) {
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

  const months = fillMonths(summary)
  const current = months[months.length - 1]
  const previous = months[months.length - 2]
  const max = Math.max(...months.map((m) => m.total), 1)
  const yearTotal = months.reduce((sum, m) => sum + m.total, 0)
  const yearIva = months.reduce((sum, m) => sum + m.iva, 0)
  const active = months.filter((m) => m.count > 0)
  const best = months.reduce((a, b) => (b.total > a.total ? b : a))

  // Cuánto cambió respecto al mes anterior
  const diff = current.total - previous.total
  const change =
    previous.total > 0 ? `${diff >= 0 ? '▲' : '▼'} ${Math.abs(Math.round((diff / previous.total) * 100))}%` : ''

  const statuses = STATUSES.map((status) => ({
    status,
    ...STATUS[status],
    count: summary.byStatus[status] ?? 0,
  }))

  const topIssuer = Math.max(...summary.issuers.map((i) => i.total), 1)
  const topType = Math.max(...summary.types.map((t) => t.total), 1)
  const named = summary.categoryTotals.filter((c) => c.name)
  const topCategory = Math.max(...named.map((c) => c.total), 1)

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <span>Compras de {monthLabel(current.month, true)}</span>
          <strong>{money(current.total)}</strong>
          <small>
            {change && <b className="tile-change">{change}</b>}
            {previous.total === 0
              ? `${facturas(current.count)} · sin compras el mes anterior`
              : `${facturas(current.count)} · frente a ${money(previous.total)} el mes anterior`}
          </small>
        </div>
        <div className="tile">
          <span>IVA del mes</span>
          <strong>{money(current.iva)}</strong>
          <small>{money(yearIva)} en los últimos 12 meses</small>
        </div>
        <button className="tile tile-link" onClick={onOpenInvoices}>
          <span>Por pagar</span>
          <strong>{money(summary.pending.total)}</strong>
          <small>{facturas(summary.pending.count)} sin marcar como pagadas</small>
        </button>
        <button className="tile tile-link" onClick={onOpenInvoices}>
          <span>Pendientes de revisar</span>
          <strong>{summary.byStatus.pendiente ?? 0}</strong>
          <small>de {facturas(saved)} guardadas</small>
        </button>
      </div>

      <div className="panels">
        <section className="card panel">
          <div className="panel-head">
            <div>
              <h2>Compras por mes</h2>
              <p className="panel-sub">Últimos 12 meses. Las notas de crédito restan.</p>
            </div>
            <dl className="panel-stats">
              <div>
                <dt>Total</dt>
                <dd>{money(yearTotal)}</dd>
              </div>
              <div>
                <dt>Promedio mensual</dt>
                <dd>{money(active.length ? yearTotal / active.length : 0)}</dd>
              </div>
              <div>
                <dt>Mes más alto</dt>
                <dd>{monthLabel(best.month, true)}</dd>
              </div>
            </dl>
          </div>

          <div className="chart-area">
            {/* Líneas de referencia: el máximo y la mitad */}
            <div className="chart-guides" aria-hidden="true">
              <span>{moneyShort(max)}</span>
              <span>{moneyShort(max / 2)}</span>
            </div>
            <div className="chart">
              {months.map((m) => (
                <div className="chart-col" key={m.month} tabIndex={0}>
                  <div className="chart-tip" role="tooltip">
                    <span>{monthLabel(m.month, true)}</span>
                    <strong>{money(m.total)}</strong>
                    <span>
                      {facturas(m.count)} · IVA {money(m.iva)}
                    </span>
                  </div>
                  <div className="chart-track">
                    <div
                      className="chart-bar"
                      style={{ height: `${(Math.max(0, m.total) / max) * 100}%` }}
                    />
                  </div>
                  <span className={m === current ? 'chart-label now' : 'chart-label'}>
                    {monthLabel(m.month)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="card panel">
          <h2>Estado de las facturas</h2>
          <p className="panel-sub">Todas las guardadas.</p>

          {/* Una sola barra repartida entre los tres estados */}
          <div className="status-bar" role="img" aria-label="Facturas por estado">
            {statuses
              .filter((item) => item.count > 0)
              .map((item) => (
                <div
                  key={item.status}
                  className={item.tone}
                  style={{ flexGrow: item.count }}
                  title={`${item.label}: ${item.count}`}
                />
              ))}
          </div>
          <ul className="status-list">
            {statuses.map((item) => (
              <li key={item.status}>
                <i className={item.tone} />
                <span>{item.label}</span>
                <strong>{item.count}</strong>
                <small>{Math.round((item.count / saved) * 100)}%</small>
              </li>
            ))}
          </ul>
          <button className="btn btn-light panel-action" onClick={onOpenInvoices}>
            Revisar facturas
            <ArrowRightIcon weight="bold" />
          </button>
        </section>
      </div>

      <div className="panels even">
        <section className="card panel">
          <div className="panel-head">
            <div>
              <h2>Últimas facturas</h2>
              <p className="panel-sub">Las más recientes por fecha de emisión.</p>
            </div>
            <button className="btn btn-light btn-sm" onClick={onOpenInvoices}>
              Ver todas
              <ArrowRightIcon weight="bold" />
            </button>
          </div>
          <ul className="recent-list">
            {summary.recent.map((invoice) => (
              <li key={invoice.id}>
                <div className="recent-main">
                  <strong title={invoice.emisorNombre}>{invoice.emisorNombre || 'Sin nombre'}</strong>
                  <small>
                    {shortDate(invoice.fecha)} · {TIPOS_CORTOS[invoice.tipoDte] ?? tipoName(invoice.tipoDte)}
                  </small>
                </div>
                <StatusBadge status={invoice.status} />
                <span className="recent-total">{money(signed(invoice, invoice.total), invoice.moneda)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card panel">
          <h2>A quién le compras más</h2>
          <p className="panel-sub">Últimos 12 meses.</p>
          <ol className="ranking">
            {summary.issuers.map((issuer) => (
              <BarRow
                key={issuer.nit || issuer.nombre}
                name={issuer.nombre || 'Sin nombre'}
                detail={facturas(issuer.count)}
                value={issuer.total}
                max={topIssuer}
              />
            ))}
          </ol>
        </section>
      </div>

      <div className="panels even">
        <section className="card panel">
          <h2>Por tipo de documento</h2>
          <p className="panel-sub">Últimos 12 meses.</p>
          <ol className="ranking">
            {summary.types.map((type) => (
              <BarRow
                key={type.name}
                name={tipoName(type.name)}
                detail={`${facturas(type.count)} · IVA ${money(type.iva)}`}
                value={type.total}
                max={topType}
              />
            ))}
          </ol>
        </section>

        <section className="card panel">
          <h2>Por categoría</h2>
          <p className="panel-sub">Últimos 12 meses.</p>
          {named.length > 0 ? (
            <ol className="ranking">
              {named.slice(0, 6).map((category) => (
                <BarRow
                  key={category.name}
                  name={category.name}
                  detail={facturas(category.count)}
                  value={category.total}
                  max={topCategory}
                />
              ))}
            </ol>
          ) : (
            <p className="panel-hint">
              Aún no has puesto categorías. Abre una factura y asígnale una (por ejemplo
              “Inventario” o “Servicios”) para ver aquí en qué se va el gasto.
            </p>
          )}
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

/** Tono estable por emisor, para distinguirlos de un vistazo. */
function toneOf(name: string) {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return ['lavender', 'sky', 'mint'][hash % 3]
}

function initialsOf(name: string) {
  const words = name.split(/[\s.,_-]+/).filter(Boolean)
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase()
}

/** Encabezado de columna que ordena la tabla al hacer clic. */
function SortHeader(props: {
  label: string
  /** Orden al primer clic y, si hay, el contrario al segundo. */
  orders: [string, string?]
  sort: string
  onSort: (sort: string) => void
  right?: boolean
}) {
  const { label, orders, sort, onSort, right } = props
  const active = orders.indexOf(sort)
  const next = active === 0 && orders[1] !== undefined ? orders[1] : orders[0]
  const descending = sort === '' || sort.endsWith('_desc')
  return (
    <th className={right ? 'right' : undefined} aria-sort={active < 0 ? 'none' : descending ? 'descending' : 'ascending'}>
      <button className={active >= 0 ? 'th-sort on' : 'th-sort'} onClick={() => onSort(next)}>
        {label}
        {active >= 0 && (descending ? <ArrowDownIcon weight="bold" /> : <ArrowUpIcon weight="bold" />)}
      </button>
    </th>
  )
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
  const [sort, setSort] = useState('')
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')

  // Busca sola al dejar de escribir
  useEffect(() => {
    const timer = setTimeout(() => setQ(draft.trim()), 400)
    return () => clearTimeout(timer)
  }, [draft])

  const range = period === 'custom' ? custom : periodRange(period)
  const filter: InvoiceFilter = { ...range, status, tipo, q, sort }
  // Los libros no dependen del orden de la tabla
  const exportFilter: InvoiceFilter = { ...range, status, tipo, q }

  return (
    <main className="page">
      <div className="page-actions">
        <SyncStatus sync={sync} />
        <a className="btn btn-light" href={exportUrl('compras', exportFilter)} download>
          <MicrosoftExcelLogoIcon />
          Libro de compras
        </a>
        <a className="btn btn-light" href={exportUrl('detalle', exportFilter)} download>
          <MicrosoftExcelLogoIcon />
          Detalle en Excel
        </a>
        <SyncButton sync={sync} />
      </div>

      <div className="toolbar card">
        <label className="toolbar-search">
          <MagnifyingGlassIcon />
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Buscar emisor, NIT, número de control o categoría…"
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
        onStatus={setStatus}
        onSort={setSort}
        onSessionLost={onSessionLost}
        onOpenMessage={onOpenMessage}
      />
    </main>
  )
}

interface TableState {
  status: 'loading' | 'ready' | 'more'
  items: Invoice[]
  totals: Totals
  byStatus: Record<string, number>
  error: string
}

function InvoiceTable(props: {
  filter: InvoiceFilter
  onStatus: (status: string) => void
  onSort: (sort: string) => void
  onSessionLost: () => void
  onOpenMessage: (messageId: string) => void
}) {
  const { filter, onStatus, onSort, onSessionLost, onOpenMessage } = props
  const [state, setState] = useState<TableState>({
    status: 'loading',
    items: [],
    totals: { count: 0, gravado: 0, iva: 0, total: 0 },
    byStatus: {},
    error: '',
  })
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [checked, setChecked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  // Cada vez que cambia, se vuelven a pedir las facturas ya cargadas
  const [reload, setReload] = useState(0)
  const [loaded, setLoaded] = useState(PAGE)

  function fail(err: unknown) {
    if (isUnauthorized(err)) return onSessionLost()
    setState((s) => ({ ...s, status: 'ready', error: errorText(err) }))
  }

  // `filter` no cambia mientras este componente vive: el padre lo vuelve a
  // montar (con otra `key`) cada vez que cambia.
  useEffect(() => {
    let alive = true
    listInvoices(filter, loaded, 0)
      .then((page) => {
        if (!alive) return
        setState({ status: 'ready', error: '', ...page })
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
  }, [reload])

  async function loadMore() {
    setState((s) => ({ ...s, status: 'more', error: '' }))
    try {
      const page = await listInvoices(filter, PAGE, state.items.length)
      setState((s) => ({ ...s, status: 'ready', items: [...s.items, ...page.items] }))
      setLoaded(state.items.length + page.items.length)
    } catch (err) {
      fail(err)
    }
  }

  /** Vuelve a pedir lo que ya está en pantalla, sin mostrar "cargando". */
  function refresh() {
    setLoaded(Math.max(PAGE, state.items.length))
    setReload((n) => n + 1)
  }

  async function markChecked(status: InvoiceStatus) {
    setBusy(true)
    try {
      await updateInvoices(checked, status)
      setChecked([])
      refresh()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  function toggle(id: number) {
    setChecked((ids) => (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]))
  }

  if (state.status === 'loading') {
    return (
      <div className="card page-loading">
        <span className="spinner" />
      </div>
    )
  }

  const { items, totals, byStatus } = state
  const selected = items.find((item) => item.id === selectedId) ?? null
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))].sort()
  const all = Object.values(byStatus).reduce((a, b) => a + b, 0)
  const allChecked = items.length > 0 && items.every((item) => checked.includes(item.id))
  const sort = filter.sort ?? ''

  const tab = (value: string, label: string, n: number) => (
    <button
      key={value}
      role="tab"
      aria-selected={(filter.status ?? '') === value}
      onClick={() => onStatus(value)}
    >
      {label}
      <span className="tab-count">{n}</span>
    </button>
  )

  return (
    <>
      <div className="tiles compact">
        <div className="tile">
          <span>Facturas</span>
          <strong>{totals.count}</strong>
        </div>
        <div className="tile">
          <span>Gravado</span>
          <strong>{money(totals.gravado)}</strong>
        </div>
        <div className="tile">
          <span>IVA</span>
          <strong>{money(totals.iva)}</strong>
        </div>
        <div className="tile">
          <span>Total</span>
          <strong>{money(totals.total)}</strong>
        </div>
      </div>

      {state.error && (
        <p className="alert danger">
          <WarningCircleIcon />
          {state.error}
        </p>
      )}

      <div className="card">
        <div className="table-head">
          <nav className="tabs inv-tabs" role="tablist" aria-label="Estado">
            {tab('', 'Todas', all)}
            {STATUSES.map((s) => tab(s, `${STATUS[s].label}s`, byStatus[s] ?? 0))}
          </nav>
          {items.length > 0 && (
            <span className="table-count">
              Mostrando {items.length} de {totals.count}
            </span>
          )}
        </div>

        {/* Acciones sobre las facturas marcadas */}
        {checked.length > 0 && (
          <div className="bulk">
            <strong>
              {checked.length} {checked.length === 1 ? 'seleccionada' : 'seleccionadas'}
            </strong>
            <span>Marcar como</span>
            {STATUSES.map((s) => (
              <button
                key={s}
                className="btn btn-light btn-sm"
                disabled={busy}
                onClick={() => markChecked(s)}
              >
                {STATUS[s].label}
              </button>
            ))}
            <button className="btn-icon" onClick={() => setChecked([])} aria-label="Quitar selección">
              <XIcon weight="bold" />
            </button>
          </div>
        )}

        {items.length === 0 && !state.error ? (
          <Empty icon={<ReceiptIcon />}>
            <p>No hay facturas con estos filtros. Prueba con otro periodo o trae las del correo.</p>
          </Empty>
        ) : (
          <div className={selected ? 'inv-layout has-selection' : 'inv-layout'}>
            <div className="inv-list">
              <div className="inv-table-wrap">
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th className="col-check">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          onChange={() => setChecked(allChecked ? [] : items.map((item) => item.id))}
                          aria-label="Seleccionar todas las que se ven"
                        />
                      </th>
                      <SortHeader label="Emisor" orders={['emisor_asc']} sort={sort} onSort={onSort} />
                      <SortHeader label="Fecha" orders={['', 'fecha_asc']} sort={sort} onSort={onSort} />
                      <th className="col-tipo">Tipo</th>
                      <th className="right col-iva">IVA</th>
                      <SortHeader
                        label="Total"
                        orders={['total_desc', 'total_asc']}
                        sort={sort}
                        onSort={onSort}
                        right
                      />
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const name = item.emisorNombre || 'Sin nombre'
                      return (
                        <tr
                          key={item.id}
                          className={item.id === selectedId ? 'active' : undefined}
                          onClick={() => setSelectedId(item.id)}
                        >
                          <td className="col-check" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={checked.includes(item.id)}
                              onChange={() => toggle(item.id)}
                              aria-label={`Seleccionar la factura de ${name}`}
                            />
                          </td>
                          <td>
                            <div className="inv-issuer">
                              <span
                                className={`symbol ${toneOf(name)}`}
                                style={{ '--s': '36px' } as React.CSSProperties}
                                aria-hidden="true"
                              >
                                {initialsOf(name)}
                              </span>
                              <div>
                                <button className="inv-name" onClick={() => setSelectedId(item.id)}>
                                  {name}
                                </button>
                                <span className="inv-sub">
                                  {item.emisorNit && `NIT ${item.emisorNit}`}
                                  {item.category && <b>{item.category}</b>}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="nowrap">{shortDate(item.fecha)}</td>
                          <td className="col-tipo">
                            <span className="badge muted">
                              {TIPOS_CORTOS[item.tipoDte] ?? tipoName(item.tipoDte)}
                            </span>
                          </td>
                          <td className="right col-iva">
                            {money(signed(item, item.iva), item.moneda)}
                          </td>
                          <td className="right strong">
                            {money(signed(item, item.total), item.moneda)}
                          </td>
                          <td>
                            <StatusBadge status={item.status} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {items.length < totals.count && (
                <button
                  className="btn btn-light more"
                  onClick={loadMore}
                  disabled={state.status === 'more'}
                >
                  {state.status === 'more'
                    ? 'Cargando…'
                    : `Cargar más (faltan ${totals.count - items.length})`}
                </button>
              )}
            </div>

            {selected && (
              <InvoicePanel
                key={selected.id}
                invoice={selected}
                categories={categories}
                onClose={() => setSelectedId(null)}
                onSaved={refresh}
                onFail={fail}
                onOpenMessage={onOpenMessage}
              />
            )}
          </div>
        )}
      </div>
    </>
  )
}

function InvoicePanel(props: {
  invoice: Invoice
  categories: string[]
  onClose: () => void
  onSaved: () => void
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
      await updateInvoice(invoice.id, patch)
      onSaved()
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

      {invoice.status !== 'pagada' && (
        <button className="btn btn-primary" disabled={saving} onClick={() => save({ status: 'pagada' })}>
          <CheckIcon weight="bold" />
          Marcar como pagada
        </button>
      )}

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

interface Folder {
  path: string[]
  /** Carpetas que hay directamente dentro. */
  folders: number
  /** Archivos que hay dentro, a cualquier profundidad. */
  files: number
  size: number
}

/**
 * Las carpetas que hay directamente dentro de `current`: las que tienen
 * archivos y las que el usuario creó a mano (`created`), aunque estén vacías.
 */
function subfolders(files: SavedFile[], created: string[][], current: string[]): Folder[] {
  const found = new Map<string, Folder & { children: Set<string> }>()
  const visit = (path: string[], size: number | null) => {
    if (path.length <= current.length || !startsWith(path, current)) return
    const name = path[current.length]
    const folder = found.get(name) ?? {
      path: [...current, name],
      folders: 0,
      files: 0,
      size: 0,
      children: new Set<string>(),
    }
    if (size !== null) {
      folder.files++
      folder.size += size
    }
    if (path.length > current.length + 1) folder.children.add(path[current.length + 1])
    found.set(name, folder)
  }
  files.forEach((file) => visit(foldersOf(file), file.size))
  created.forEach((path) => visit(path, null))

  const list = [...found.values()].map((folder) => ({ ...folder, folders: folder.children.size }))
  // Años y meses: lo más reciente primero. Las demás: por orden alfabético.
  const numeric = list.every((folder) => /^\d+$/.test(folder.path[folder.path.length - 1]))
  return list.sort((a, b) => {
    const [x, y] = [a.path[a.path.length - 1], b.path[b.path.length - 1]]
    return numeric ? y.localeCompare(x) : x.localeCompare(y, 'es')
  })
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

function FileGlyph({ name }: { name: string }) {
  if (/\.pdf$/i.test(name)) return <FilePdfIcon />
  if (/\.json$/i.test(name)) return <BracketsCurlyIcon />
  return <FileIcon />
}

/**
 * Los archivos guardados en el bucket, como un explorador de carpetas. Las
 * carpetas por año, mes y emisor las crea la app; el usuario puede crear las
 * suyas y mover archivos entre ellas.
 */
export function FilesView(props: {
  onSessionLost: () => void
  onOpenMessage: (messageId: string) => void
}) {
  const { onSessionLost, onOpenMessage } = props
  const [cloud, setCloud] = useState<Cloud | null>(null)
  const [error, setError] = useState('')
  const [current, setCurrent] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [confirming, setConfirming] = useState<number | null>(null)
  const [moving, setMoving] = useState<SavedFile | null>(null)
  const [newFolder, setNewFolder] = useState<string | null>(null)

  function fail(err: unknown) {
    if (isUnauthorized(err)) onSessionLost()
    else setError(errorText(err))
  }

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

  /** Ejecuta un cambio y vuelve a leer lo guardado. */
  async function change(action: () => Promise<unknown>) {
    setError('')
    try {
      await action()
      setCloud(await getCloud())
    } catch (err) {
      fail(err)
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

  const created = cloud.folders.map((folder) => folder.split('/'))
  const exists = (path: string[]) =>
    cloud.files.some((file) => startsWith(foldersOf(file), path)) ||
    created.some((folder) => startsWith(folder, path))

  // Si la carpeta abierta ya no existe, se sube hasta una que sí
  let here = current
  while (here.length > 0 && !exists(here)) here = here.slice(0, -1)

  const q = search.trim().toLowerCase()
  const searching = q !== ''
  const inside = cloud.files.filter((file) => startsWith(foldersOf(file), here))

  // Al buscar se muestran los archivos que coinciden, estén en la carpeta que estén
  const folders = searching ? [] : subfolders(cloud.files, created, here)
  const files = searching
    ? inside.filter((file) => `${file.path} ${file.mailSubject}`.toLowerCase().includes(q))
    : inside.filter((file) => foldersOf(file).length === here.length)

  const empty = !searching && folders.length === 0 && files.length === 0
  // Solo se pueden borrar las carpetas que creó el usuario
  const removable = empty && cloud.folders.includes(here.join('/'))

  function open(path: string[]) {
    setCurrent(path)
    setSearch('')
    setConfirming(null)
    setNewFolder(null)
  }

  function submitFolder(e: { preventDefault(): void }) {
    e.preventDefault()
    const name = (newFolder ?? '').trim()
    setNewFolder(null)
    if (name) change(() => createFolder([...here, name].join('/')))
  }

  return (
    <main className="page">
      {error && (
        <p className="alert danger">
          <WarningCircleIcon />
          {error}
        </p>
      )}

      <div className="crumb-bar">
        {/* Dónde estamos: bucket › carpeta › carpeta */}
        <nav className="crumb" aria-label="Ubicación">
          {here.length > 0 && (
            <button
              className="btn-icon"
              onClick={() => open(here.slice(0, -1))}
              aria-label="Subir una carpeta"
            >
              <ArrowLeftIcon weight="bold" />
            </button>
          )}
          <button className="crumb-item" onClick={() => open([])} disabled={here.length === 0}>
            <CloudIcon weight="fill" />
            {cloud.bucket}
          </button>
          {here.map((_, i) => {
            const path = here.slice(0, i + 1)
            return (
              <button
                className="crumb-item"
                key={path.join('/')}
                onClick={() => open(path)}
                disabled={i === here.length - 1}
              >
                {folderLabel(path)}
              </button>
            )
          })}
        </nav>

        <div className="crumb-tools">
          <label className="toolbar-search crumb-search">
            <MagnifyingGlassIcon />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={here.length ? 'Buscar en esta carpeta…' : 'Buscar archivo o emisor…'}
              aria-label="Buscar archivos"
            />
          </label>
          <button className="btn btn-primary" onClick={() => setNewFolder('')}>
            <FolderSimplePlusIcon weight="bold" />
            Nueva carpeta
          </button>
        </div>
      </div>

      {newFolder !== null && (
        <form className="card new-folder" onSubmit={submitFolder}>
          <FolderSimplePlusIcon />
          <input
            className="input"
            autoFocus
            value={newFolder}
            maxLength={80}
            placeholder={
              here.length
                ? `Nombre de la carpeta nueva dentro de “${folderLabel(here)}”`
                : 'Nombre de la carpeta nueva'
            }
            onChange={(e) => setNewFolder(e.target.value)}
            aria-label="Nombre de la carpeta nueva"
          />
          <button type="submit" className="btn btn-primary" disabled={!newFolder.trim()}>
            Crear
          </button>
          <button type="button" className="btn btn-light" onClick={() => setNewFolder(null)}>
            Cancelar
          </button>
        </form>
      )}

      <p className="sync-note">
        {searching
          ? count(files.length, 'archivo encontrado', 'archivos encontrados')
          : [
              folders.length > 0 && count(folders.length, 'carpeta', 'carpetas'),
              count(inside.length, 'archivo', 'archivos'),
              fileSize(inside.reduce((sum, file) => sum + file.size, 0)),
            ]
              .filter(Boolean)
              .join(' · ')}
      </p>

      {empty && (
        <div className="card">
          <Empty icon={here.length ? <FolderSimpleIcon /> : <CloudIcon />}>
            <p>
              {here.length
                ? 'Esta carpeta está vacía. Guarda aquí un archivo desde un correo, o mueve uno que ya tengas.'
                : 'Aún no has guardado archivos. Abre un correo y usa “Guardar en la nube” en el PDF o el JSON que quieras conservar.'}
            </p>
            {removable && (
              <button
                className="btn btn-light"
                onClick={() => change(() => deleteFolder(here.join('/')))}
              >
                <TrashIcon />
                Eliminar esta carpeta
              </button>
            )}
          </Empty>
        </div>
      )}

      {searching && files.length === 0 && (
        <div className="card">
          <Empty icon={<MagnifyingGlassIcon />}>
            <p>Ningún archivo coincide con “{search.trim()}”.</p>
          </Empty>
        </div>
      )}

      {folders.length > 0 && (
        <div className="boxes">
          {folders.map((folder) => (
            <button className="box" key={folder.path.join('/')} onClick={() => open(folder.path)}>
              <span className="box-icon">
                <FolderSimpleIcon weight="fill" />
              </span>
              <strong title={folderLabel(folder.path)}>{folderLabel(folder.path)}</strong>
              <span className="box-meta">
                {folder.files === 0 && folder.folders === 0
                  ? 'Vacía'
                  : [
                      folder.folders > 0 && count(folder.folders, 'carpeta', 'carpetas'),
                      count(folder.files, 'archivo', 'archivos'),
                      fileSize(folder.size),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
              </span>
            </button>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="boxes">
          {files.map((file) => (
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
              {searching && (
                <span className="box-where">{folderTrail(foldersOf(file)) || cloud.bucket}</span>
              )}
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
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setConfirming(null)
                      change(() => deleteFile(file.id))
                    }}
                  >
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
                    onClick={() => setMoving(file)}
                    title="Mover a otra carpeta"
                    aria-label={`Mover ${file.filename} a otra carpeta`}
                  >
                    <FoldersIcon />
                  </button>
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

      {moving && (
        <FolderPicker
          title={`Mover “${moving.filename}”`}
          confirm="Mover aquí"
          start={foldersOf(moving).join('/')}
          onPick={(folder) => {
            const file = moving
            setMoving(null)
            change(() => moveFile(file.id, folder ?? ''))
          }}
          onClose={() => setMoving(null)}
          onSessionLost={onSessionLost}
        />
      )}
    </main>
  )
}
