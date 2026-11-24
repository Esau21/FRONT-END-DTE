import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  BracketsCurlyIcon,
  BuildingsIcon,
  CalendarBlankIcon,
  ClockCounterClockwiseIcon,
  DownloadSimpleIcon,
  EnvelopeSimpleIcon,
  FileIcon,
  FilePdfIcon,
  FunnelIcon,
  FileTextIcon,
  ListIcon,
  MagnifyingGlassIcon,
  ReceiptIcon,
  SealCheckIcon,
  ShieldCheckIcon,
  SignOutIcon,
  TrayIcon,
  UserCircleIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react'
import {
  LOGIN_URL,
  attachmentUrl,
  errorText,
  getDte,
  getMe,
  getMessage,
  isUnauthorized,
  listMessages,
  logout,
} from './api'
import type { Attachment, Dte, Json, Me, MessageDetail, MessageSummary } from './api'
import './App.css'

const PAGE_SIZE = 15
const DTE_FILTER = 'filename:json'

const TIPOS_DTE: Record<string, string> = {
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

/* ---------- helpers ---------- */

function senderName(from: string) {
  const name = from.replace(/<[^>]*>/, '').replace(/"/g, '').trim()
  return name || from
}

function senderEmail(from: string) {
  return /<([^>]+)>/.exec(from)?.[1] ?? from
}

function initials(name: string) {
  const words = name.split(/[\s.@_-]+/).filter(Boolean)
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase()
}

const TONES = ['primary', 'success', 'info', 'warning', 'danger'] as const

/** Tono estable por remitente, para distinguirlos de un vistazo. */
function tone(value: string) {
  let hash = 0
  for (const ch of value) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return TONES[hash % TONES.length]
}

function formatDate(value: string, long = false) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return value
  if (long) return date.toLocaleString('es-SV', { dateStyle: 'long', timeStyle: 'short' })
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('es-SV', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
}

function money(value: unknown, currency = 'USD') {
  if (typeof value !== 'number') return '—'
  try {
    return new Intl.NumberFormat('es-SV', { style: 'currency', currency }).format(value)
  } catch {
    return value.toFixed(2)
  }
}

function text(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number') return String(value)
  return '—'
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const isPdf = (file: Attachment) => /\.pdf$/i.test(file.filename)
const isJson = (file: Attachment) => /\.json$/i.test(file.filename)

const num = (value: unknown) => (typeof value === 'number' ? value : 0)

/* ---------- búsqueda y filtros ---------- */

type Scope = 'all' | 'from' | 'subject'
type Period = 'any' | 'today' | '7d' | '30d' | 'year' | 'custom'

interface Filters {
  scope: Scope
  period: Period
  from: string
  to: string
  pdf: boolean
}

const NO_FILTERS: Filters = { scope: 'all', period: 'any', from: '', to: '', pdf: false }

const SCOPES: Record<Scope, string> = {
  all: 'Todo',
  from: 'Remitente',
  subject: 'Asunto',
}

const PERIODS: Record<Period, string> = {
  any: 'Cualquier fecha',
  today: 'Hoy',
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
  year: 'Este año',
  custom: 'Rango personalizado',
}

/** Fecha en el formato que entiende Gmail: AAAA/MM/DD */
function gmailDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
}

/** Convierte la búsqueda y los filtros a la sintaxis de búsqueda de Gmail. */
function buildQuery(search: string, f: Filters, onlyDte: boolean) {
  const parts: string[] = []
  const term = search.trim()
  if (term) {
    parts.push(
      f.scope === 'from' ? `from:(${term})` : f.scope === 'subject' ? `subject:(${term})` : term,
    )
  }

  const now = new Date()
  if (f.period === 'today') parts.push(`after:${gmailDate(now)}`)
  if (f.period === '7d') parts.push('newer_than:7d')
  if (f.period === '30d') parts.push('newer_than:30d')
  if (f.period === 'year') parts.push(`after:${now.getFullYear()}/01/01`)
  if (f.period === 'custom') {
    if (f.from) parts.push(`after:${f.from.replaceAll('-', '/')}`)
    if (f.to) {
      // "before" no incluye el día indicado, por eso se suma uno
      const end = new Date(`${f.to}T00:00:00`)
      end.setDate(end.getDate() + 1)
      parts.push(`before:${gmailDate(end)}`)
    }
  }

  if (f.pdf) parts.push('filename:pdf')
  if (onlyDte) parts.push(DTE_FILTER)
  return parts.join(' ')
}

const RECENT_KEY = 'dte.recent-searches'

function loadRecent(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string').slice(0, 6) : []
  } catch {
    return []
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    // sin almacenamiento disponible: las búsquedas recientes no se guardan
  }
}

function SearchBar(props: {
  value: string
  filters: Filters
  onSearch: (text: string) => void
  onFilters: (filters: Filters) => void
}) {
  const { value, filters, onSearch, onFilters } = props
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  const [panel, setPanel] = useState(false)
  const [recent, setRecent] = useState(loadRecent)

  // Busca sola al dejar de escribir
  useEffect(() => {
    const timer = setTimeout(() => onSearch(draft.trim()), 450)
    return () => clearTimeout(timer)
  }, [draft, onSearch])

  // "/" lleva el cursor al buscador desde cualquier parte
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const typing = target?.closest('input, textarea, select, [contenteditable]')
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        input.current?.focus()
      }
      if (e.key === 'Escape') setPanel(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function remember(term: string) {
    if (!term) return
    const next = [term, ...recent.filter((r) => r !== term)].slice(0, 6)
    setRecent(next)
    saveRecent(next)
  }

  function forget(term: string) {
    const next = recent.filter((r) => r !== term)
    setRecent(next)
    saveRecent(next)
  }

  function submit(e: { preventDefault(): void }) {
    e.preventDefault()
    const term = draft.trim()
    onSearch(term)
    remember(term)
    input.current?.blur()
  }

  function pick(term: string) {
    setDraft(term)
    onSearch(term)
    remember(term)
    input.current?.blur()
  }

  function clear() {
    setDraft('')
    onSearch('')
    input.current?.focus()
  }

  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch })
  const active =
    Number(filters.scope !== 'all') + Number(filters.period !== 'any') + Number(filters.pdf)
  const showRecent = focused && !draft && recent.length > 0

  return (
    <div className="search-wrap">
      <form className="search" onSubmit={submit}>
        <MagnifyingGlassIcon weight="duotone" />
        <input
          ref={input}
          type="text"
          inputMode="search"
          enterKeyHint="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            if (draft) clear()
            else input.current?.blur()
          }}
          placeholder={
            filters.scope === 'from'
              ? 'Buscar por remitente…'
              : filters.scope === 'subject'
                ? 'Buscar por asunto…'
                : 'Buscar por emisor o asunto…'
          }
          aria-label="Buscar correos"
        />
        {draft ? (
          <button type="button" className="search-clear" onClick={clear} aria-label="Borrar búsqueda">
            <XIcon weight="bold" />
          </button>
        ) : (
          <kbd title="Presiona / para buscar">/</kbd>
        )}
      </form>

      <button
        className={active || panel ? 'btn-filter on' : 'btn-filter'}
        onClick={() => setPanel((open) => !open)}
        aria-expanded={panel}
        aria-label="Filtros"
        title="Filtros"
      >
        <FunnelIcon weight="duotone" />
        {active > 0 && <span className="count">{active}</span>}
      </button>

      {showRecent && (
        // onMouseDown evita que el buscador pierda el foco antes del clic
        <div className="dropdown recent" onMouseDown={(e) => e.preventDefault()}>
          <span className="dropdown-title">Búsquedas recientes</span>
          {recent.map((term) => (
            <div key={term} className="recent-item">
              <button type="button" onClick={() => pick(term)}>
                <ClockCounterClockwiseIcon weight="duotone" />
                <span>{term}</span>
              </button>
              <button
                type="button"
                className="recent-remove"
                onClick={() => forget(term)}
                aria-label={`Quitar ${term}`}
              >
                <XIcon weight="bold" />
              </button>
            </div>
          ))}
        </div>
      )}

      {panel && (
        <>
          <div className="backdrop" onClick={() => setPanel(false)} />
          <div className="dropdown filters" role="dialog" aria-label="Filtros">
            <div className="dropdown-head">
              <strong>Filtros</strong>
              <button className="btn-icon" onClick={() => setPanel(false)} aria-label="Cerrar filtros">
                <XIcon weight="bold" />
              </button>
            </div>

            <div className="filter-group">
              <span className="filter-label">Buscar en</span>
              <div className="segmented">
                {(Object.keys(SCOPES) as Scope[]).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    className={filters.scope === scope ? 'on' : ''}
                    onClick={() => set({ scope })}
                  >
                    {SCOPES[scope]}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-group">
              <label className="filter-label" htmlFor="filter-period">
                Fecha
              </label>
              <select
                id="filter-period"
                className="input"
                value={filters.period}
                onChange={(e) => set({ period: e.target.value as Period })}
              >
                {(Object.keys(PERIODS) as Period[]).map((period) => (
                  <option key={period} value={period}>
                    {PERIODS[period]}
                  </option>
                ))}
              </select>
              {filters.period === 'custom' && (
                <div className="date-range">
                  <label>
                    Desde
                    <input
                      type="date"
                      className="input"
                      value={filters.from}
                      max={filters.to || undefined}
                      onChange={(e) => set({ from: e.target.value })}
                    />
                  </label>
                  <label>
                    Hasta
                    <input
                      type="date"
                      className="input"
                      value={filters.to}
                      min={filters.from || undefined}
                      onChange={(e) => set({ to: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </div>

            <label className="switch">
              <input
                type="checkbox"
                checked={filters.pdf}
                onChange={(e) => set({ pdf: e.target.checked })}
              />
              <span className="switch-track" />
              Solo correos con PDF adjunto
            </label>

            <div className="dropdown-foot">
              <button
                className="btn btn-light btn-sm"
                onClick={() => onFilters(NO_FILTERS)}
                disabled={!active}
              >
                Limpiar
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setPanel(false)}>
                Listo
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** Filtros activos, cada uno con su botón para quitarlo. */
function ActiveFilters(props: {
  search: string
  filters: Filters
  onSearch: (text: string) => void
  onFilters: (filters: Filters) => void
}) {
  const { search, filters, onSearch, onFilters } = props
  const chips: { label: string; remove: () => void }[] = []

  if (search) {
    const where = filters.scope === 'all' ? '' : `${SCOPES[filters.scope]}: `
    chips.push({ label: `${where}“${search}”`, remove: () => onSearch('') })
  }
  if (filters.period !== 'any') {
    const range = [filters.from && `desde ${filters.from}`, filters.to && `hasta ${filters.to}`]
      .filter(Boolean)
      .join(' ')
    chips.push({
      label: filters.period === 'custom' ? range || PERIODS.custom : PERIODS[filters.period],
      remove: () => onFilters({ ...filters, period: 'any', from: '', to: '' }),
    })
  }
  if (filters.pdf) {
    chips.push({ label: 'Con PDF', remove: () => onFilters({ ...filters, pdf: false }) })
  }

  if (chips.length === 0) return null

  return (
    <div className="chips">
      {chips.map((chip) => (
        <span key={chip.label} className="chip">
          {chip.label}
          <button onClick={chip.remove} aria-label={`Quitar filtro ${chip.label}`}>
            <XIcon weight="bold" />
          </button>
        </span>
      ))}
    </div>
  )
}

/* ---------- piezas pequeñas ---------- */

function Symbol(props: { name: string; size?: number; children?: ReactNode; tone?: string }) {
  const { name, size = 40, children } = props
  const style = { '--s': `${size}px` } as CSSProperties
  return (
    <span className={`symbol ${props.tone ?? tone(name)}`} style={style} aria-hidden="true">
      {children ?? initials(name)}
    </span>
  )
}

function Brand() {
  return (
    <span className="brand">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--primary)" />
        <path d="M10 7.5h8.2L23 12.3V23a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 9 23V9a1.5 1.5 0 0 1 1-1.5Z" fill="#fff" />
        <path d="M18 7.5V11a1.5 1.5 0 0 0 1.5 1.5H23" fill="#fff" opacity=".55" />
        <path d="m12.6 18.4 2.3 2.3 4.6-4.9" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="brand-name">
        DTE<span>Lector</span>
      </span>
    </span>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="skeleton" aria-label="Cargando">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row">
          <span className="bone square" />
          <span className="bone" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
          <span className="bone thin" style={{ width: `${70 + ((i * 11) % 25)}%` }} />
        </div>
      ))}
    </div>
  )
}

function Blank({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="blank">
      <span className="blank-icon">{icon}</span>
      <p>{children}</p>
    </div>
  )
}

/* ---------- app ---------- */

type Auth =
  | { status: 'loading' }
  | { status: 'out' }
  | { status: 'in'; me: Me }
  | { status: 'error'; error: string }

export default function App() {
  const [auth, setAuth] = useState<Auth>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    getMe()
      .then((me) => alive && setAuth({ status: 'in', me }))
      .catch((err: unknown) => {
        if (!alive) return
        setAuth(
          isUnauthorized(err)
            ? { status: 'out' }
            : { status: 'error', error: errorText(err) },
        )
      })
    return () => {
      alive = false
    }
  }, [attempt])

  const onSessionLost = useCallback(() => setAuth({ status: 'out' }), [])

  async function handleLogout() {
    try {
      await logout()
    } finally {
      setAuth({ status: 'out' })
    }
  }

  if (auth.status === 'loading') {
    return (
      <div className="splash">
        <span className="spinner" aria-label="Cargando" />
      </div>
    )
  }

  if (auth.status === 'in') {
    return <Shell me={auth.me} onLogout={handleLogout} onSessionLost={onSessionLost} />
  }

  return (
    <div className="auth">
      <div className="auth-form">
        <Brand />
        {auth.status === 'error' ? (
          <div className="auth-box">
            <h1>Sin conexión</h1>
            <p className="lead">{auth.error}</p>
            <button
              className="btn btn-primary btn-lg"
              onClick={() => {
                setAuth({ status: 'loading' })
                setAttempt((n) => n + 1)
              }}
            >
              <ArrowsClockwiseIcon weight="bold" />
              Reintentar
            </button>
          </div>
        ) : (
          <div className="auth-box">
            <h1>Iniciar sesión</h1>
            <p className="lead">Conecta tu correo para consultar tus documentos tributarios.</p>
            <a className="btn btn-outline btn-lg" href={LOGIN_URL}>
              <GoogleIcon />
              Continuar con Google
            </a>
            <p className="hint">
              <ShieldCheckIcon weight="duotone" />
              Solo lectura. No se envía ni se modifica ningún correo.
            </p>
          </div>
        )}
        <span className="auth-foot">DTE Lector · El Salvador</span>
      </div>

      <div className="auth-aside">
        <h2>Tus DTE, sin abrir un solo JSON</h2>
        <p>
          Facturas, créditos fiscales y notas de crédito que llegan a tu correo, presentados como
          documentos listos para revisar.
        </p>
        <ul>
          <li>
            <span className="aside-icon">
              <TrayIcon weight="duotone" />
            </span>
            Encuentra los correos que traen un DTE adjunto
          </li>
          <li>
            <span className="aside-icon">
              <ReceiptIcon weight="duotone" />
            </span>
            Emisor, receptor, detalle y totales en una sola vista
          </li>
          <li>
            <span className="aside-icon">
              <SealCheckIcon weight="duotone" />
            </span>
            Verifica el sello de recepción de Hacienda
          </li>
        </ul>
      </div>
    </div>
  )
}

/* ---------- aplicación con sesión ---------- */

function Shell(props: { me: Me; onLogout: () => void; onSessionLost: () => void }) {
  const { me, onLogout, onSessionLost } = props
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [onlyDte, setOnlyDte] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const q = buildQuery(search, filters, onlyDte)

  // La clave de SearchBar cambia al quitar la búsqueda desde un filtro activo,
  // para que el cuadro de texto también se vacíe.
  const [resets, setResets] = useState(0)

  const onSearch = useCallback((text: string) => {
    setSearch((current) => {
      if (current !== text) setSelected(null)
      return text
    })
  }, [])

  function onFilters(next: Filters) {
    setFilters(next)
    setSelected(null)
  }

  function clearSearch() {
    onSearch('')
    setResets((n) => n + 1)
  }

  function go(dte: boolean) {
    setOnlyDte(dte)
    setSelected(null)
    setMenuOpen(false)
  }

  return (
    <div className={menuOpen ? 'app menu-open' : 'app'}>
      <div className="overlay" onClick={() => setMenuOpen(false)} />
      <aside className="sidebar">
        <div className="sidebar-logo">
          <Brand />
          <button
            className="btn-icon menu-toggle"
            onClick={() => setMenuOpen(false)}
            aria-label="Cerrar menú"
          >
            <XIcon weight="bold" />
          </button>
        </div>

        <nav className="menu">
          <span className="menu-heading">Bandeja</span>
          <button className={onlyDte ? 'menu-link active' : 'menu-link'} onClick={() => go(true)}>
            <ReceiptIcon weight="duotone" />
            <span>Documentos DTE</span>
          </button>
          <button className={onlyDte ? 'menu-link' : 'menu-link active'} onClick={() => go(false)}>
            <EnvelopeSimpleIcon weight="duotone" />
            <span>Todos los correos</span>
          </button>
        </nav>

        <div className="sidebar-user">
          <Symbol name={me.email} size={36} tone="primary" />
          <span className="sidebar-email" title={me.email}>
            <small>Conectado como</small>
            {me.email}
          </span>
          <button className="btn-icon" onClick={onLogout} title="Cerrar sesión" aria-label="Cerrar sesión">
            <SignOutIcon weight="duotone" />
          </button>
        </div>
      </aside>

      <div className="wrapper">
        <header className="header">
          <button
            className="btn-icon menu-toggle"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menú"
          >
            <ListIcon weight="bold" />
          </button>
          <div className="page-title">
            <h1>{onlyDte ? 'Documentos tributarios' : 'Todos los correos'}</h1>
            <span className="crumbs">
              Inicio <i /> Bandeja <i /> {onlyDte ? 'DTE' : 'Correos'}
            </span>
          </div>
          <SearchBar
            key={resets}
            value={search}
            filters={filters}
            onSearch={onSearch}
            onFilters={onFilters}
          />
        </header>

        <main className={selected ? 'content has-selection' : 'content'}>
          <section className="card list-card">
            <ActiveFilters
              search={search}
              filters={filters}
              onSearch={clearSearch}
              onFilters={onFilters}
            />
            <MessageList
              key={q}
              q={q}
              selected={selected}
              onSelect={setSelected}
              onSessionLost={onSessionLost}
            />
          </section>

          <section className="card detail-card">
            {selected ? (
              <Detail
                key={selected}
                id={selected}
                onBack={() => setSelected(null)}
                onSessionLost={onSessionLost}
              />
            ) : (
              <Blank icon={<FileTextIcon weight="duotone" />}>
                Selecciona un correo para ver su documento.
              </Blank>
            )}
          </section>
        </main>
      </div>
    </div>
  )
}

/* ---------- lista ---------- */

interface ListState {
  status: 'loading' | 'ready' | 'more'
  items: MessageSummary[]
  next: string
  error: string
}

function MessageList(props: {
  q: string
  selected: string | null
  onSelect: (id: string) => void
  onSessionLost: () => void
}) {
  const { q, selected, onSelect, onSessionLost } = props
  const [state, setState] = useState<ListState>({
    status: 'loading',
    items: [],
    next: '',
    error: '',
  })

  const fail = useCallback(
    (err: unknown) => {
      if (isUnauthorized(err)) return onSessionLost()
      setState((s) => ({ ...s, status: 'ready', error: errorText(err) }))
    },
    [onSessionLost],
  )

  useEffect(() => {
    let alive = true
    listMessages({ q, limit: PAGE_SIZE })
      .then((page) => {
        if (!alive) return
        setState({
          status: 'ready',
          items: page.messages ?? [],
          next: page.nextPageToken ?? '',
          error: '',
        })
      })
      .catch((err: unknown) => alive && fail(err))
    return () => {
      alive = false
    }
  }, [q, fail])

  async function loadMore() {
    setState((s) => ({ ...s, status: 'more', error: '' }))
    try {
      const page = await listMessages({ q, limit: PAGE_SIZE, pageToken: state.next })
      setState((s) => ({
        status: 'ready',
        items: [...s.items, ...(page.messages ?? [])],
        next: page.nextPageToken ?? '',
        error: '',
      }))
    } catch (err) {
      fail(err)
    }
  }

  const loading = state.status === 'loading'

  return (
    <>
      <div className="card-header">
        <h3>Correos</h3>
        {!loading && (
          <span className="badge primary">
            {state.items.length}
            {state.next && '+'}
          </span>
        )}
      </div>

      {loading ? (
        <Skeleton rows={7} />
      ) : (
        <div className="list-scroll">
          {state.items.length === 0 && !state.error && (
            <Blank icon={<TrayIcon weight="duotone" />}>No hay correos que coincidan.</Blank>
          )}
          <ul className="messages">
            {state.items.map((m) => {
              const name = senderName(m.from)
              return (
                <li key={m.id}>
                  <button
                    className={m.id === selected ? 'message active' : 'message'}
                    onClick={() => onSelect(m.id)}
                  >
                    <Symbol name={name} />
                    <span className="from">{name}</span>
                    <span className="date">{formatDate(m.date)}</span>
                    <span className="subject">{m.subject || '(sin asunto)'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {state.error && (
            <p className="alert danger">
              <WarningCircleIcon weight="duotone" />
              {state.error}
            </p>
          )}
          {state.next && (
            <button
              className="btn btn-light more"
              onClick={loadMore}
              disabled={state.status === 'more'}
            >
              {state.status === 'more' ? 'Cargando…' : 'Cargar más'}
            </button>
          )}
        </div>
      )}
    </>
  )
}

/* ---------- detalle ---------- */

type DetailState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; message: MessageDetail; dte: Dte | null; dteNote: string }

type Tab = 'dte' | 'pdf' | 'mail'

function Detail(props: { id: string; onBack: () => void; onSessionLost: () => void }) {
  const { id, onBack, onSessionLost } = props
  const [state, setState] = useState<DetailState>({ status: 'loading' })
  const [chosen, setChosen] = useState<Tab | null>(null)

  useEffect(() => {
    let alive = true
    Promise.allSettled([getMessage(id), getDte(id)]).then(([message, dte]) => {
      if (!alive) return
      const failed = [message, dte].find(
        (r) => r.status === 'rejected' && isUnauthorized(r.reason),
      )
      if (failed) return onSessionLost()
      if (message.status === 'rejected') {
        return setState({ status: 'error', error: errorText(message.reason) })
      }
      setState({
        status: 'ready',
        message: message.value,
        dte: dte.status === 'fulfilled' ? dte.value : null,
        dteNote: dte.status === 'rejected' ? errorText(dte.reason) : '',
      })
    })
    return () => {
      alive = false
    }
  }, [id, onSessionLost])

  const back = (
    <button className="btn btn-light btn-sm back" onClick={onBack}>
      <ArrowLeftIcon weight="bold" />
      Volver
    </button>
  )

  if (state.status === 'loading') {
    return (
      <div className="detail">
        <Skeleton rows={4} />
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="detail">
        {back}
        <p className="alert danger">
          <WarningCircleIcon weight="duotone" />
          {state.error}
        </p>
      </div>
    )
  }

  const { message, dte, dteNote } = state
  const tab: Tab = chosen ?? (dte ? 'dte' : 'mail')
  const name = senderName(message.from)
  const attachments = message.attachments ?? []
  const pdf = attachments.find(isPdf)

  return (
    <article className="detail">
      {back}

      <header className="mail-head">
        <Symbol name={name} size={50} />
        <div className="mail-head-info">
          <h2>{message.subject || '(sin asunto)'}</h2>
          <div className="mail-meta">
            <span>
              <UserCircleIcon weight="duotone" />
              {name}
            </span>
            <span>
              <EnvelopeSimpleIcon weight="duotone" />
              {senderEmail(message.from)}
            </span>
            <span>
              <CalendarBlankIcon weight="duotone" />
              {formatDate(message.date, true)}
            </span>
          </div>
        </div>
      </header>

      {attachments.length > 0 && (
        <ul className="attachments" aria-label="Archivos adjuntos">
          {attachments.map((file) => (
            <li key={file.index}>
              <a
                className="file"
                href={attachmentUrl(id, file.index, true)}
                download={file.filename}
                title={`Descargar ${file.filename}`}
              >
                <Symbol name="" size={38} tone={isPdf(file) ? 'danger' : isJson(file) ? 'warning' : 'primary'}>
                  {isPdf(file) ? (
                    <FilePdfIcon weight="duotone" />
                  ) : isJson(file) ? (
                    <BracketsCurlyIcon weight="duotone" />
                  ) : (
                    <FileIcon weight="duotone" />
                  )}
                </Symbol>
                <span className="file-info">
                  <strong>{file.filename}</strong>
                  <small>{fileSize(file.size)}</small>
                </span>
                <DownloadSimpleIcon weight="bold" className="file-action" />
              </a>
            </li>
          ))}
        </ul>
      )}

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'dte'} onClick={() => setChosen('dte')}>
          <ReceiptIcon weight="duotone" />
          Documento
        </button>
        {pdf && (
          <button role="tab" aria-selected={tab === 'pdf'} onClick={() => setChosen('pdf')}>
            <FilePdfIcon weight="duotone" />
            PDF
          </button>
        )}
        <button role="tab" aria-selected={tab === 'mail'} onClick={() => setChosen('mail')}>
          <EnvelopeSimpleIcon weight="duotone" />
          Correo
        </button>
      </nav>

      {tab === 'dte' &&
        (dte ? (
          <DteView dte={dte} />
        ) : (
          <Blank icon={<ReceiptIcon weight="duotone" />}>{dteNote}</Blank>
        ))}
      {tab === 'pdf' && pdf && (
        <div className="pdf">
          <div className="pdf-bar">
            <span>{pdf.filename}</span>
            <a className="btn btn-light btn-sm" href={attachmentUrl(id, pdf.index)} target="_blank" rel="noreferrer">
              <ArrowSquareOutIcon weight="bold" />
              Abrir en pestaña nueva
            </a>
          </div>
          <iframe title={pdf.filename} src={attachmentUrl(id, pdf.index)} />
        </div>
      )}
      {tab === 'mail' && <MailBody message={message} />}
    </article>
  )
}

/* ---------- cuerpo del correo ---------- */

// El HTML del correo se muestra aislado en un iframe: sin scripts, sin
// formularios y con una CSP que solo deja pasar imágenes, estilos y fuentes.
const FRAME_HEAD = `<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https:; font-src https: data:">
<base target="_blank">
<style>
  html { color-scheme: light; }
  body { margin: 0; padding: 20px; background: #fff; color: #252f4a;
         font: 14px/1.55 Inter, system-ui, 'Segoe UI', Roboto, sans-serif; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: #1b84ff; }
</style>`

function MailBody({ message }: { message: MessageDetail }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(320)
  const html = message.html?.trim() ?? ''

  const srcDoc = useMemo(
    () => `<!doctype html><html><head>${FRAME_HEAD}</head><body>${html}</body></html>`,
    [html],
  )

  // Ajusta el alto del iframe a su contenido (también cuando cargan imágenes).
  function fit() {
    const doc = frame.current?.contentDocument
    if (!doc) return
    const measure = () => setHeight(doc.documentElement.scrollHeight)
    measure()
    new ResizeObserver(measure).observe(doc.body)
  }

  if (html) {
    return (
      <iframe
        ref={frame}
        className="mail-frame"
        title="Contenido del correo"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        style={{ height }}
        onLoad={fit}
      />
    )
  }

  if (message.text.trim()) {
    return <div className="mail-text">{message.text.trim()}</div>
  }

  return (
    <Blank icon={<EnvelopeSimpleIcon weight="duotone" />}>
      Este correo no tiene contenido para mostrar.
    </Blank>
  )
}

/* ---------- documento ---------- */

function Field({ label, value, mono }: { label: string; value: unknown; mono?: boolean }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{text(value)}</dd>
    </div>
  )
}

function Party(props: { title: string; name: unknown; icon: ReactNode; tone: string; children: ReactNode }) {
  return (
    <section className="party">
      <Symbol name="" size={44} tone={props.tone}>
        {props.icon}
      </Symbol>
      <div className="party-info">
        <span className="party-title">{props.title}</span>
        <strong>{text(props.name)}</strong>
        <dl className="fields">{props.children}</dl>
      </div>
    </section>
  )
}

function DteView({ dte }: { dte: Dte }) {
  const { identificacion: ident, emisor } = dte
  const receptor: Json = dte.receptor ?? {}
  const resumen: Json = dte.resumen ?? {}
  const items = Array.isArray(dte.cuerpoDocumento) ? dte.cuerpoDocumento : []
  const currency = ident.tipoMoneda || 'USD'
  const tipo = TIPOS_DTE[ident.tipoDte] ?? `DTE tipo ${ident.tipoDte || '?'}`
  const total = resumen.totalPagar ?? resumen.montoTotalOperacion

  const totals: [string, unknown][] = [
    ['Subtotal', resumen.subTotal],
    ['IVA', resumen.totalIva ?? resumen.ivaPerci1],
    ['Monto de la operación', resumen.montoTotalOperacion],
  ]

  return (
    <div className="dte">
      <div className="dte-top">
        <div>
          <h3>{tipo}</h3>
          <div className="badges">
            {dte.selloRecibido ? (
              <span className="badge success">
                <SealCheckIcon weight="fill" />
                Sello recibido
              </span>
            ) : (
              <span className="badge warning">Sin sello de recepción</span>
            )}
            {ident.ambiente === '00' && <span className="badge warning">Ambiente de pruebas</span>}
            <span className="badge muted">{currency}</span>
          </div>
        </div>
        <div className="dte-total">
          <span>Total a pagar</span>
          <strong>{money(total, currency)}</strong>
        </div>
      </div>

      <dl className="fields ids">
        <Field label="Fecha de emisión" value={[ident.fecEmi, ident.horEmi].filter(Boolean).join(' · ')} />
        <Field label="Número de control" value={ident.numeroControl} mono />
        <Field label="Código de generación" value={ident.codigoGeneracion} mono />
      </dl>

      <div className="parties">
        <Party title="Emisor" name={emisor.nombre} icon={<BuildingsIcon weight="duotone" />} tone="primary">
          <Field label="NIT" value={emisor.nit} mono />
          <Field label="NRC" value={emisor.nrc} mono />
        </Party>
        <Party title="Receptor" name={receptor.nombre} icon={<UserCircleIcon weight="duotone" />} tone="info">
          <Field label="Documento" value={receptor.nit ?? receptor.numDocumento} mono />
          <Field label="NRC" value={receptor.nrc} mono />
        </Party>
      </div>

      {items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Descripción</th>
                <th className="right">Cant.</th>
                <th className="right">Precio</th>
                <th className="right">Venta</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i}>
                  <td className="dim">{text(item.numItem ?? i + 1)}</td>
                  <td className="strong">{text(item.descripcion)}</td>
                  <td className="right">{text(item.cantidad)}</td>
                  <td className="right">{money(item.precioUni, currency)}</td>
                  <td className="right strong">
                    {money(
                      num(item.ventaGravada) + num(item.ventaExenta) + num(item.ventaNoSuj),
                      currency,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="summary">
        {typeof resumen.totalLetras === 'string' && (
          <p className="letras">
            <span>Total en letras</span>
            {resumen.totalLetras}
          </p>
        )}
        <dl className="totals">
          {totals
            .filter(([, value]) => typeof value === 'number')
            .map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{money(value, currency)}</dd>
              </div>
            ))}
          <div className="grand">
            <dt>Total a pagar</dt>
            <dd>{money(total, currency)}</dd>
          </div>
        </dl>
      </div>

      {dte.selloRecibido && (
        <div className="notice">
          <ShieldCheckIcon weight="duotone" />
          <div>
            <strong>Sello de recepción de Hacienda</strong>
            <span className="mono">{dte.selloRecibido}</span>
          </div>
        </div>
      )}
    </div>
  )
}
