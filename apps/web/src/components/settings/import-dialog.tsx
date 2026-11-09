'use client'

import { useEffect, useState, type ChangeEvent } from 'react'
import { FileUpIcon, LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react'
import { useAuth } from '@/components/auth/auth-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { describeAdminError } from '@/lib/errors'
import { validateSectionValues } from '@/lib/runtime/validate-settings'
import type {
  SettingSectionKey,
  SettingsImportResult,
  SettingsSections,
} from '@/lib/runtime/types'
import { normalizeSectionValues, sectionLabel, SETTING_SECTIONS } from './settings-utils'

const IMPORT_NSID = 'com.selfcommand.admin.settings.import'
const MAX_IMPORT_BYTES = 1024 * 1024
const META_KEYS = new Set(['exportedAt', 'meta'])

const REQUIRED_KEYS: Record<SettingSectionKey, readonly string[]> = {
  branding: ['name', 'shortName', 'description', 'logoSource'],
  theme: [
    'primaryLight',
    'primaryDark',
    'accentLight',
    'accentDark',
    'radius',
    'density',
    'fontFamily',
    'defaultMode',
  ],
  login: ['headline', 'subheadline', 'footer', 'background', 'legalLinks'],
  navigation: ['groups'],
  features: ['auditExport', 'roleBulk', 'indexerControls', 'systemStatus'],
  ui: ['pageSize', 'dateFormat'],
  integrations: [],
  audit: ['exportMaxRows'],
  indexer: ['lagWarningSeconds'],
}

const ALLOWED_KEYS: Record<SettingSectionKey, readonly string[]> = {
  branding: [
    'name',
    'shortName',
    'description',
    'logoSource',
    'logoUrl',
    'faviconUrl',
    'supportUrl',
    'docsUrl',
  ],
  theme: REQUIRED_KEYS.theme,
  login: REQUIRED_KEYS.login,
  navigation: ['groups'],
  features: REQUIRED_KEYS.features,
  ui: REQUIRED_KEYS.ui,
  integrations: ['ozoneUrl', 'pdsUrl'],
  audit: ['exportMaxRows'],
  indexer: ['lagWarningSeconds'],
}

export type ParsedImport = {
  sections: Partial<SettingsSections>
  fileError: string | null
  sectionErrors: Array<{ section: SettingSectionKey; messages: string[] }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeSection(
  section: SettingSectionKey,
  current: SettingsSections[SettingSectionKey],
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const complete = REQUIRED_KEYS[section].every((key) => incoming[key] !== undefined)
  if (complete) return incoming
  return { ...(current as Record<string, unknown>), ...incoming }
}

/**
 * Accepts either an exported document (`{ exportedAt, sections, meta }`) or a
 * bare settings object. Partitions containing every required field replace the
 * current value; partial partitions are merged so small hand-written files work.
 */
export function parseSettingsDocument(text: string, current: SettingsSections): ParsedImport {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { sections: {}, fileError: '文件不是有效的 JSON，请重新导出后再试。', sectionErrors: [] }
  }
  if (!isRecord(raw)) {
    return { sections: {}, fileError: '文件内容必须是 JSON 对象。', sectionErrors: [] }
  }

  let source: Record<string, unknown>
  if (raw.sections !== undefined) {
    if (!isRecord(raw.sections)) {
      return {
        sections: {},
        fileError: '文件中的 sections 字段必须是对象。',
        sectionErrors: [],
      }
    }
    source = raw.sections
  } else {
    source = raw
  }

  const incomingKeys = Object.keys(source).filter(
    (key) => !(raw.sections === undefined && META_KEYS.has(key)),
  )
  const unknown = incomingKeys.filter(
    (key) => !(SETTING_SECTIONS as readonly string[]).includes(key),
  )
  if (unknown.length > 0) {
    return {
      sections: {},
      fileError: `文件包含无法识别的分区：${unknown.join('、')}。`,
      sectionErrors: [],
    }
  }
  if (incomingKeys.length === 0) {
    return {
      sections: {},
      fileError: '文件中没有可识别的设置分区。',
      sectionErrors: [],
    }
  }

  const sections: Partial<SettingsSections> = {}
  const sectionErrors: ParsedImport['sectionErrors'] = []

  for (const key of incomingKeys as SettingSectionKey[]) {
    const rawSection = source[key]
    if (!isRecord(rawSection)) {
      sectionErrors.push({ section: key, messages: ['该分区必须是对象。'] })
      continue
    }
    const stray = Object.keys(rawSection).filter(
      (field) => !ALLOWED_KEYS[key].includes(field),
    )
    if (stray.length > 0) {
      sectionErrors.push({
        section: key,
        messages: [`包含无法识别的字段：${stray.join('、')}。`],
      })
      continue
    }
    const normalized = normalizeSectionValues(
      key,
      mergeSection(key, current[key], rawSection),
    )
    const messages = validateSectionValues(key, normalized)
    if (messages.length > 0) {
      sectionErrors.push({ section: key, messages })
      continue
    }
    ;(sections as Record<string, unknown>)[key] = normalized
  }

  return { sections, fileError: null, sectionErrors }
}

export function ImportDialog({
  open,
  onOpenChange,
  current,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  current: SettingsSections
  onImported: (result: SettingsImportResult) => void
}) {
  const { callAdmin } = useAuth()
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [reading, setReading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setFileName(null)
      setParsed(null)
      setReading(false)
      setSubmitting(false)
      setSubmitError(null)
    }
  }, [open])

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFileName(file.name)
    setSubmitError(null)
    if (file.size > MAX_IMPORT_BYTES) {
      setParsed({ sections: {}, fileError: '文件不能超过 1 MB。', sectionErrors: [] })
      return
    }
    setReading(true)
    try {
      const text = await file.text()
      setParsed(parseSettingsDocument(text, current))
    } catch {
      setParsed({
        sections: {},
        fileError: '无法读取文件内容，请重新选择。',
        sectionErrors: [],
      })
    } finally {
      setReading(false)
    }
  }

  const count = parsed ? Object.keys(parsed.sections).length : 0
  const canSubmit =
    Boolean(parsed) &&
    !parsed?.fileError &&
    (parsed?.sectionErrors.length ?? 1) === 0 &&
    count > 0 &&
    !submitting

  async function submit() {
    if (!parsed || count === 0) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await callAdmin<SettingsImportResult>(IMPORT_NSID, {
        body: {
          sections: parsed.sections,
          reason: '从设置文件导入',
        },
      })
      onImported(result)
      onOpenChange(false)
    } catch (cause) {
      setSubmitError(describeAdminError(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>导入设置</DialogTitle>
          <DialogDescription>
            选择一个此前导出的 JSON 文件，或包含设置分区的 JSON 对象。导入会写入文件中出现的分区，未出现的分区保持不变。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-xs leading-relaxed">
            <div className="flex items-start gap-2">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <p>
                导入会覆盖对应分区的当前值与未保存的修改，并写入审计日志。建议先导出当前设置作为备份。
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Input
              type="file"
              accept="application/json,.json"
              aria-label="选择设置文件"
              onChange={handleFile}
            />
            <p className="text-xs text-muted-foreground">
              仅支持 JSON 文件，最大 1 MB。{fileName ? `已选择：${fileName}` : '尚未选择文件。'}
            </p>
          </div>

          {reading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" />
              正在读取文件
            </p>
          ) : null}

          {parsed?.fileError ? (
            <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {parsed.fileError}
            </p>
          ) : null}

          {parsed && !parsed.fileError && parsed.sectionErrors.length > 0 ? (
            <div role="alert" className="space-y-2 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3">
              <p className="text-sm font-medium text-destructive">文件中有无法导入的内容</p>
              {parsed.sectionErrors.map((item) => (
                <div key={item.section} className="text-xs text-destructive">
                  <p className="font-medium">{sectionLabel(item.section)}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {item.messages.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}

          {parsed && !parsed.fileError && parsed.sectionErrors.length === 0 && count > 0 ? (
            <div className="rounded-lg border bg-muted/30 px-4 py-3">
              <p className="text-sm font-medium">将导入 {count} 个分区</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {(Object.keys(parsed.sections) as SettingSectionKey[])
                  .map((key) => sectionLabel(key))
                  .join('、')}
              </p>
            </div>
          ) : null}

          {submitError ? (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? <LoaderCircleIcon className="animate-spin" /> : <FileUpIcon />}
            导入设置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
