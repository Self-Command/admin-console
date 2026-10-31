'use client'

import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type {
  AuditSettings,
  FeatureSettings,
  IndexerSettings,
  IntegrationSettings,
  UiSettings,
} from '@/lib/runtime/types'

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  )
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} aria-label={title} onCheckedChange={onChange} />
    </div>
  )
}

const FEATURE_ROWS: Array<{
  key: keyof FeatureSettings
  title: string
  description: string
}> = [
  {
    key: 'auditExport',
    title: '审计日志导出',
    description: '在审计日志页显示 CSV 与 JSON 导出入口。关闭后入口隐藏，导出接口仍按角色权限校验。',
  },
  {
    key: 'roleBulk',
    title: '角色批量导入与导出',
    description: '在管理员与角色页显示批量导入、导出入口。关闭后只能逐个维护角色。',
  },
  {
    key: 'indexerControls',
    title: '索引器暂停与恢复',
    description: '在系统状态页显示索引器暂停与恢复按钮。关闭后仍可查看索引状态。',
  },
  {
    key: 'systemStatus',
    title: '系统状态入口',
    description: '在侧边栏显示系统状态入口。关闭后入口隐藏，拥有权限的管理员仍可直接访问该页面。',
  },
  {
    key: 'accountOperations',
    title: '账号运营记录',
    description: '在账号详情页显示运营备注、标签、暂停目录同步与导出操作。关闭后详情页只展示账号基础信息。',
  },
  {
    key: 'approvals',
    title: '双人审批',
    description: '在安全与审批页显示待审批事项，并在高风险操作前提示发起审批。关闭后入口隐藏，服务端仍会拦截需要审批的动作。',
  },
  {
    key: 'securityCenter',
    title: '访问安全入口',
    description: '在侧边栏显示安全与审批入口。关闭后入口隐藏，拥有权限的管理员仍可直接访问该页面。',
  },
  {
    key: 'dashboardTrends',
    title: '运营趋势看板',
    description: '在总览页显示 7 天、30 天与 90 天的账号与审计趋势。关闭后总览只展示当前快照数据。',
  },
]

export function FeaturesSection({
  value,
  onChange,
}: {
  value: FeatureSettings
  onChange: (next: FeatureSettings) => void
}) {
  return (
    <div className="space-y-3">
      {FEATURE_ROWS.map((row) => (
        <ToggleRow
          key={row.key}
          title={row.title}
          description={row.description}
          checked={value[row.key]}
          onChange={(checked) => onChange({ ...value, [row.key]: checked })}
        />
      ))}
      <p className="text-xs leading-relaxed text-muted-foreground">
        功能入口只控制界面显示，不会改变服务端权限。直接访问地址或调用接口时，仍按账号角色判定。
      </p>
    </div>
  )
}

export function UiSection({
  value,
  onChange,
}: {
  value: UiSettings
  onChange: (next: UiSettings) => void
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Field label="默认每页条数" hint="适用于账号目录、管理员与角色、审计日志列表，范围 1–100。用户可在个人资料中覆盖。">
        <Input
          type="number"
          min={1}
          max={100}
          value={value.pageSize}
          onChange={(event) => onChange({ ...value, pageSize: Number(event.target.value) })}
        />
      </Field>
      <Field label="默认日期格式" hint="列表与详情中的时间显示方式，用户可在个人资料中覆盖。">
        <Select
          value={value.dateFormat}
          onChange={(event) =>
            onChange({ ...value, dateFormat: event.target.value as UiSettings['dateFormat'] })
          }
        >
          <option value="date-time">日期与时间（例如 2026年10月29日 14:30）</option>
          <option value="date">仅日期（例如 2026年10月29日）</option>
        </Select>
      </Field>
    </div>
  )
}

export function IntegrationsSection({
  value,
  onChange,
}: {
  value: IntegrationSettings
  onChange: (next: IntegrationSettings) => void
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Field
        label="Ozone 审核后台地址"
        hint="用于在账号详情中打开对应的 Ozone 页面。必须是 https 地址；本地调试允许 localhost 的 http 地址。"
      >
        <Input
          value={value.ozoneUrl ?? ''}
          maxLength={512}
          className="font-mono text-xs"
          placeholder="https://ozone.example.com"
          onChange={(event) =>
            onChange({ ...value, ozoneUrl: event.target.value || undefined })
          }
        />
      </Field>
      <Field
        label="PDS 服务地址"
        hint="用于在账号详情中打开账号所在 PDS 的公开页面。留空时不显示该入口。"
      >
        <Input
          value={value.pdsUrl ?? ''}
          maxLength={512}
          className="font-mono text-xs"
          placeholder="https://pds.example.com"
          onChange={(event) => onChange({ ...value, pdsUrl: event.target.value || undefined })}
        />
      </Field>
      <p className="text-xs leading-relaxed text-muted-foreground md:col-span-2">
        这些地址只用于生成浏览器跳转链接，后台服务不会主动访问。账号目录中的 PDS 地址来自账号本身，与此处配置无关。
      </p>
    </div>
  )
}

export function AuditSection({
  value,
  onChange,
}: {
  value: AuditSettings
  onChange: (next: AuditSettings) => void
}) {
  return (
    <div className="space-y-5">
      <Field
        label="单次导出上限"
        hint="一次导出的最大记录数，范围 100–10000。超过上限时系统会拒绝导出并提示缩小时间范围。"
      >
        <Input
          type="number"
          min={100}
          max={10000}
          value={value.exportMaxRows}
          className="max-w-48"
          onChange={(event) =>
            onChange({ ...value, exportMaxRows: Number(event.target.value) })
          }
        />
      </Field>
      <div className="rounded-lg bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        导出文件包含操作者、动作、对象、结果与发生时间。导出操作本身也会写入审计日志。
      </div>
    </div>
  )
}

export function IndexerSection({
  value,
  onChange,
}: {
  value: IndexerSettings
  onChange: (next: IndexerSettings) => void
}) {
  return (
    <div className="space-y-5">
      <Field
        label="索引延迟提醒阈值"
        hint="索引超过该时长未更新时，总览与系统状态会显示提醒，范围 60–86400 秒（1 分钟到 24 小时）。"
      >
        <div className="flex max-w-64 items-center gap-2">
          <Input
            type="number"
            min={60}
            max={86400}
            value={value.lagWarningSeconds}
            onChange={(event) =>
              onChange({ ...value, lagWarningSeconds: Number(event.target.value) })
            }
          />
          <span className="shrink-0 text-xs text-muted-foreground">秒</span>
        </div>
      </Field>
      <p className="text-xs leading-relaxed text-muted-foreground">
        当前相当于 {Math.round(value.lagWarningSeconds / 60)} 分钟。该阈值只影响提醒展示，不会暂停索引器。
      </p>
    </div>
  )
}
