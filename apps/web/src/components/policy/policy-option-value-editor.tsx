'use client'

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const PRIORITY_LEVELS_KEY = 'tools.ozone.setting.priorityLevels'
const REPORT_PRIORITY_LEVELS_KEY = 'tools.ozone.setting.reportPriorityLevels'
const SEVERITY_LEVELS_KEY = 'tools.ozone.setting.severityLevels'
const PROTECTED_TAGS_KEY = 'tools.ozone.setting.protectedTags'
const LABEL_GROUPS_KEY = 'tools.ozone.setting.labelGroups'
const POLICY_LIST_KEY = 'tools.ozone.setting.policyList'

export const STRUCTURED_POLICY_KEYS: readonly string[] = [
  PRIORITY_LEVELS_KEY,
  REPORT_PRIORITY_LEVELS_KEY,
  SEVERITY_LEVELS_KEY,
  PROTECTED_TAGS_KEY,
  LABEL_GROUPS_KEY,
  POLICY_LIST_KEY,
]

const PRIORITY_ENTRY_FIELDS = ['name', 'description', 'targetResolutionMinutes', 'score'] as const
const SEVERITY_ENTRY_FIELDS = [
  'name',
  'description',
  'strikeCount',
  'strikeOnOccurrence',
  'firstOccurrenceStrikeCount',
  'needsTakedown',
  'expiryInDays',
  'contentEmailSummary',
  'accountEmailSummary',
] as const
const PROTECTED_TAG_FIELDS = ['moderators', 'roles'] as const
const LABEL_GROUP_FIELDS = ['labels', 'note', 'color'] as const
const POLICY_FIELDS = [
  'name',
  'description',
  'url',
  'emailSummary',
  'emailBullets',
  'emailExtraNotes',
  'severityLevels',
] as const
const POLICY_SEVERITY_FIELDS = ['description', 'isDefault', 'targetServices'] as const

const POLICY_SEVERITY_PLACEHOLDER = `{
  "标准": {
    "description": "请填写该严重度的说明。",
    "isDefault": true
  }
}`

const SEVERITY_NUMERIC_FIELDS = [
  { field: 'strikeCount', label: '累计记分次数' },
  { field: 'strikeOnOccurrence', label: '每次发生的记分次数' },
  { field: 'firstOccurrenceStrikeCount', label: '首次发生的记分次数' },
  { field: 'expiryInDays', label: '记分有效期（天）' },
] as const

type PolicyRecord = Record<string, unknown>

type EditorProps = {
  value: PolicyRecord
  onChange: (next: PolicyRecord) => void
}

export function isStructuredPolicyKey(key: string): boolean {
  return STRUCTURED_POLICY_KEYS.includes(key)
}

export function policyValueTemplate(key: string): Record<string, unknown> {
  switch (key) {
    case PRIORITY_LEVELS_KEY:
      return {
        新层级: { name: '新层级', targetResolutionMinutes: 60, score: 50 },
      }
    case REPORT_PRIORITY_LEVELS_KEY:
      return { 新举报原因: '新层级' }
    case SEVERITY_LEVELS_KEY:
      return { 新严重级别: { name: '新严重级别' } }
    case PROTECTED_TAGS_KEY:
      return {
        新保护标签: { roles: ['tools.ozone.team.defs#roleAdmin'] },
      }
    case LABEL_GROUPS_KEY:
      return { 新标签组: { labels: ['新标签'] } }
    case POLICY_LIST_KEY:
      return {
        新策略: {
          name: '新策略',
          description: '请填写该策略的适用范围。',
        },
      }
    default:
      return {}
  }
}

export function validatePolicyValue(key: string, value: unknown): string | null {
  if (!isStructuredPolicyKey(key)) return null
  if (!isPlainObject(value)) return '选项值必须是 JSON 对象。'

  switch (key) {
    case PRIORITY_LEVELS_KEY:
      return validatePriorityLevels(value)
    case REPORT_PRIORITY_LEVELS_KEY:
      return validateReportPriorityLevels(value)
    case SEVERITY_LEVELS_KEY:
      return validateSeverityLevels(value)
    case PROTECTED_TAGS_KEY:
      return validateProtectedTags(value)
    case LABEL_GROUPS_KEY:
      return validateLabelGroups(value)
    case POLICY_LIST_KEY:
      return validatePolicyList(value)
    default:
      return null
  }
}

export function PolicyOptionValueEditor({
  valueKey,
  value,
  onChange,
}: {
  valueKey: string
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}): ReactElement | null {
  if (!isStructuredPolicyKey(valueKey)) return null

  switch (valueKey) {
    case PRIORITY_LEVELS_KEY:
      return <PriorityLevelsEditor value={value} onChange={onChange} />
    case REPORT_PRIORITY_LEVELS_KEY:
      return <ReportPriorityLevelsEditor value={value} onChange={onChange} />
    case SEVERITY_LEVELS_KEY:
      return <SeverityLevelsEditor value={value} onChange={onChange} />
    case PROTECTED_TAGS_KEY:
      return <ProtectedTagsEditor value={value} onChange={onChange} />
    case LABEL_GROUPS_KEY:
      return <LabelGroupsEditor value={value} onChange={onChange} />
    case POLICY_LIST_KEY:
      return <PolicyListEditor value={value} onChange={onChange} />
    default:
      return null
  }
}

