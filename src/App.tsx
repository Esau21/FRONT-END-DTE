import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  PaperclipIcon,
  BracketsCurlyIcon,
  BuildingsIcon,
  CalendarBlankIcon,
  CheckCircleIcon,
  ChartBarIcon,
  ClockCounterClockwiseIcon,
  DownloadSimpleIcon,
  EnvelopeSimpleIcon,
  FileIcon,
  FilePdfIcon,
  FunnelIcon,
  ListIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PrinterIcon,
  ReceiptIcon,
  ShieldCheckIcon,
  SignOutIcon,
  SunIcon,
  TableIcon,
  TrayIcon,
  UserCircleIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react'
import {
  getProviders,
  loginUrl,
  attachmentUrl,
  errorText,
  getDte,
  getMe,
  getMessage,
  listFiles,
  saveFile,
  isUnauthorized,
  listMessages,
  logout,
} from './api'
import type {
  Attachment,
  Dte,
  Json,
  Me,
  MessageDetail,
  MessageSummary,
  Provider,
} from './api'
import { FolderPicker } from './FolderPicker'
import { PrivacyPolicy, TermsOfService } from './Legal'
import { Dashboard, FilesView, InvoicesView } from './Invoices'
import { TIPOS_DTE, haciendaUrl, money } from './format'
import { useSync } from './useSync'
import './App.css'

const PAGE_SIZE = 15
const DTE_FILTER = 'filename:json'

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

