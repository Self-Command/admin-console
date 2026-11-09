'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  DownloadIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  UploadIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/page-header'
import { ErrorState, LoadingState } from '@/components/data-state'
import { useAuth } from '@/components/auth/auth-provider'
import { useWorkspace } from '@/components/layout/workspace-provider'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApprovalRequestDialog } from '@/components/security/approval-request-dialog'
import { hasPermission } from '@/lib/access'
import { AdminApiError } from '@/lib/api/admin-client'
import { resetAllApprovalDraft, type ApprovalRequestDraft } from '@/lib/approvals'
import { adminApiConfig } from '@/lib/config'
import { describeAdminError } from '@/lib/errors'
import { formatTimestamp } from '@/lib/format'
import { mergeNavigationWithDefaults } from '@/lib/navigation'
import { validateSectionValues } from '@/lib/runtime/validate-settings'
import type {
  LogoUploadResult,
  SettingMeta,
  SettingRevision,
  SettingSectionKey,
  SettingsExportResult,
  SettingsGetResult,
  SettingsImportResult,
  SettingsSections,
} from '@/lib/runtime/types'
import { HistoryDialog } from './history-dialog'
import { ImportDialog } from './import-dialog'
import { SectionFrame } from './section-frame'
import { SettingsPreview } from './settings-preview'
import {
  RUNTIME_SECTIONS,
  SETTING_SECTIONS,
  cloneSections,
  downloadTextFile,
  metaFor,
  normalizeSectionValues,
  sectionLabel,
  sectionMeta,
  settingsExportFilename,
  valuesEqual,
} from './settings-utils'
import { AppearanceSection } from './sections/appearance-section'
import {
  BrandingSection,
  readFileAsBase64,
} from './sections/branding-section'
import {
  AuditSection,
  FeaturesSection,
  IndexerSection,
  IntegrationsSection,
  UiSection,
} from './sections/general-sections'
import { LoginSection } from './sections/login-section'
import { NavigationSection } from './sections/navigation-section'

const SETTINGS_GET_NSID = 'com.selfcommand.admin.settings.get'
const SETTINGS_UPDATE_NSID = 'com.selfcommand.admin.settings.update'
const SETTINGS_RESET_NSID = 'com.selfcommand.admin.settings.reset'
const SETTINGS_EXPORT_NSID = 'com.selfcommand.admin.settings.export'
const LOGO_UPLOAD_NSID = 'com.selfcommand.admin.settings.logo.upload'

type LoadStatus = 'loading' | 'ready' | 'error'
type ResetTarget = SettingSectionKey | 'all'

type ResetResult = {
  settings: SettingsSections
  meta: SettingMeta[]
}