function PriorityLevelsEditor({ value, onChange }: EditorProps) {
  const idBase = useId()
  const entries = Object.entries(value)
  const duplicateNameSet = duplicateNames(value)

  function addEntry() {
    const key = uniqueName('新层级', Object.keys(value))
    const name = uniqueName('新层级', collectEntryNames(value))
    onChange({
      ...value,
      [key]: { name, targetResolutionMinutes: 60, score: 50 },
    })
  }

  return (
    <div className="space-y-4">
      <EditorHeader
        title="优先级层级"
        description="为每个优先级设置名称、目标处理时长与分值。目标处理时长以分钟为单位，分值范围为 0 到 100。"
        count={entries.length}
        countLabel="个层级"
        addLabel="添加层级"
        onAdd={addEntry}
      />
      {entries.length === 0 ? (
        <EmptyEntries message="尚未配置优先级层级。添加层级后，举报优先级映射才能引用对应的层级标识。" />
      ) : null}
      <div className="space-y-3">
        {entries.map(([entryKey, rawEntry], index) => {
          const entry = asRecord(rawEntry)
          const name = readText(entry, 'name')
          const nameError = !name.trim()
            ? '名称不能为空。'
            : duplicateNameSet.has(name.trim())
              ? '名称与其他层级重复，请使用不同名称。'
              : null
          const targetError = isIntegerAtLeast(entry.targetResolutionMinutes, 1)
            ? null
            : '目标处理时长必须是大于等于 1 的整数。'
          const scoreError = isIntegerBetween(entry.score, 0, 100)
            ? null
            : '分值必须是 0 到 100 之间的整数。'
          const unknown = unknownFields(entry, PRIORITY_ENTRY_FIELDS)

          return (
            <EntryCard
              key={entryKey}
              keyId={`${idBase}-key-${index}`}
              keyLabel="层级标识"
              entryKey={entryKey}
              existingKeys={Object.keys(value)}
              onRename={(nextKey) => onChange(renameEntry(value, entryKey, nextKey))}
              onRemove={() => onChange(removeEntry(value, entryKey))}
              removeLabel="删除层级"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  id={`${idBase}-name-${index}`}
                  label="层级名称"
                  value={name}
                  maxLength={64}
                  error={nameError}
                  onChange={(next) =>
                    onChange(changeEntryField(value, entryKey, 'name', next))
                  }
                />
                <NumberField
                  id={`${idBase}-target-${index}`}
                  label="目标处理时长（分钟）"
                  value={readNumber(entry, 'targetResolutionMinutes')}
                  error={targetError}
                  onChange={(next) =>
                    onChange(changeEntryField(value, entryKey, 'targetResolutionMinutes', next))
                  }
                />
                <NumberField
                  id={`${idBase}-score-${index}`}
                  label="优先级分值"
                  value={readNumber(entry, 'score')}
                  error={scoreError}
                  onChange={(next) =>
                    onChange(changeEntryField(value, entryKey, 'score', next))
                  }
                />
              </div>
              <TextField
                id={`${idBase}-description-${index}`}
                label="层级说明（可选）"
                value={readText(entry, 'description')}
                maxLength={1000}
                multiline
                error={optionalTextError(entry.description, '层级说明')}
                onChange={(next) =>
                  onChange(changeEntryField(value, entryKey, 'description', optionalText(next)))
                }
              />
              {unknown.length > 0 ? <UnknownFieldsAlert fields={unknown} /> : null}
            </EntryCard>
          )
        })}
      </div>
    </div>
  )
}

function ReportPriorityLevelsEditor({ value, onChange }: EditorProps) {
  const idBase = useId()
  const entries = Object.entries(value)

  function addEntry() {
    const key = uniqueName('新举报原因', Object.keys(value))
    onChange({ ...value, [key]: '新层级' })
  }

  return (
    <div className="space-y-4">
      <EditorHeader
        title="举报优先级映射"
        description="将举报原因映射到优先级层级。优先级标识需要与优先级层级中的键名一致，审核服务会在保存时校验。"
        count={entries.length}
        countLabel="条映射"
        addLabel="添加映射"
        onAdd={addEntry}
      />
      {entries.length === 0 ? (
        <EmptyEntries message="尚未配置举报优先级映射。添加映射后，举报原因会按对应优先级处理。" />
      ) : null}
      <div className="space-y-3">
        {entries.map(([entryKey, rawValue], index) => {
          const priorityValue = typeof rawValue === 'string' ? rawValue : ''
          const valueError = priorityValue.trim() ? null : '优先级标识不能为空。'

          return (
            <EntryCard
              key={entryKey}
              keyId={`${idBase}-key-${index}`}
              keyLabel="举报原因"
              entryKey={entryKey}
              existingKeys={Object.keys(value)}
              onRename={(nextKey) => onChange(renameEntry(value, entryKey, nextKey))}
              onRemove={() => onChange(removeEntry(value, entryKey))}
              removeLabel="删除映射"
            >
              <TextField
                id={`${idBase}-value-${index}`}
                label="优先级标识"
                value={priorityValue}
                hint="填写优先级层级中已有的键名。"
                error={valueError}
                onChange={(next) => onChange(setEntryValue(value, entryKey, next))}
              />
            </EntryCard>
          )
        })}
      </div>
    </div>
  )
}