const TONES = ['lavender', 'sky', 'mint'] as const

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
        <MagnifyingGlassIcon />
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
        <FunnelIcon />
        {active > 0 && <span className="count">{active}</span>}
      </button>

      {showRecent && (
        // onMouseDown evita que el buscador pierda el foco antes del clic
        <div className="dropdown recent" onMouseDown={(e) => e.preventDefault()}>
          <span className="dropdown-title">Búsquedas recientes</span>
          {recent.map((term) => (
            <div key={term} className="recent-item">
              <button type="button" onClick={() => pick(term)}>
                <ClockCounterClockwiseIcon />
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
        <rect width="32" height="32" rx="10" fill="var(--violet)" />
        <path
          d="M11 8.5h7l4 4V22a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 9.5 22V10A1.5 1.5 0 0 1 11 8.5Z"
          fill="#fff"
          stroke="#111"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M13 15h6M13 18.5h4"
          stroke="#111"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="brand-name">
        BOOKEEP
      </span>
    </span>
  )
}

/** Isotipo de Google Cloud (la nube del logotipo oficial, sin el texto). */
function GoogleCloudIcon() {
  return (
    <svg viewBox="0 0 35 27" width="22" height="17" aria-hidden="true">
      <path
        fill="#ea4335"
        d="M21.85,7.41l1,0,2.85-2.85.14-1.21A12.81,12.81,0,0,0,5,9.6a1.55,1.55,0,0,1,1-.06l5.7-.94s.29-.48.44-.45a7.11,7.11,0,0,1,9.73-.74Z"
      />
      <path
        fill="#4285f4"
        d="M29.76,9.6a12.84,12.84,0,0,0-3.87-6.24l-4,4A7.11,7.11,0,0,1,24.5,13v.71a3.56,3.56,0,1,1,0,7.12H17.38l-.71.72v4.27l.71.71H24.5A9.26,9.26,0,0,0,29.76,9.6Z"
      />
      <path
        fill="#34a853"
        d="M10.25,26.49h7.12v-5.7H10.25a3.54,3.54,0,0,1-1.47-.32l-1,.31L4.91,23.63l-.25,1A9.21,9.21,0,0,0,10.25,26.49Z"
      />
      <path
        fill="#fbbc05"
        d="M10.25,8A9.26,9.26,0,0,0,4.66,24.6l4.13-4.13a3.56,3.56,0,1,1,4.71-4.71l4.13-4.13A9.25,9.25,0,0,0,10.25,8Z"
      />
    </svg>
  )
}

/** Icono de Gmail (el del logotipo oficial). */
function GmailIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="52 42 88 66" width={size} height={(size * 66) / 88} aria-hidden="true">
      <path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
      <path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
      <path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
      <path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92" />
      <path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
    </svg>
  )
}

/** Logotipo de Microsoft: cuatro cuadros. */
function MicrosoftIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 21 21" width={size} height={size} aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}

const PROVIDERS: Record<Provider, { name: string; login: string }> = {
  gmail: { name: 'Gmail', login: 'Continuar con Google' },
  outlook: { name: 'Outlook', login: 'Continuar con Microsoft' },
}

function ProviderIcon({ provider, size }: { provider: Provider; size: number }) {
  return provider === 'outlook' ? <MicrosoftIcon size={size * 0.82} /> : <GmailIcon size={size} />
}

/** Un botón de inicio de sesión por cada proveedor que el servidor ofrece. */
function LoginButtons() {
  const [providers, setProviders] = useState<Provider[]>(['gmail'])

  useEffect(() => {
    let alive = true
    getProviders()
      .then((list) => alive && list.length > 0 && setProviders(list))
      // Si no se pueden consultar, queda el botón de Google
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  return (
    <>
      {providers
        .filter((provider) => provider in PROVIDERS)
        .map((provider) => (
          <a key={provider} className="btn btn-outline btn-lg" href={loginUrl(provider)}>
            {provider === 'outlook' ? <MicrosoftIcon /> : <GoogleIcon />}
            {PROVIDERS[provider].login}
          </a>
        ))}
    </>
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

/* ---------- tema claro / oscuro ---------- */

type Theme = 'light' | 'dark'

const THEME_KEY = 'dte.theme'

/** El tema guardado; si no hay, el que use el sistema. */
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // sin almacenamiento disponible: se usa el tema del sistema
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // sin almacenamiento disponible: el tema dura solo esta visita
    }
  }

  return [theme, toggle] as const
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const label = theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'
  return (
    <button className="btn-icon theme-toggle" onClick={onToggle} title={label} aria-label={label}>
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

/* ---------- app ---------- */

type Auth =
  | { status: 'loading' }
  | { status: 'out' }
  | { status: 'in'; me: Me }
  | { status: 'error'; error: string }

/* ---------- páginas públicas ---------- */

const LEGAL_PAGES = {
  '/privacidad': { title: 'Política de Privacidad', Content: PrivacyPolicy },
  '/terminos': { title: 'Condiciones del Servicio', Content: TermsOfService },
} as const

type LegalPath = keyof typeof LEGAL_PAGES

function legalPath(pathname: string): LegalPath | null {
  const path = pathname.replace(/\/+$/, '').toLowerCase()
  return path in LEGAL_PAGES ? (path as LegalPath) : null
}

function LegalFooterLinks() {
  return (
    <nav className="legal-links" aria-label="Información legal">
      <a href="/privacidad">Política de Privacidad</a>
      <span aria-hidden="true">·</span>
      <a href="/terminos">Condiciones del Servicio</a>
    </nav>
  )
}

/** Política de privacidad y condiciones: se ven sin iniciar sesión. */
function LegalPage({ path }: { path: LegalPath }) {
  const [theme, toggleTheme] = useTheme()
  const { title, Content } = LEGAL_PAGES[path]

  useEffect(() => {
    document.title = `${title} · Bookeep`
  }, [title])

  return (
    <div className="legal">
      <header className="legal-top">
        <a href="/" className="legal-home" aria-label="Ir al inicio">
          <Brand />
        </a>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </header>
      <main className="legal-doc">
        <a href="/" className="legal-back">
          <ArrowLeftIcon weight="bold" />
          Volver al inicio
        </a>
        <article>
          <Content />
        </article>
      </main>
      <footer className="legal-foot">
        <LegalFooterLinks />
        <span>Bookeep · Hecho en El Salvador</span>
      </footer>
    </div>
  )
}

export default function App() {
  const path = legalPath(window.location.pathname)
  return path ? <LegalPage path={path} /> : <Main />
}

function Main() {
  const [auth, setAuth] = useState<Auth>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [theme, toggleTheme] = useTheme()
  const themeToggle = <ThemeToggle theme={theme} onToggle={toggleTheme} />

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
    return (
      <Shell
        me={auth.me}
        themeToggle={themeToggle}
        onLogout={handleLogout}
        onSessionLost={onSessionLost}
      />
    )
  }

  return (
    <div className="auth">
      <div className="auth-form">
        <div className="auth-top">
          <Brand />
          {themeToggle}
        </div>
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
            <h1>Tus facturas, siempre contigo.</h1>
            <p className="lead">
              Conecta tu correo y revisa las facturas y comprobantes que recibes, con sus
              totales y su PDF, en un solo lugar.
            </p>
            <LoginButtons />
            <p className="hint">
              <ShieldCheckIcon />
              Solo lectura. No se envía ni se modifica ningún correo.
            </p>
          </div>
        )}
        <footer className="auth-foot">
          <LegalFooterLinks />
          <span>Bookeep · Hecho en El Salvador</span>
        </footer>
      </div>
    </div>
  )
}

/* ---------- aplicación con sesión ---------- */

type View = 'resumen' | 'facturas' | 'archivos' | 'dte' | 'correos'

const TITLES: Record<View, string> = {
  resumen: 'Resumen',
  facturas: 'Facturas',
  archivos: 'Archivos en la nube',
  dte: 'Correos con DTE',
  correos: 'Todos los correos',
}

function Shell(props: {
  me: Me
  themeToggle: ReactNode
  onLogout: () => void
  onSessionLost: () => void
}) {
  const { me, themeToggle, onLogout, onSessionLost } = props
  const [view, setView] = useState<View>('resumen')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [selected, setSelected] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const isMail = view === 'dte' || view === 'correos'
  const q = buildQuery(search, filters, view === 'dte')

  // Al entrar se traen las facturas nuevas del correo, una sola vez.
  const sync = useSync(onSessionLost)
  const startSync = sync.start
  useEffect(() => {
    startSync()
  }, [startSync])

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

  function go(next: View) {
    setView(next)
    setSelected(null)
    setMenuOpen(false)
  }

  /** Abre el correo del que salió una factura, con su PDF. */
  function openMessage(messageId: string) {
    setView('dte')
    setSelected(messageId)
  }

  const link = (target: View, icon: ReactNode) => (
    <button
      className={view === target ? 'menu-link active' : 'menu-link'}
      onClick={() => go(target)}
    >
      {icon}
      <span>{TITLES[target]}</span>
    </button>
  )

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
          <span className="menu-heading">Contabilidad</span>
          {link('resumen', <ChartBarIcon />)}
          {link('facturas', <TableIcon />)}
          {link('archivos', <GoogleCloudIcon />)}
          <span className="menu-heading">Correo</span>
          {link('dte', <ReceiptIcon />)}
          {link('correos', <EnvelopeSimpleIcon />)}
        </nav>

        <div className="sidebar-user">
          <Symbol name={me.email} size={36} tone="lavender" />
          <span className="sidebar-email" title={me.email}>
            <small>Conectado como</small>
            {me.email}
          </span>
          <button
            className="btn-icon"
            onClick={onLogout}
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <SignOutIcon />
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
            <h1>{TITLES[view]}</h1>
            <span className="crumbs">
              {new Date().toLocaleDateString('es-SV', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </span>
          </div>
          {isMail && (
            <SearchBar
              key={resets}
              value={search}
              filters={filters}
              onSearch={onSearch}
              onFilters={onFilters}
            />
          )}
          {themeToggle}
        </header>

        {view === 'resumen' && (
          <Dashboard
            sync={sync}
            onSessionLost={onSessionLost}
            onOpenInvoices={() => go('facturas')}
          />
        )}

        {view === 'facturas' && (
          <InvoicesView sync={sync} onSessionLost={onSessionLost} onOpenMessage={openMessage} />
        )}

        {view === 'archivos' && (
          <FilesView onSessionLost={onSessionLost} onOpenMessage={openMessage} />
        )}

        {isMail && (
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
                account={me.email}
                provider={me.provider ?? 'gmail'}
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
                <MailWelcome
                  account={me.email}
                  provider={me.provider ?? 'gmail'}
                  onlyDte={view === 'dte'}
                />
              )}
            </section>
          </main>
        )}
      </div>
    </div>
  )
}

