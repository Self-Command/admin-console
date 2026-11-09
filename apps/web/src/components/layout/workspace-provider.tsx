'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTheme } from 'next-themes'
import { useAuth } from '@/components/auth/auth-provider'
import { useBrand } from '@/components/brand/brand-provider'
import { hasPermission } from '@/lib/access'
import { describeAdminError } from '@/lib/errors'
import { resolveNavigation, mergeNavigationWithDefaults, type ResolvedNavGroup } from '@/lib/navigation'
import {
  DEFAULT_FEATURES,
  DEFAULT_NAVIGATION,
  DEFAULT_UI,
} from '@/lib/runtime/defaults'
import type {
  Density,
  DateFormat,
  FeatureSettings,
  NavGroupConfig,
  NavigationSettings,
  Preferences,
  SettingsGetResult,
  UiSettings,
} from '@/lib/runtime/types'

const NAVIGATION_NSID = 'com.selfcommand.admin.navigation.get'
const PREFERENCES_GET_NSID = 'com.selfcommand.admin.preferences.get'
const PREFERENCES_UPDATE_NSID = 'com.selfcommand.admin.preferences.update'
const SETTINGS_GET_NSID = 'com.selfcommand.admin.settings.get'

type NavigationResponse = {
  groups: NavGroupConfig[]
  features: FeatureSettings
  version: number
}

type PreferencesResponse = {
  preferences: Preferences
}

export type WorkspaceStatus = 'idle' | 'loading' | 'ready'

type WorkspaceContextValue = {
  status: WorkspaceStatus
  error: string | null
  groups: ResolvedNavGroup[]
  features: FeatureSettings
  preferences: Preferences
  density: Density
  pageSize: number
  dateFormat: DateFormat
  savingPreferences: boolean
  savePreferences: (patch: Partial<Preferences>) => Promise<boolean>
  refresh: () => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

function preferenceCacheKey(did: string): string {
  return `selfcommand.admin.preferences.${did}`
}

function readPreferenceCache(did: string): Preferences {
  try {
    const raw = window.localStorage.getItem(preferenceCacheKey(did))
    if (!raw) return {}
    const value = JSON.parse(raw) as Record<string, unknown>
    const preferences: Preferences = {}
    if (value.themeMode === 'light' || value.themeMode === 'dark' || value.themeMode === 'system') {
      preferences.themeMode = value.themeMode
    }
    if (value.density === 'comfortable' || value.density === 'compact') {
      preferences.density = value.density
    }
    if (Number.isInteger(value.pageSize)) preferences.pageSize = value.pageSize as number
    if (value.dateFormat === 'date-time' || value.dateFormat === 'date') {
      preferences.dateFormat = value.dateFormat
    }
    return preferences
  } catch {
    return {}
  }
}

function writePreferenceCache(did: string, preferences: Preferences): void {
  try {
    window.localStorage.setItem(preferenceCacheKey(did), JSON.stringify(preferences))
  } catch {
    // Local storage can be unavailable in private browsing; the server copy still applies.
  }
}

function isFeatureSettings(value: unknown): value is FeatureSettings {
  return Boolean(value) && typeof value === 'object'
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { identity, callAdmin } = useAuth()
  const { settings } = useBrand()
  const { setTheme } = useTheme()
  const [navigation, setNavigation] = useState<NavigationSettings>(DEFAULT_NAVIGATION)
  const [features, setFeatures] = useState<FeatureSettings>(DEFAULT_FEATURES)
  const [preferences, setPreferences] = useState<Preferences>({})
  const [uiDefaults, setUiDefaults] = useState<UiSettings>(DEFAULT_UI)
  const [status, setStatus] = useState<WorkspaceStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  const callAdminRef = useRef(callAdmin)
  useEffect(() => {
    callAdminRef.current = callAdmin
  }, [callAdmin])

  const preferencesRef = useRef(preferences)
  preferencesRef.current = preferences

  const did = identity?.did ?? null
  const canReadSettings = hasPermission(identity, 'settings.read')

  useEffect(() => {
    if (!did) {
      setStatus('idle')
      setNavigation(DEFAULT_NAVIGATION)
      setFeatures(DEFAULT_FEATURES)
      setPreferences({})
      setUiDefaults(DEFAULT_UI)
      setError(null)
      return
    }

    let cancelled = false
    setStatus('loading')
    setError(null)

    const currentDid = did
    const cached = readPreferenceCache(currentDid)
    if (Object.keys(cached).length > 0) setPreferences(cached)

    async function load() {
      const [navigationResult, preferencesResult, settingsResult] = await Promise.allSettled([
        callAdminRef.current<NavigationResponse>(NAVIGATION_NSID),
        callAdminRef.current<PreferencesResponse>(PREFERENCES_GET_NSID),
        canReadSettings
          ? callAdminRef.current<SettingsGetResult>(SETTINGS_GET_NSID)
          : Promise.resolve(null),
      ])
      if (cancelled) return

      if (navigationResult.status === 'fulfilled') {
        const value = navigationResult.value
        if (Array.isArray(value.groups) && isFeatureSettings(value.features)) {
          setNavigation(mergeNavigationWithDefaults({ groups: value.groups }))
          setFeatures(value.features)
        }
      }

      if (preferencesResult.status === 'fulfilled') {
        const value = preferencesResult.value.preferences ?? {}
        setPreferences(value)
        writePreferenceCache(currentDid, value)
      }

      if (settingsResult.status === 'fulfilled' && settingsResult.value) {
        setUiDefaults(settingsResult.value.settings.ui)
      }

      if (
        navigationResult.status === 'rejected' ||
        preferencesResult.status === 'rejected'
      ) {
        setError('部分界面配置未能加载，已使用本地默认值。')
      }
      setStatus('ready')
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [did, canReadSettings, reloadToken])

  const resolvedDensity = preferences.density ?? settings.theme.density
  const themeMode = preferences.themeMode ?? settings.theme.defaultMode

  useEffect(() => {
    if (!did) return
    setTheme(themeMode)
  }, [did, themeMode, setTheme])

  useEffect(() => {
    if (!did) return
    document.documentElement.dataset.density = resolvedDensity
  }, [did, resolvedDensity])

  const savePreferences = useCallback(
    async (patch: Partial<Preferences>) => {
      if (!did) return false
      const merged: Preferences = { ...preferencesRef.current, ...patch }
      setPreferences(merged)
      writePreferenceCache(did, merged)
      setSaving(true)
      setError(null)
      try {
        const result = await callAdminRef.current<PreferencesResponse>(
          PREFERENCES_UPDATE_NSID,
          { body: { preferences: merged } },
        )
        setPreferences(result.preferences)
        writePreferenceCache(did, result.preferences)
        return true
      } catch (cause) {
        setError(describeAdminError(cause))
        return false
      } finally {
        setSaving(false)
      }
    },
    [did],
  )

  const refresh = useCallback(() => setReloadToken((token) => token + 1), [])

  const groups = useMemo(
    () => resolveNavigation(navigation, features, identity),
    [navigation, features, identity],
  )

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      status,
      error,
      groups,
      features,
      preferences,
      density: resolvedDensity,
      pageSize: preferences.pageSize ?? uiDefaults.pageSize,
      dateFormat: preferences.dateFormat ?? uiDefaults.dateFormat,
      savingPreferences: saving,
      savePreferences,
      refresh,
    }),
    [
      status,
      error,
      groups,
      features,
      preferences,
      resolvedDensity,
      uiDefaults,
      saving,
      savePreferences,
      refresh,
    ],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return context
}