function SeverityLevelsEditor({ value, onChange }: EditorProps) {
  const idBase = useId()
  const entries = Object.entries(value)
  const duplicateNameSet = duplicateNames(value)

  function addEntry() {
    const key = uniqueName('新严重级别', Object.keys(value))
    const name = uniqueName('新严重级别', collectEntryNames(value))
    onChange({ ...value, [key]: { name } })
  }

  return (
    <div className="space-y-4">
      <EditorHeader
        title="严重级别"
        description="定义严重级别的名称、记分规则与处置要求。数值字段留空表示不启用对应规则。"
        count={entries.length}
        countLabel="个级别"
        addLabel="添加严重级别"
        onAdd={addEntry}
      />
      {entries.length === 0 ? (
        <EmptyEntries message="尚未配置严重级别。添加严重级别后，处置与记分规则才能引用对应的级别标识。" />
      ) : null}
      <div className="space-y-3">
        {entries.map(([entryKey, rawEntry], index) => {
          const entry = asRecord(rawEntry)
          const name = readText(entry, 'name')
          const nameError = !name.trim()
            ? '名称不能为空。'
            : duplicateNameSet.has(name.trim())
              ? '名称与其他级别重复，请使用不同名称。'
              : null
          const needsTakedown = readBoolean(entry, 'needsTakedown')
          const needsTakedownError = optionalBooleanError(
            entry.needsTakedown,
            '需要下架内容标记',
          )
          const unknown = unknownFields(entry, SEVERITY_ENTRY_FIELDS)

          return (
            <EntryCard
              key={entryKey}
              keyId={`${idBase}-key-${index}`}
              keyLabel="级别标识"
              entryKey={entryKey}
              existingKeys={Object.keys(value)}
              onRename={(nextKey) => onChange(renameEntry(value, entryKey, nextKey))}
              onRemove={() => onChange(removeEntry(value, entryKey))}
              removeLabel="删除严重级别"
            >
              <TextField
                id={`${idBase}-name-${index}`}
                label="级别名称"
                value={name}
                maxLength={64}
                error={nameError}
                onChange={(next) =>
                  onChange(changeEntryField(value, entryKey, 'name', next))
                }
              />
              <TextField
                id={`${idBase}-description-${index}`}
                label="级别说明（可选）"
                value={readText(entry, 'description')}
                maxLength={1000}
                multiline
                error={optionalTextError(entry.description, '级别说明')}
                onChange={(next) =>
                  onChange(changeEntryField(value, entryKey, 'description', optionalText(next)))
                }
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {SEVERITY_NUMERIC_FIELDS.map(({ field, label }) => (
                  <NumberField
                    key={field}
                    id={`${idBase}-${field}-${index}`}
                    label={label}
                    value={readNumber(entry, field)}
                    error={
                      entry[field] !== undefined &&
                      entry[field] !== null &&
                      !isIntegerAtLeast(entry[field], 0)
                        ? `${label}必须是大于等于 0 的整数。`
                        : null
                    }
                    onChange={(next) =>
                      onChange(changeEntryField(value, entryKey, field, next))
                    }
                  />
                ))}
              </div>
              <div className="space-y-1.5 rounded-lg border bg-muted/20 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <Label htmlFor={`${idBase}-takedown-${index}`}>需要下架内容</Label>
                    <p className="text-xs text-muted-foreground">
                      开启后，命中该级别的处置会要求下架被举报内容。
                    </p>
                  </div>
                  <Switch
                    id={`${idBase}-takedown-${index}`}
                    checked={needsTakedown ?? false}
                    onCheckedChange={(next) =>
                      onChange(changeEntryField(value, entryKey, 'needsTakedown', next))
                    }
                  />
                </div>
                <FieldError
                  id={`${idBase}-takedown-${index}-error`}
                  message={needsTakedownError}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  id={`${idBase}-content-summary-${index}`}
                  label="内容通知摘要（可选）"
                  value={readText(entry, 'contentEmailSummary')}
                  maxLength={2000}
                  multiline
                  error={optionalTextError(entry.contentEmailSummary, '内容通知摘要')}
                  onChange={(next) =>
                    onChange(
                      changeEntryField(value, entryKey, 'contentEmailSummary', optionalText(next)),
                    )
                  }
                />
                <TextField
                  id={`${idBase}-account-summary-${index}`}
                  label="账号通知摘要（可选）"
                  value={readText(entry, 'accountEmailSummary')}
                  maxLength={2000}
                  multiline
                  error={optionalTextError(entry.accountEmailSummary, '账号通知摘要')}
                  onChange={(next) =>
                    onChange(
                      changeEntryField(value, entryKey, 'accountEmailSummary', optionalText(next)),
                    )
                  }
                />
              </div>
              {unknown.length > 0 ? <UnknownFieldsAlert fields={unknown} /> : null}
            </EntryCard>
          )
        })}
      </div>
    </div>
  )
}

function ProtectedTagsEditor({ value, onChange }: EditorProps) {
  const idBase = useId()
  const entries = Object.entries(value)

  function addEntry() {
    const key = uniqueName('新保护标签', Object.keys(value))
    onChange({
      ...value,
      [key]: { roles: ['tools.ozone.team.defs#roleAdmin'] },
    })
  }

  return (
    <div className="space-y-4">
      <EditorHeader
        title="保护标签"
        description="指定哪些审核员账号或管理角色可以处置带有该标签的内容。多个值用逗号分隔，保存时自动去除空格与空项。"
        count={entries.length}
        countLabel="个标签"
        addLabel="添加保护标签"
        onAdd={addEntry}
      />
      {entries.length === 0 ? (
        <EmptyEntries message="尚未配置保护标签。添加标签后，可指定哪些审核员或角色可以处置带有该标签的内容。" />
      ) : null}
      <div className="space-y-3">
        {entries.map(([entryKey, rawEntry], index) => {
          const entry = asRecord(rawEntry)
          const moderators = readStringArray(entry, 'moderators')
          const roles = readStringArray(entry, 'roles')
          const moderatorsError = moderatorsValueError(entry.moderators)
          const rolesError = rolesValueError(entry.roles)
          const unknown = unknownFields(entry, PROTECTED_TAG_FIELDS)

          return (
            <EntryCard
              key={entryKey}
              keyId={`${idBase}-key-${index}`}
              keyLabel="标签标识"
              entryKey={entryKey}
              existingKeys={Object.keys(value)}
              onRename={(nextKey) => onChange(renameEntry(value, entryKey, nextKey))}
              onRemove={() => onChange(removeEntry(value, entryKey))}
              removeLabel="删除保护标签"
            >
              <CommaListField
                id={`${idBase}-moderators-${index}`}
                label="审核员账号（可选）"
                value={moderators}
                placeholder="did:plc:…"
                hint="填写账号标识，多个值用逗号分隔。"
                error={moderatorsError}
                onChange={(next) =>
                  onChange(
                    changeEntryField(value, entryKey, 'moderators', emptyToUndefined(next)),
                  )
                }
              />
              <CommaListField
                id={`${idBase}-roles-${index}`}
                label="管理角色（可选）"
                value={roles}
                placeholder="tools.ozone.team.defs#roleAdmin"
                hint="填写角色标识，多个值用逗号分隔。"
                error={rolesError}
                onChange={(next) =>
                  onChange(changeEntryField(value, entryKey, 'roles', emptyToUndefined(next)))
                }
              />
              {moderators.length === 0 && roles.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  建议至少填写一个审核员账号或管理角色，否则审核服务会拒绝保存该标签配置。
                </p>
              ) : null}
              {unknown.length > 0 ? <UnknownFieldsAlert fields={unknown} /> : null}
            </EntryCard>
          )
        })}
      </div>
    </div>
  )
}