/* ---------- lista ---------- */

/** A qué grupo de la lista pertenece un correo según su fecha. */
function dateGroup(value: string) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return 'Sin fecha'

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.floor((today.getTime() - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days <= 0) return 'Hoy'
  if (days === 1) return 'Ayer'
  if (days < 7) return 'Esta semana'

  const month = date.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' })
  return month.charAt(0).toUpperCase() + month.slice(1)
}

interface ListState {
  status: 'loading' | 'ready' | 'more'
  items: MessageSummary[]
  next: string
  error: string
}

function MessageList(props: {
  q: string
  account: string
  provider: Provider
  selected: string | null
  onSelect: (id: string) => void
  onSessionLost: () => void
}) {
  const { q, account, provider, selected, onSelect, onSessionLost } = props
  const [state, setState] = useState<ListState>({
    status: 'loading',
    items: [],
    next: '',
    error: '',
  })
  // Cada vez que cambia, la lista se vuelve a pedir desde el principio
  const [reload, setReload] = useState(0)

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
  }, [q, fail, reload])

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

  function refresh() {
    setState((s) => ({ ...s, status: 'loading' }))
    setReload((n) => n + 1)
  }

  const loading = state.status === 'loading'

  // Los correos llegan del más nuevo al más viejo: se agrupan por fecha
  const groups: { label: string; items: MessageSummary[] }[] = []
  for (const message of state.items) {
    const label = dateGroup(message.date)
    const last = groups[groups.length - 1]
    if (last?.label === label) last.items.push(message)
    else groups.push({ label, items: [message] })
  }

  return (
    <>
      <div className="mailbox-head">
        <span className="mailbox-icon">
          <ProviderIcon provider={provider} size={22} />
        </span>
        <div className="mailbox-title">
          <strong>{PROVIDERS[provider].name}</strong>
          <small title={account}>{account}</small>
        </div>
        {!loading && (
          <span className="badge primary">
            {state.items.length}
            {state.next && '+'}
          </span>
        )}
        <button
          className="btn-icon"
          onClick={refresh}
          disabled={loading}
          title="Actualizar"
          aria-label="Actualizar la lista de correos"
        >
          <ArrowsClockwiseIcon className={loading ? 'spin' : undefined} />
        </button>
      </div>

      {loading ? (
        <Skeleton rows={7} />
      ) : (
        <div className="list-scroll">
          {state.items.length === 0 && !state.error && (
            <Blank icon={<TrayIcon />}>No hay correos que coincidan.</Blank>
          )}
          {groups.map((group) => (
            <section key={group.label}>
              <h4 className="mail-group">{group.label}</h4>
              <ul className="messages">
                {group.items.map((m) => {
                  const sender = senderName(m.from)
                  const classes = ['message', m.id === selected && 'active', m.unread && 'unread']
                  return (
                    <li key={m.id}>
                      <button
                        className={classes.filter(Boolean).join(' ')}
                        onClick={() => onSelect(m.id)}
                      >
                        <Symbol name={sender} />
                        <span className="from" title={m.from}>
                          {m.unread && <i className="unread-dot" title="Sin leer" />}
                          <span>{sender}</span>
                        </span>
                        <span className="date">{formatDate(m.date)}</span>
                        <span className="subject">{m.subject || '(sin asunto)'}</span>
                        {m.snippet && <span className="snippet">{m.snippet}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
          {state.error && (
            <p className="alert danger">
              <WarningCircleIcon />
              {state.error}
            </p>
          )}
          {state.next && (
            <button
              className="btn btn-light more"
              onClick={loadMore}
              disabled={state.status === 'more'}
            >
              {state.status === 'more' ? 'Cargando…' : 'Cargar más correos'}
            </button>
          )}
        </div>
      )}
    </>
  )
}

/** Lo que se ve a la derecha mientras no hay ningún correo abierto. */
function MailWelcome(props: { account: string; provider: Provider; onlyDte: boolean }) {
  const { account, provider, onlyDte } = props
  return (
    <div className="mail-welcome">
      <span className="mail-welcome-icon">
        <ProviderIcon provider={provider} size={44} />
      </span>
      <h2>{onlyDte ? 'Tus correos con factura' : `Tu bandeja de ${PROVIDERS[provider].name}`}</h2>
      <p>
        {onlyDte
          ? 'Aquí están solo los correos que traen un DTE adjunto. Elige uno para leerlo como factura.'
          : 'Elige un correo de la lista para leerlo aquí.'}
      </p>
      <ul className="mail-tips">
        <li>
          <ReceiptIcon />
          <span>
            <strong>Documento</strong>
            La factura leída del JSON: emisor, detalle y totales.
          </span>
        </li>
        <li>
          <FilePdfIcon />
          <span>
            <strong>PDF</strong>
            La versión oficial, tal como la envió el emisor.
          </span>
        </li>
        <li>
          <PaperclipIcon />
          <span>
            <strong>Adjuntos</strong>
            Descárgalos o guárdalos en una carpeta de la nube.
          </span>
        </li>
      </ul>
      <small className="mail-account">
        Conectado a <b>{account}</b> · solo lectura
      </small>
    </div>
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
  // Nombres de los adjuntos de este correo que ya están guardados en la nube
  const [saved, setSaved] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    // Si la nube no está disponible, el correo se muestra igual.
    listFiles(id)
      .then((files) => alive && setSaved(files.map((file) => file.filename)))
      .catch(() => undefined)

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
          <WarningCircleIcon />
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
              <UserCircleIcon />
              {name}
            </span>
            <span>
              <EnvelopeSimpleIcon />
              {senderEmail(message.from)}
            </span>
            <span>
              <CalendarBlankIcon />
              {formatDate(message.date, true)}
            </span>
          </div>
        </div>
      </header>

      {attachments.length > 0 && (
        <ul className="attachments" aria-label="Archivos adjuntos">
          {attachments.map((file) => (
            <li key={file.index}>
              <AttachmentChip
                messageId={id}
                file={file}
                saved={saved.includes(file.filename)}
                onSaved={() => setSaved((names) => [...new Set([...names, file.filename])])}
                onSessionLost={onSessionLost}
              />
            </li>
          ))}
        </ul>
      )}

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'dte'} onClick={() => setChosen('dte')}>
          <ReceiptIcon />
          Documento
        </button>
        {pdf && (
          <button role="tab" aria-selected={tab === 'pdf'} onClick={() => setChosen('pdf')}>
            <FilePdfIcon />
            PDF
          </button>
        )}
        <button role="tab" aria-selected={tab === 'mail'} onClick={() => setChosen('mail')}>
          <EnvelopeSimpleIcon />
          Correo
        </button>
      </nav>

      {tab === 'dte' &&
        (dte ? (
          <DteView dte={dte} />
        ) : (
          <Blank icon={<ReceiptIcon />}>{dteNote}</Blank>
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

/* ---------- adjunto: descargar o guardar en la nube ---------- */

function AttachmentChip(props: {
  messageId: string
  file: Attachment
  saved: boolean
  onSaved: () => void
  onSessionLost: () => void
}) {
  const { messageId, file, saved, onSaved, onSessionLost } = props
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(folder: string | undefined) {
    setPicking(false)
    setSaving(true)
    setError('')
    try {
      await saveFile(messageId, file.index, folder)
      onSaved()
    } catch (err) {
      if (isUnauthorized(err)) onSessionLost()
      else setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="file">
      <Symbol
        name=""
        size={38}
        tone={isPdf(file) ? 'lavender' : isJson(file) ? 'mint' : 'sky'}
      >
        {isPdf(file) ? <FilePdfIcon /> : isJson(file) ? <BracketsCurlyIcon /> : <FileIcon />}
      </Symbol>
      <span className="file-info">
        <strong title={file.filename}>{file.filename}</strong>
        <small className={error ? 'file-error' : undefined}>{error || fileSize(file.size)}</small>
      </span>
      <a
        className="file-btn"
        href={attachmentUrl(messageId, file.index, true)}
        download={file.filename}
        title="Descargar"
        aria-label={`Descargar ${file.filename}`}
      >
        <DownloadSimpleIcon weight="bold" />
      </a>
      <button
        className={saved ? 'file-btn file-cloud done' : 'file-btn file-cloud'}
        onClick={() => setPicking(true)}
        disabled={saving}
        title={saved ? 'Ya está guardado. Toca para cambiarlo de carpeta.' : undefined}
      >
        <GoogleCloudIcon />
        {saving ? 'Guardando…' : saved ? 'Guardado en la nube' : 'Guardar en la nube'}
        {saved && !saving && <CheckCircleIcon weight="fill" className="file-ok" />}
      </button>

      {picking && (
        <FolderPicker
          title={saved ? 'Cambiar de carpeta' : '¿Dónde lo guardamos?'}
          confirm={saved ? 'Mover aquí' : 'Guardar aquí'}
          allowAuto
          onPick={save}
          onClose={() => setPicking(false)}
          onSessionLost={onSessionLost}
        />
      )}
    </div>
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
  body { margin: 0; padding: 20px; background: #fff; color: #151515;
         font: 14px/1.55 system-ui, 'Segoe UI', Roboto, sans-serif; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: #1a1a1a; }
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
    <Blank icon={<EnvelopeSimpleIcon />}>
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
      <div className="dte-actions">
        <a
          className="btn btn-light btn-sm"
          href={haciendaUrl(ident.ambiente, ident.codigoGeneracion, ident.fecEmi)}
          target="_blank"
          rel="noreferrer"
        >
          <ArrowSquareOutIcon />
          Verificar en Hacienda
        </a>
        <button className="btn btn-light btn-sm" onClick={() => window.print()}>
          <PrinterIcon />
          Imprimir
        </button>
      </div>
      <div className="dte-top">
        <div>
          <span className="dte-kicker">Documento tributario electrónico</span>
          <h3>{tipo}</h3>
          <div className="badges">
            {ident.ambiente === '00' && <span className="badge warning">Ambiente de pruebas</span>}
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
        <Field label="Sello de recepción" value={dte.selloRecibido} mono />
      </dl>

      <div className="parties">
        <Party title="Emisor" name={emisor.nombre} icon={<BuildingsIcon />} tone="lavender">
          <Field label="NIT" value={emisor.nit} mono />
          <Field label="NRC" value={emisor.nrc} mono />
        </Party>
        <Party title="Receptor" name={receptor.nombre} icon={<UserCircleIcon />} tone="mint">
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
    </div>
  )
}
