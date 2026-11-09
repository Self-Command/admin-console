import type { AccountStatus } from '@/lib/data/types'

export type LogoSource = 'icon' | 'url' | 'upload'
export type ThemeMode = 'light' | 'dark' | 'system'
export type Density = 'comfortable' | 'compact'
export type DateFormat = 'date-time' | 'date'
export type FontFamily = 'sans' | 'serif'
export type LoginBackground = 'gradient' | 'solid' | 'none'

export type LegalLink = {
  label: string
  url: string
}

export type RuntimeBranding = {
  name: string
  shortName: string
  description: string
  logoSource: LogoSource
  logoUrl?: string
  faviconUrl?: string
  supportUrl?: string
  docsUrl?: string
}

export type RuntimeTheme = {
  primaryLight: string
  primaryDark: string
  accentLight: string
  accentDark: string
  radius: number
  density: Density
  fontFamily: FontFamily
  defaultMode: ThemeMode
}

export type RuntimeLogin = {
  headline: string
  subheadline: string
  footer: string
  background: LoginBackground
  legalLinks: LegalLink[]
}

export type PublicSettings = {
  branding: RuntimeBranding
  theme: RuntimeTheme
  login: RuntimeLogin
  version: number
  updatedAt?: string
}

export type FeatureSettings = {
  auditExport: boolean
  roleBulk: boolean
  indexerControls: boolean
  systemStatus: boolean
  accountOperations: boolean
  approvals: boolean
  securityCenter: boolean
  dashboardTrends: boolean
}

export type UiSettings = {
  pageSize: number
  dateFormat: DateFormat
}

export type SavedView = {
  id: string
  name: string
  search?: string
  status?: AccountStatus
  sort?: 'did' | 'handle' | 'status' | 'indexedAt'
  order?: 'asc' | 'desc'
}

export type FilterMacroScope = 'reports' | 'events'

export type FilterMacroSubjectType = 'account' | 'record' | 'message' | 'conversation'

export type FilterMacroReportStatus = 'open' | 'closed' | 'escalated' | 'queued' | 'assigned'

export type FilterMacroFilters = {
  subject?: string
  subjectType?: FilterMacroSubjectType
  status?: FilterMacroReportStatus
  queue?: string
  actor?: string
  keyword?: string
  types?: string[]
  hasComment?: boolean
  direction?: 'asc' | 'desc'
  batchId?: string
}

export type FilterMacro = {
  id: string
  name: string
  scope: FilterMacroScope
  isDefault?: boolean
  filters?: FilterMacroFilters
}

export type Preferences = {
  themeMode?: ThemeMode
  density?: Density
  pageSize?: number
  dateFormat?: DateFormat
  savedViews?: SavedView[]
  filterMacros?: FilterMacro[]
}

export type NavItemConfig = {
  id: string
  label?: string
  href?: string
  icon?: string
  hidden: boolean
}

export type NavGroupConfig = {
  id: string
  label: string
  items: NavItemConfig[]
}

export type NavigationSettings = {
  groups: NavGroupConfig[]
}

export type IntegrationSettings = {
  ozoneUrl?: string
  pdsUrl?: string
}

export type AuditSettings = {
  exportMaxRows: number
}

export type IndexerSettings = {
  lagWarningSeconds: number
}

export type SettingSectionKey =
  | 'branding'
  | 'theme'
  | 'login'
  | 'navigation'
  | 'features'
  | 'ui'
  | 'integrations'
  | 'audit'
  | 'indexer'

export type SettingsSections = {
  branding: RuntimeBranding
  theme: RuntimeTheme
  login: RuntimeLogin
  navigation: NavigationSettings
  features: FeatureSettings
  ui: UiSettings
  integrations: IntegrationSettings
  audit: AuditSettings
  indexer: IndexerSettings
}

export type SettingMeta = {
  section: SettingSectionKey
  version: number
  updatedAt: string
  updatedBy?: string
}

export type SettingRevision = {
  id: number
  section: SettingSectionKey
  version: number
  actor: string
  reason?: string
  requestId?: string
  createdAt: string
  before: unknown
  after: unknown
}

export type SettingsGetResult = {
  settings: SettingsSections
  defaults: SettingsSections
  meta: SettingMeta[]
}

export type SettingsHistoryResult = {
  revisions: SettingRevision[]
  total: number
  cursor?: string
}

export type SettingsExportResult = {
  exportedAt: string
  sections: SettingsSections
  meta: SettingMeta[]
}

export type SettingsImportResult = {
  settings: SettingsSections
  meta: SettingMeta[]
  changedSections: SettingSectionKey[]
}

export type LogoUploadResult = {
  url: string
  version: number
  updatedAt: string
}