function LabelGroupsEditor({ value, onChange }: EditorProps) {
  const idBase = useId()
  const entries = Object.entries(value)

  function addEntry() {
    const key = uniqueName('新标签组', Object.keys(value))
    onChange({ ...value, [key]: { labels: ['新标签'] } })
  }

  return (
    <div className="space-y-4">
      <EditorHeader
        title="标签分组"
        description="按业务场景组织标签。每个分组至少包含一个标签，可设置分组说明与展示颜色。"
        count={entries.length}
        countLabel="个分组"
        addLabel="添加标签组"
        onAdd={addEntry}
      />
      {entries.length === 0 ? (
        <EmptyEntries message="尚未配置标签分组。添加分组后，可在标签管理中使用分组组织标签。" />
      ) : null}
      <div className="space-y-3">
        {entries.map(([entryKey, rawEntry], index) => {
          const entry = asRecord(rawEntry)
          const labels = readStringArray(entry, 'labels')
          const labelsError = labelListError(entry.labels)
          const colorError = labelColorError(entry.color)
          const unknown = unknownFields(entry, LABEL_GROUP_FIELDS)

          return (
            <EntryCard
              key={entryKey}
              keyId={`${idBase}-key-${index}`}
              keyLabel="分组标识"
              entryKey={entryKey}
              existingKeys={Object.keys(value)}
              onRename={(nextKey) => onChange(renameEntry(value, entryKey, nextKey))}
              onRemove={() => onChange(removeEntry(value, entryKey))}
              removeLabel="删除标签组"
            >
              <CommaListField
                id={`${idBase}-labels-${index}`}
                label="标签"
                value={labels}
                hint="多个标签用逗号分隔，至少填写一个。"
                error={labelsError}
                onChange={(next) =>
                  onChange(changeEntryField(value, entryKey, 'labels', emptyToUndefined(next)))
                }
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  id={`${idBase}-color-${index}`}
                  label="颜色（可选）"
                  value={readText(entry, 'color')}
                  placeholder="#1D4ED8"
                  maxLength={7}
                  error={colorError}
                  onChange={(next) =>
                    onChange(changeEntryField(value, entryKey, 'color', optionalText(next)))
                  }
                />
                <TextField
                  id={`${idBase}-note-${index}`}
                  label="分组说明（可选）"
                  value={readText(entry, 'note')}
                  maxLength={1000}
                  multiline
                  error={optionalTextError(entry.note, '分组说明')}
                  onChange={(next) =>
                    onChange(changeEntryField(value, entryKey, 'note', optionalText(next)))
                  }
                />
              </div>
              {unknown.length > 0 ? <UnknownFieldsAlert fields={unknown} /> : null}
            </EntryCard>
          )
        })}
      </div>
    </div>
  )
}