export function SettingsView() {
  const { identity, callAdmin } = useAuth()
  const { dateFormat, refresh: refreshWorkspace } = useWorkspace()
  const router = useRouter()
  const canWrite = hasPermission(identity, 'settings.write')

  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<SettingsGetResult | null>(null)
  const [drafts, setDrafts] = useState<SettingsSections | null>(null)
  const [active, setActive] = useState<SettingSectionKey>('branding')
  const [savingSection, setSavingSection] = useState<SettingSectionKey | null>(null)
  const [conflicts, setConflicts] = useState<Partial<Record<SettingSectionKey, boolean>>>({})
  const [historySection, setHistorySection] = useState<SettingSectionKey | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadedLogoUrl, setUploadedLogoUrl] = useState<string | undefined>()
  const [resetTarget, setResetTarget] = useState<ResetTarget | null>(null)
  const [resetting, setResetting] = useState(false)
  const [approvalDraft, setApprovalDraft] = useState<ApprovalRequestDraft | null>(null)

  const load = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      const result = await callAdmin<SettingsGetResult>(SETTINGS_GET_NSID)
      const settings = cloneSections(result.settings)
      settings.navigation = mergeNavigationWithDefaults(settings.navigation)
      setData({ ...result, settings })
      setDrafts(cloneSections(settings))
      setConflicts({})
      setUploadedLogoUrl(undefined)
      setStatus('ready')
    } catch (cause) {
      setError(describeAdminError(cause))
      setStatus('error')
    }
  }, [callAdmin])

  useEffect(() => {
    void load()
  }, [load])

  const isDirty = useCallback(
    (section: SettingSectionKey): boolean => {
      if (!data || !drafts) return false
      return !valuesEqual(drafts[section], data.settings[section])
    },
    [data, drafts],
  )

  const dirtySections = useMemo(
    () => (data && drafts ? SETTING_SECTIONS.filter((section) => isDirty(section)) : []),
    [data, drafts, isDirty],
  )

  useEffect(() => {
    if (dirtySections.length === 0) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirtySections.length])

  const patchDraft = useCallback(
    <K extends SettingSectionKey>(section: K, value: SettingsSections[K]) => {
      setDrafts((previous) =>
        previous
          ? ({ ...previous, [section]: value } as SettingsSections)
          : previous,
      )
    },
    [],
  )

  const applyFresh = useCallback((fresh: SettingsGetResult, section: SettingSectionKey) => {
    setData(fresh)
    setDrafts((previous) =>
      previous
        ? ({
            ...previous,
            [section]: structuredClone(fresh.settings[section]),
          } as SettingsSections)
        : cloneSections(fresh.settings),
    )
    setConflicts((previous) => ({ ...previous, [section]: false }))
  }, [])

  const saveSection = useCallback(
    async (section: SettingSectionKey): Promise<boolean> => {
      if (!data || !drafts || !canWrite) return false
      const normalized = normalizeSectionValues(section, drafts[section])
      const problems = validateSectionValues(section, normalized)
      if (problems.length > 0) {
        toast.error('请先修正当前分区中的问题后再保存。')
        return false
      }
      setSavingSection(section)
      try {
        await callAdmin<{ meta: SettingMeta }>(SETTINGS_UPDATE_NSID, {
          body: {
            section,
            values: normalized,
            expectedVersion: metaFor(data.meta, section)?.version ?? 0,
          },
        })
        const fresh = await callAdmin<SettingsGetResult>(SETTINGS_GET_NSID)
        applyFresh(fresh, section)
        toast.success(`「${sectionLabel(section)}」已保存。`)
        refreshWorkspace()
        if (RUNTIME_SECTIONS.has(section)) router.refresh()
        return true
      } catch (cause) {
        if (cause instanceof AdminApiError && cause.kind === 'conflict') {
          setConflicts((previous) => ({ ...previous, [section]: true }))
          toast.error('该分区已被其他管理员修改，请重新加载后再保存。')
        } else {
          toast.error(describeAdminError(cause))
        }
        return false
      } finally {
        setSavingSection(null)
      }
    },
    [callAdmin, canWrite, data, drafts, applyFresh, refreshWorkspace, router],
  )

  const reloadSection = useCallback(
    async (section: SettingSectionKey) => {
      try {
        const fresh = await callAdmin<SettingsGetResult>(SETTINGS_GET_NSID)
        setData(fresh)
        setDrafts((previous) =>
          previous
            ? ({
                ...previous,
                [section]: structuredClone(fresh.settings[section]),
              } as SettingsSections)
            : cloneSections(fresh.settings),
        )
        setConflicts((previous) => ({ ...previous, [section]: false }))
        toast.success('已重新加载该分区的最新设置。')
        refreshWorkspace()
      } catch (cause) {
        toast.error(describeAdminError(cause))
      }
    },
    [callAdmin, refreshWorkspace],
  )

  async function handleLogoUpload(file: File) {
    if (!canWrite) return
    if (isDirty('branding')) {
      const saved = await saveSection('branding')
      if (!saved) return
    }
    setUploading(true)
    try {
      const base64 = await readFileAsBase64(file)
      const result = await callAdmin<LogoUploadResult>(LOGO_UPLOAD_NSID, {
        body: { mime: file.type, data: base64 },
      })
      const fresh = await callAdmin<SettingsGetResult>(SETTINGS_GET_NSID)
      applyFresh(fresh, 'branding')
      setUploadedLogoUrl(`${adminApiConfig.url}${result.url}`)
      toast.success('Logo 已上传并保存，全站将使用新图片。')
      refreshWorkspace()
      router.refresh()
    } catch (cause) {
      toast.error(describeAdminError(cause))
    } finally {
      setUploading(false)
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const result = await callAdmin<SettingsExportResult>(SETTINGS_EXPORT_NSID)
      downloadTextFile(
        settingsExportFilename(),
        JSON.stringify(result, null, 2),
        'application/json',
      )
      toast.success('设置文件已导出。')
    } catch (cause) {
      toast.error(describeAdminError(cause))
    } finally {
      setExporting(false)
    }
  }

  function handleImported(result: SettingsImportResult) {
    setData((previous) =>
      previous
        ? { ...previous, settings: result.settings, meta: result.meta }
        : previous,
    )
    setDrafts((previous) => {
      if (!previous) return previous
      const next = { ...previous } as SettingsSections
      for (const section of result.changedSections) {
        ;(next as Record<string, unknown>)[section] = structuredClone(
          result.settings[section],
        )
      }
      return next
    })
    setConflicts({})
    toast.success(
      result.changedSections.length > 0
        ? `已导入 ${result.changedSections.length} 个分区。`
        : '导入完成，所有分区与当前设置一致，无需更新。',
    )
    refreshWorkspace()
    router.refresh()
  }

  async function handleRestore(revision: SettingRevision): Promise<boolean> {
    if (!data || !canWrite) return false
    const section = revision.section
    const normalized = normalizeSectionValues(section, revision.before)
    const problems = validateSectionValues(section, normalized)
    if (problems.length > 0) {
      toast.error('该版本的内容不符合当前校验规则，无法恢复。')
      return false
    }
    setSavingSection(section)
    try {
      await callAdmin<{ meta: SettingMeta }>(SETTINGS_UPDATE_NSID, {
        body: {
          section,
          values: normalized,
          expectedVersion: metaFor(data.meta, section)?.version ?? 0,
          reason: `恢复到版本 ${revision.version} 之前`,
        },
      })
      const fresh = await callAdmin<SettingsGetResult>(SETTINGS_GET_NSID)
      applyFresh(fresh, section)
      toast.success(`「${sectionLabel(section)}」已恢复到所选版本。`)
      refreshWorkspace()
      if (RUNTIME_SECTIONS.has(section)) router.refresh()
      return true
    } catch (cause) {
      if (cause instanceof AdminApiError && cause.kind === 'conflict') {
        setConflicts((previous) => ({ ...previous, [section]: true }))
        toast.error('该分区已被其他管理员修改，请重新加载后再恢复。')
      } else {
        toast.error(describeAdminError(cause))
      }
      return false
    } finally {
      setSavingSection(null)
    }
  }

  async function confirmReset() {
    const target = resetTarget
    if (!target) return
    setResetting(true)
    try {
      const result = await callAdmin<ResetResult>(SETTINGS_RESET_NSID, {
        body: target === 'all' ? {} : { section: target },
      })
      setData((previous) =>
        previous
          ? { ...previous, settings: result.settings, meta: result.meta }
          : previous,
      )
      setDrafts((previous) => {
        if (!previous) return previous
        if (target === 'all') return structuredClone(result.settings)
        const next = { ...previous } as SettingsSections
        ;(next as Record<string, unknown>)[target] = structuredClone(
          result.settings[target],
        )
        return next
      })
      setConflicts({})
      toast.success(
        target === 'all'
          ? '所有分区已恢复内置默认值。'
          : `「${sectionLabel(target)}」已恢复默认值。`,
      )
      refreshWorkspace()
      router.refresh()
    } catch (cause) {
      if (
        cause instanceof AdminApiError &&
        cause.code === 'ApprovalRequired' &&
        target === 'all'
      ) {
        setApprovalDraft(resetAllApprovalDraft())
      } else {
        toast.error(describeAdminError(cause))
      }
    } finally {
      setResetting(false)
      setResetTarget(null)
    }
  }

  const currentLogoUrl = useMemo(() => {
    if (!data) return undefined
    if (data.settings.branding.logoSource === 'upload') {
      return `${adminApiConfig.url}/branding/logo`
    }
    return undefined
  }, [data])

  function renderSection(section: SettingSectionKey) {
    if (!data || !drafts) return null
    const meta = metaFor(data.meta, section)
    const dirty = isDirty(section)
    const errors = dirty
      ? validateSectionValues(section, normalizeSectionValues(section, drafts[section]))
      : []

    let form: ReactNode = null
    switch (section) {
      case 'branding':
        form = (
          <BrandingSection
            value={drafts.branding}
            onChange={(next) => patchDraft('branding', next)}
            readOnly={!canWrite}
            uploading={uploading}
            uploadedLogoUrl={uploadedLogoUrl}
            currentLogoUrl={currentLogoUrl}
            onUploadLogo={handleLogoUpload}
          />
        )
        break
      case 'theme':
        form = (
          <AppearanceSection
            value={drafts.theme}
            onChange={(next) => patchDraft('theme', next)}
          />
        )
        break
      case 'login':
        form = (
          <LoginSection
            value={drafts.login}
            onChange={(next) => patchDraft('login', next)}
          />
        )
        break
      case 'navigation':
        form = (
          <NavigationSection
            value={drafts.navigation}
            onChange={(next) => patchDraft('navigation', next)}
          />
        )
        break
      case 'features':
        form = (
          <FeaturesSection
            value={drafts.features}
            onChange={(next) => patchDraft('features', next)}
          />
        )
        break
      case 'ui':
        form = (
          <UiSection value={drafts.ui} onChange={(next) => patchDraft('ui', next)} />
        )
        break
      case 'integrations':
        form = (
          <IntegrationsSection
            value={drafts.integrations}
            onChange={(next) => patchDraft('integrations', next)}
          />
        )
        break
      case 'audit':
        form = (
          <AuditSection
            value={drafts.audit}
            onChange={(next) => patchDraft('audit', next)}
          />
        )
        break
      case 'indexer':
        form = (
          <IndexerSection
            value={drafts.indexer}
            onChange={(next) => patchDraft('indexer', next)}
          />
        )
        break
    }

    const frame = (
      <SectionFrame
        title={sectionMeta(section).label}
        description={sectionMeta(section).description}
        meta={meta}
        updatedLabel={meta ? formatTimestamp(meta.updatedAt, dateFormat) : ''}
        dirty={dirty}
        readOnly={!canWrite}
        saving={savingSection === section}
        errors={errors}
        conflict={Boolean(conflicts[section])}
        onSave={() => void saveSection(section)}
        onDiscard={() => patchDraft(section, cloneSections(data.settings)[section])}
        onReset={() => setResetTarget(section)}
        onHistory={() => setHistorySection(section)}
        onReload={() => void reloadSection(section)}
      >
        {form}
      </SectionFrame>
    )

    if (RUNTIME_SECTIONS.has(section)) {
      return (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0">{frame}</div>
          <div className="xl:sticky xl:top-6">
            <SettingsPreview
              branding={drafts.branding}
              theme={drafts.theme}
              login={drafts.login}
              navigation={drafts.navigation}
              currentLogoUrl={currentLogoUrl}
              uploadedLogoUrl={uploadedLogoUrl}
            />
          </div>
        </div>
      )
    }
    return frame
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="系统设置"
        description="统一维护品牌、外观、登录页、导航与运营参数。保存后立即生效，每次修改都会记录版本历史与审计日志。"
        actions={
          <>
            {!canWrite ? <Badge variant="outline">只读权限</Badge> : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleExport()}
              disabled={status !== 'ready' || exporting}
            >
              {exporting ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
              导出设置
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setImportOpen(true)}
              disabled={status !== 'ready' || !canWrite}
            >
              <UploadIcon />
              导入设置
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setResetTarget('all')}
              disabled={status !== 'ready' || !canWrite}
            >
              <RotateCcwIcon />
              全部恢复默认
            </Button>
          </>
        }
      />

      {status === 'loading' ? (
        <div className="rounded-xl border bg-card">
          <LoadingState label="正在加载系统设置" />
        </div>
      ) : status === 'error' ? (
        <div className="rounded-xl border bg-card">
          <ErrorState
            title="系统设置加载失败"
            message={error ?? '无法读取系统设置，请稍后重试。'}
            onRetry={() => void load()}
          />
        </div>
      ) : data && drafts ? (
        <>
          {dirtySections.length > 0 ? (
            <div
              role="status"
              className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm"
            >
              <TriangleAlertIcon className="size-4 shrink-0 text-warning-foreground" />
              <p className="min-w-0 flex-1">
                以下分区有未保存的修改：
                {dirtySections.map(sectionLabel).join('、')}。离开页面前请保存或放弃更改。
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const first = dirtySections[0]
                  if (first) setActive(first)
                }}
              >
                前往处理
              </Button>
            </div>
          ) : null}

          <Tabs
            value={active}
            onValueChange={(value) => setActive(value as SettingSectionKey)}
            className="space-y-5"
          >
            <TabsList className="w-full justify-start overflow-x-auto">
              {SETTING_SECTIONS.map((section) => {
                const Icon = sectionMeta(section).icon
                return (
                  <TabsTrigger key={section} value={section} className="gap-1.5">
                    <Icon className="size-4" />
                    {sectionLabel(section)}
                    {isDirty(section) ? (
                      <span
                        aria-label="有未保存的修改"
                        className="size-1.5 rounded-full bg-warning"
                      />
                    ) : null}
                  </TabsTrigger>
                )
              })}
            </TabsList>

            {SETTING_SECTIONS.map((section) => (
              <TabsContent key={section} value={section}>
                {renderSection(section)}
              </TabsContent>
            ))}
          </Tabs>
        </>
      ) : null}

      <HistoryDialog
        open={historySection !== null}
        onOpenChange={(open) => {
          if (!open) setHistorySection(null)
        }}
        section={historySection ?? active}
        dateFormat={dateFormat}
        canWrite={canWrite}
        onRestore={handleRestore}
      />

      {drafts ? (
        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          current={drafts}
          onImported={handleImported}
        />
      ) : null}

      <AlertDialog
        open={resetTarget !== null}
        onOpenChange={(open) => {
          if (!open && !resetting) setResetTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {resetTarget === 'all'
                ? '将所有分区恢复默认值？'
                : `将「${resetTarget ? sectionLabel(resetTarget) : ''}」恢复默认值？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              恢复默认会立即覆盖当前设置，并生成新的版本记录与审计日志。当前未保存的修改将丢失；如需保留，请先导出设置。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void confirmReset()
              }}
              disabled={resetting}
            >
              {resetting ? <LoaderCircleIcon className="animate-spin" /> : null}
              恢复默认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ApprovalRequestDialog
        draft={approvalDraft}
        onClose={() => {
          setApprovalDraft(null)
          void load()
        }}
      />
    </div>
  )
}