function PolicyListEditor({ value, onChange }: EditorProps) {
  const idBase = useId()
  const entries = Object.entries(value)
  const duplicateNameSet = duplicateNames(value)

  function addEntry() {
    const key = uniqueName('新策略', Object.keys(value))
    const name = uniqueName('新策略', collectEntryNames(value))
    onChange({
      ...value,
      [key]: { name, description: '请填写该策略的适用范围。' },
    })
  }

  return (
    <div className="space-y-4">
      <EditorHeader
        title="策略列表"
        description="维护策略的名称、说明与外部链接。严重度配置以 JSON 对象描述每个严重度的默认状态与适用范围。"
        count={entries.length}
        countLabel="条策略"
        addLabel="添加策略"
        onAdd={addEntry}
      />
      {entries.length === 0 ? (
        <EmptyEntries message="尚未配置策略。添加策略后，审核处置可引用策略说明与链接。" />
      ) : null}
      <div className="space-y-3">
        {entries.map(([entryKey, rawEntry], index) => {
          const entry = asRecord(rawEntry)
          const name = readText(entry, 'name')
          const nameError = !name.trim()
            ? '名称不能为空。'
            : duplicateNameSet.has(name.trim())
              ? '名称与其他策略重复，请使用不同名称。'
              : null
          const descriptionError = readText(entry, 'description').trim()
            ? null
            : '策略说明不能为空。'
          const urlError = httpUrlError(entry.url)
          const bulletsError = optionalTextError(entry.emailBullets, '邮件要点')
          const severityLevels = isPlainObject(entry.severityLevels)
            ? entry.severityLevels
            : undefined
          const severityLevelsTypeError =
            entry.severityLevels !== undefined &&
            entry.severityLevels !== null &&
            !isPlainObject(entry.severityLevels)
              ? '严重度配置不是有效的 JSON 对象。'
              : null
          const unknown = unknownFields(entry, POLICY_FIELDS)
          const bullets = readText(entry, 'emailBullets')

          return (
            <EntryCard
              key={entryKey}
              keyId={`${idBase}-key-${index}`}
              keyLabel="策略标识"
              entryKey={entryKey}
              existingKeys={Object.keys(value)}
              onRename={(nextKey) => onChange(renameEntry(value, entryKey, nextKey))}
              onRemove={() => onChange(removeEntry(value, entryKey))}
              removeLabel="删除策略"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  id={`${idBase}-name-${index}`}
                  label="策略名称"
                  value={name}
                  maxLength={64}
                  error={nameError}
                  onChange={(next) =>
                    onChange(changeEntryField(value, entryKey, 'name', next))
                  }
                />
                <TextField
                  id={`${idBase}-url-${index}`}
                  label="政策链接（可选）"
                  value={readText(entry, 'url')}
                  placeholder="https://"
                  maxLength={2048}
                  error={urlError}
                  onChange={(next) =>
                    onChange(changeEntryField(value, entryKey, 'url', optionalText(next)))
                  }
                />
              </div>
              <TextField
                id={`${idBase}-description-${index}`}
                label="策略说明"
                value={readText(entry, 'description')}
                maxLength={2000}
                multiline
                error={descriptionError}
                onChange={(next) =>
                  onChange(changeEntryField(value, entryKey, 'description', next))
                }
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  id={`${idBase}-email-summary-${index}`}
                  label="邮件摘要（可选）"
                  value={readText(entry, 'emailSummary')}
                  maxLength={4000}
                  multiline
                  error={optionalTextError(entry.emailSummary, '邮件摘要')}
                  onChange={(next) =>
                    onChange(changeEntryField(value, entryKey, 'emailSummary', optionalText(next)))
                  }
                />
                <TextField
                  id={`${idBase}-email-bullets-${index}`}
                  label="邮件要点（可选）"
                  value={bullets}
                  maxLength={4000}
                  multiline
                  error={bulletsError}
                  onChange={(next) =>
                    onChange(
                      changeEntryField(value, entryKey, 'emailBullets', optionalText(next)),
                    )
                  }
                />
              </div>
              <TextField
                id={`${idBase}-extra-notes-${index}`}
                label="邮件补充说明（可选）"
                value={readText(entry, 'emailExtraNotes')}
                maxLength={4000}
                multiline
                error={optionalTextError(entry.emailExtraNotes, '邮件补充说明')}
                onChange={(next) =>
                  onChange(changeEntryField(value, entryKey, 'emailExtraNotes', optionalText(next)))
                }
              />
              <JsonObjectField
                id={`${idBase}-severity-${index}`}
                label="严重度配置（JSON 对象）"
                value={severityLevels}
                error={severityLevelsTypeError}
                hint="键为严重度标识；每项需要填写说明并指定是否为默认，适用范围仅支持 appview（应用视图）与 pds（个人数据服务）。"
                onChange={(next) =>
                  onChange(changeEntryField(value, entryKey, 'severityLevels', next))
                }
              />
              {unknown.length > 0 ? <UnknownFieldsAlert fields={unknown} /> : null}
            </EntryCard>
          )
        })}
      </div>
    </div>
  )
}

function EditorHeader({
  title,
  description,
  count,
  countLabel,
  addLabel,
  onAdd,
}: {
  title: string
  description: string
  count: number
  countLabel: string
  addLabel: string
  onAdd: () => void
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <Badge variant="muted">
            {count} {countLabel}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={onAdd}
      >
        <PlusIcon />
        {addLabel}
      </Button>
    </div>
  )
}

function EmptyEntries({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
      {message}
    </div>
  )
}

function EntryCard({
  keyId,
  keyLabel,
  entryKey,
  existingKeys,
  onRename,
  onRemove,
  removeLabel,
  children,
}: {
  keyId: string
  keyLabel: string
  entryKey: string
  existingKeys: string[]
  onRename: (nextKey: string) => void
  onRemove: () => void
  removeLabel: string
  children: ReactNode
}) {
  return (
    <Card className="gap-4 py-4">
      <CardContent className="space-y-3 px-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <KeyField
              id={keyId}
              label={keyLabel}
              currentKey={entryKey}
              existingKeys={existingKeys}
              onRename={onRename}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-5 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            aria-label={`${removeLabel} ${entryKey}`}
          >
            <Trash2Icon />
            删除
          </Button>
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

function KeyField({
  id,
  label,
  currentKey,
  existingKeys,
  onRename,
}: {
  id: string
  label: string
  currentKey: string
  existingKeys: string[]
  onRename: (nextKey: string) => void
}) {
  const [draft, setDraft] = useState(currentKey)
  const [error, setError] = useState<string | null>(
    currentKey.trim() ? null : `${label}不能为空。`,
  )

  useEffect(() => {
    setDraft(currentKey)
    setError(currentKey.trim() ? null : `${label}不能为空。`)
  }, [currentKey, label])

  function commit() {
    const nextKey = draft.trim()
    if (!nextKey) {
      setError(`${label}不能为空。`)
      return
    }
    if (nextKey === currentKey) {
      setError(null)
      setDraft(currentKey)
      return
    }
    if (existingKeys.includes(nextKey)) {
      setError(`键名“${nextKey}”已存在，请更换名称。`)
      return
    }
    setError(null)
    onRename(nextKey)
  }

  const errorId = `${id}-error`

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          if (error) setError(null)
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
        }}
        className="font-mono text-xs"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      <FieldError id={errorId} message={error} />
    </div>
  )
}

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  multiline = false,
  maxLength,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  error?: string | null
  hint?: string
  placeholder?: string
  multiline?: boolean
  maxLength?: number
}) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  const sharedProps = {
    id,
    value,
    maxLength,
    placeholder,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': describedBy,
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea
          {...sharedProps}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-20"
        />
      ) : (
        <Input
          {...sharedProps}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
        />
      )}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  )
}

function CommaListField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  maxLength,
}: {
  id: string
  label: string
  value: string[]
  onChange: (next: string[]) => void
  error?: string | null
  hint?: string
  placeholder?: string
  maxLength?: number
}) {
  const joined = value.join(', ')
  const [draft, setDraft] = useState(joined)
  const lastEmitted = useRef(joined)

  useEffect(() => {
    const incoming = value.join(', ')
    if (incoming !== lastEmitted.current) {
      lastEmitted.current = incoming
      setDraft(incoming)
    }
  }, [value])

  function handleChange(text: string) {
    setDraft(text)
    const next = parseCommaList(text)
    lastEmitted.current = next.join(', ')
    onChange(next)
  }

  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={draft}
        onChange={(event) => handleChange(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  )
}

function NumberField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
}: {
  id: string
  label: string
  value: number | undefined
  onChange: (next: number | undefined) => void
  error?: string | null
  hint?: string
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  const [localError, setLocalError] = useState<string | null>(null)
  const lastEmitted = useRef<number | undefined>(value)

  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value
      setDraft(value === undefined ? '' : String(value))
      setLocalError(null)
    }
  }, [value])

  function handleChange(text: string) {
    setDraft(text)
    const trimmed = text.trim()
    if (!trimmed) {
      setLocalError(null)
      lastEmitted.current = undefined
      onChange(undefined)
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      setLocalError('请输入有效的数字。')
      return
    }
    setLocalError(null)
    lastEmitted.current = parsed
    onChange(parsed)
  }

  const resolvedError = localError ?? error ?? null
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy =
    [hint ? hintId : null, resolvedError ? errorId : null].filter(Boolean).join(' ') ||
    undefined

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={draft}
        onChange={(event) => handleChange(event.target.value)}
        inputMode="numeric"
        autoComplete="off"
        aria-invalid={resolvedError ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId} message={resolvedError} />
    </div>
  )
}

function JsonObjectField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
}: {
  id: string
  label: string
  value: PolicyRecord | undefined
  onChange: (next: PolicyRecord | undefined) => void
  error?: string | null
  hint?: string
}) {
  const initialText = value ? JSON.stringify(value, null, 2) : ''
  const [draft, setDraft] = useState(initialText)
  const [localError, setLocalError] = useState<string | null>(() =>
    value ? policySeverityLevelsError(value) : null,
  )
  const lastEmitted = useRef(value ? JSON.stringify(value) : '')

  useEffect(() => {
    const incoming = value ? JSON.stringify(value) : ''
    if (incoming !== lastEmitted.current) {
      lastEmitted.current = incoming
      setDraft(value ? JSON.stringify(value, null, 2) : '')
      setLocalError(value ? policySeverityLevelsError(value) : null)
    }
  }, [value])

  function handleChange(text: string) {
    setDraft(text)
    if (!text.trim()) {
      setLocalError(null)
      lastEmitted.current = ''
      onChange(undefined)
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setLocalError('严重度配置不是有效的 JSON 对象。')
      return
    }

    if (!isPlainObject(parsed)) {
      setLocalError('严重度配置不是有效的 JSON 对象。')
      return
    }

    setLocalError(policySeverityLevelsError(parsed))
    lastEmitted.current = JSON.stringify(parsed)
    onChange(parsed)
  }

  const resolvedError = error ?? localError
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy =
    [hint ? hintId : null, resolvedError ? errorId : null].filter(Boolean).join(' ') ||
    undefined

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={draft}
        onChange={(event) => handleChange(event.target.value)}
        placeholder={POLICY_SEVERITY_PLACEHOLDER}
        className="min-h-36 font-mono text-xs"
        spellCheck={false}
        aria-invalid={resolvedError ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId} message={resolvedError} />
    </div>
  )
}

function FieldError({ id, message }: { id: string; message: string | null | undefined }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  )
}

function UnknownFieldsAlert({ fields }: { fields: string[] }) {
  return (
    <p role="alert" className="text-xs text-destructive">
      存在无法识别的字段：{fields.join('、')}。请移除后再保存。
    </p>
  )
}

function validatePriorityLevels(value: PolicyRecord): string | null {
  const seenNames = new Set<string>()
  for (const [levelKey, rawEntry] of Object.entries(value)) {
    const label = `优先级层级“${levelKey}”`
    if (!levelKey.trim()) return '优先级层级的键名不能为空。'
    if (!isPlainObject(rawEntry)) return `${label}的配置必须是对象。`
    const unknown = unknownFields(rawEntry, PRIORITY_ENTRY_FIELDS)
    if (unknown.length > 0) {
      return `${label}包含无法识别的字段：${unknown.join('、')}。`
    }
    if (typeof rawEntry.name !== 'string' || !rawEntry.name.trim()) {
      return `${label}的名称不能为空。`
    }
    const name = rawEntry.name.trim()
    if (seenNames.has(name)) return `优先级层级名称“${name}”重复。`
    seenNames.add(name)
    if (
      rawEntry.description !== undefined &&
      rawEntry.description !== null &&
      typeof rawEntry.description !== 'string'
    ) {
      return `${label}的说明必须是文本。`
    }
    if (!isIntegerAtLeast(rawEntry.targetResolutionMinutes, 1)) {
      return `${label}的目标处理时长必须是大于等于 1 的整数。`
    }
    if (!isIntegerBetween(rawEntry.score, 0, 100)) {
      return `${label}的分值必须是 0 到 100 之间的整数。`
    }
  }
  return null
}

function validateReportPriorityLevels(value: PolicyRecord): string | null {
  for (const [reason, rawValue] of Object.entries(value)) {
    if (!reason.trim()) return '举报原因的键名不能为空。'
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      return `举报原因“${reason}”的优先级标识不能为空。`
    }
  }
  return null
}

function validateSeverityLevels(value: PolicyRecord): string | null {
  const seenNames = new Set<string>()
  for (const [levelKey, rawEntry] of Object.entries(value)) {
    const label = `严重级别“${levelKey}”`
    if (!levelKey.trim()) return '严重级别的键名不能为空。'
    if (!isPlainObject(rawEntry)) return `${label}的配置必须是对象。`
    const unknown = unknownFields(rawEntry, SEVERITY_ENTRY_FIELDS)
    if (unknown.length > 0) {
      return `${label}包含无法识别的字段：${unknown.join('、')}。`
    }
    if (typeof rawEntry.name !== 'string' || !rawEntry.name.trim()) {
      return `${label}的名称不能为空。`
    }
    const name = rawEntry.name.trim()
    if (seenNames.has(name)) return `严重级别名称“${name}”重复。`
    seenNames.add(name)
    if (
      rawEntry.description !== undefined &&
      rawEntry.description !== null &&
      typeof rawEntry.description !== 'string'
    ) {
      return `${label}的说明必须是文本。`
    }
    for (const { field, label: fieldLabel } of SEVERITY_NUMERIC_FIELDS) {
      const fieldValue = rawEntry[field]
      if (fieldValue === undefined || fieldValue === null) continue
      if (!isIntegerAtLeast(fieldValue, 0)) {
        return `${label}的${fieldLabel}必须是大于等于 0 的整数。`
      }
    }
    if (
      rawEntry.needsTakedown !== undefined &&
      rawEntry.needsTakedown !== null &&
      typeof rawEntry.needsTakedown !== 'boolean'
    ) {
      return `${label}的“需要下架内容”标记必须是布尔值。`
    }
    for (const [field, fieldLabel] of [
      ['contentEmailSummary', '内容通知摘要'],
      ['accountEmailSummary', '账号通知摘要'],
    ] as const) {
      if (
        rawEntry[field] !== undefined &&
        rawEntry[field] !== null &&
        typeof rawEntry[field] !== 'string'
      ) {
        return `${label}的${fieldLabel}必须是文本。`
      }
    }
  }
  return null
}

function validateProtectedTags(value: PolicyRecord): string | null {
  for (const [tagKey, rawEntry] of Object.entries(value)) {
    const label = `保护标签“${tagKey}”`
    if (!tagKey.trim()) return '保护标签的键名不能为空。'
    if (!isPlainObject(rawEntry)) return `${label}的配置必须是对象。`
    const unknown = unknownFields(rawEntry, PROTECTED_TAG_FIELDS)
    if (unknown.length > 0) {
      return `${label}包含无法识别的字段：${unknown.join('、')}。`
    }
    const moderatorsError = moderatorsValueError(rawEntry.moderators)
    if (moderatorsError) return `${label}${moderatorsError}`
    const rolesError = rolesValueError(rawEntry.roles)
    if (rolesError) return `${label}${rolesError}`
  }
  return null
}

function validateLabelGroups(value: PolicyRecord): string | null {
  for (const [groupKey, rawEntry] of Object.entries(value)) {
    const label = `标签组“${groupKey}”`
    if (!groupKey.trim()) return '标签组的键名不能为空。'
    if (!isPlainObject(rawEntry)) return `${label}的配置必须是对象。`
    const unknown = unknownFields(rawEntry, LABEL_GROUP_FIELDS)
    if (unknown.length > 0) {
      return `${label}包含无法识别的字段：${unknown.join('、')}。`
    }
    const labels = rawEntry.labels
    if (!Array.isArray(labels)) return `${label}的标签必须是字符串数组。`
    const usableLabels = labels.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    )
    if (usableLabels.length === 0) return `${label}至少需要一个标签。`
    if (usableLabels.length !== labels.length) return `${label}的标签不能包含空项。`
    if (
      rawEntry.note !== undefined &&
      rawEntry.note !== null &&
      typeof rawEntry.note !== 'string'
    ) {
      return `${label}的说明必须是文本。`
    }
    if (labelColorError(rawEntry.color)) return `${label}的颜色必须是 #RRGGBB 格式。`
  }
  return null
}

function validatePolicyList(value: PolicyRecord): string | null {
  const seenNames = new Set<string>()
  for (const [policyKey, rawEntry] of Object.entries(value)) {
    const label = `策略“${policyKey}”`
    if (!policyKey.trim()) return '策略的键名不能为空。'
    if (!isPlainObject(rawEntry)) return `${label}的配置必须是对象。`
    const unknown = unknownFields(rawEntry, POLICY_FIELDS)
    if (unknown.length > 0) {
      return `${label}包含无法识别的字段：${unknown.join('、')}。`
    }
    if (typeof rawEntry.name !== 'string' || !rawEntry.name.trim()) {
      return `${label}的名称不能为空。`
    }
    const name = rawEntry.name.trim()
    if (seenNames.has(name)) return `策略名称“${name}”重复。`
    seenNames.add(name)
    if (typeof rawEntry.description !== 'string' || !rawEntry.description.trim()) {
      return `${label}的说明不能为空。`
    }
    if (rawEntry.url !== undefined && rawEntry.url !== null) {
      if (httpUrlError(rawEntry.url)) {
        return `${label}的政策链接必须以 http:// 或 https:// 开头。`
      }
    }
    for (const [field, fieldLabel] of [
      ['emailSummary', '邮件摘要'],
      ['emailExtraNotes', '邮件补充说明'],
    ] as const) {
      if (
        rawEntry[field] !== undefined &&
        rawEntry[field] !== null &&
        typeof rawEntry[field] !== 'string'
      ) {
        return `${label}的${fieldLabel}必须是文本。`
      }
    }
    if (
      rawEntry.emailBullets !== undefined &&
      rawEntry.emailBullets !== null &&
      typeof rawEntry.emailBullets !== 'string'
    ) {
      return `${label}的邮件要点必须是文本。`
    }
    if (rawEntry.severityLevels !== undefined && rawEntry.severityLevels !== null) {
      if (!isPlainObject(rawEntry.severityLevels)) {
        return `${label}的严重度配置必须是 JSON 对象。`
      }
      const severityError = policySeverityLevelsError(rawEntry.severityLevels)
      if (severityError) return `${label}的${severityError}`
    }
  }
  return null
}

function policySeverityLevelsError(value: PolicyRecord): string | null {
  for (const [severityKey, rawEntry] of Object.entries(value)) {
    const label = `严重度“${severityKey}”`
    if (!severityKey.trim()) return '严重度标识不能为空。'
    if (!isPlainObject(rawEntry)) return `${label}的配置必须是对象。`
    const unknown = unknownFields(rawEntry, POLICY_SEVERITY_FIELDS)
    if (unknown.length > 0) {
      return `${label}包含无法识别的字段：${unknown.join('、')}。`
    }
    if (typeof rawEntry.description !== 'string' || !rawEntry.description.trim()) {
      return `${label}的说明不能为空。`
    }
    if (typeof rawEntry.isDefault !== 'boolean') {
      return `${label}的默认标记必须是布尔值。`
    }
    if (rawEntry.targetServices !== undefined && rawEntry.targetServices !== null) {
      if (!Array.isArray(rawEntry.targetServices)) {
        return `${label}的适用范围必须是数组。`
      }
      for (const service of rawEntry.targetServices) {
        if (service !== 'appview' && service !== 'pds') {
          return `${label}的适用范围只能填写 appview 或 pds。`
        }
      }
    }
  }
  return null
}

function isPlainObject(value: unknown): value is PolicyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): PolicyRecord {
  return isPlainObject(value) ? value : {}
}

function readText(record: PolicyRecord, field: string): string {
  const value = record[field]
  return typeof value === 'string' ? value : ''
}

function readNumber(record: PolicyRecord, field: string): number | undefined {
  const value = record[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readBoolean(record: PolicyRecord, field: string): boolean | undefined {
  const value = record[field]
  return typeof value === 'boolean' ? value : undefined
}

function readStringArray(record: PolicyRecord, field: string): string[] {
  const value = record[field]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function changeEntryField(
  record: PolicyRecord,
  entryKey: string,
  field: string,
  fieldValue: unknown,
): PolicyRecord {
  const entry = isPlainObject(record[entryKey]) ? record[entryKey] : {}
  const nextEntry: PolicyRecord = { ...entry }
  if (fieldValue === undefined) {
    delete nextEntry[field]
  } else {
    nextEntry[field] = fieldValue
  }
  return { ...record, [entryKey]: nextEntry }
}

function setEntryValue(
  record: PolicyRecord,
  entryKey: string,
  nextValue: unknown,
): PolicyRecord {
  return { ...record, [entryKey]: nextValue }
}

function renameEntry(record: PolicyRecord, oldKey: string, nextKey: string): PolicyRecord {
  const next: PolicyRecord = {}
  for (const [key, entry] of Object.entries(record)) {
    next[key === oldKey ? nextKey : key] = entry
  }
  return next
}

function removeEntry(record: PolicyRecord, entryKey: string): PolicyRecord {
  const next = { ...record }
  delete next[entryKey]
  return next
}

function collectEntryNames(record: PolicyRecord): string[] {
  const names: string[] = []
  for (const entry of Object.values(record)) {
    if (isPlainObject(entry) && typeof entry.name === 'string' && entry.name.trim()) {
      names.push(entry.name.trim())
    }
  }
  return names
}

function duplicateNames(record: PolicyRecord): Set<string> {
  const counts = new Map<string, number>()
  for (const name of collectEntryNames(record)) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const duplicates = new Set<string>()
  for (const [name, count] of counts) {
    if (count > 1) duplicates.add(name)
  }
  return duplicates
}

function uniqueName(base: string, existing: Iterable<string>): string {
  const used = new Set(existing)
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base}${index}`)) index += 1
  return `${base}${index}`
}

function unknownFields(record: PolicyRecord, allowed: readonly string[]): string[] {
  return Object.keys(record).filter((field) => !allowed.includes(field))
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isIntegerAtLeast(value: unknown, min: number): value is number {
  return isInteger(value) && value >= min
}

function isIntegerBetween(value: unknown, min: number, max: number): value is number {
  return isIntegerAtLeast(value, min) && value <= max
}

function optionalTextError(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return typeof value === 'string' ? null : `${label}必须是文本。`
}

function optionalBooleanError(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return typeof value === 'boolean' ? null : `${label}必须是布尔值。`
}

function moderatorsValueError(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) return '审核员账号必须是字符串数组。'
  if (value.some((item) => typeof item !== 'string' || !item.trim())) {
    return '审核员账号不能包含空项。'
  }
  if (value.some((item) => !item.startsWith('did:'))) {
    return '审核员账号必须以 did: 开头。'
  }
  return null
}

function rolesValueError(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) return '管理角色必须是字符串数组。'
  if (value.some((item) => typeof item !== 'string' || !item.trim())) {
    return '管理角色不能包含空项。'
  }
  return null
}

function labelListError(value: unknown): string | null {
  if (value === undefined || value === null) return '请至少填写一个标签。'
  if (!Array.isArray(value)) return '标签必须是字符串数组。'
  const usable = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  )
  if (usable.length === 0) return '请至少填写一个标签。'
  if (usable.length !== value.length) return '标签不能包含空项。'
  return null
}

function labelColorError(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    return '颜色必须是 #RRGGBB 格式。'
  }
  return null
}

function httpUrlError(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) {
    return '政策链接必须以 http:// 或 https:// 开头。'
  }
  return null
}

function parseCommaList(text: string): string[] {
  return text
    .split(/[,\uFF0C]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function emptyToUndefined(values: string[]): string[] | undefined {
  return values.length > 0 ? values : undefined
}

function optionalText(value: string): string | undefined {
  return value.trim() === '' ? undefined : value
}
