'use client'

import { useEffect, useState } from 'react'
import { AlertTriangleIcon, RefreshCwIcon, TagsIcon } from 'lucide-react'
import { ErrorState, LoadingState } from '@/components/data-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDataProvider } from '@/lib/data/use-data-provider'
import type { LabelerConfig } from '@/lib/data/types'
import { describeAdminError } from '@/lib/errors'

type LoadStatus = 'loading' | 'ready' | 'error'

type LabelDefinition = {
  identifier: string
  name?: string
  description?: string
  severity?: string
  blurs?: string
  defaultSetting?: string
  adultOnly: boolean
}

const SEVERITY_LABELS: Record<string, string> = {
  inform: '提示',
  alert: '警告',
  none: '无级别',
}

const BLURS_LABELS: Record<string, string> = {
  content: '模糊文字内容',
  media: '模糊媒体内容',
  none: '不模糊',
}

const DEFAULT_SETTING_LABELS: Record<string, string> = {
  ignore: '默认显示',
  warn: '默认提醒',
  hide: '默认隐藏',
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function parseLabelDefinitions(labels: unknown): LabelDefinition[] {
  const definitions = asRecord(labels)?.labelValueDefinitions
  if (!Array.isArray(definitions)) return []
  return definitions.flatMap((entry) => {
    const item = asRecord(entry)
    const identifier = readString(item?.identifier)
    if (!item || !identifier) return []
    const locales = Array.isArray(item.locales) ? item.locales : []
    const parsedLocales = locales.flatMap((locale) => {
      const record = asRecord(locale)
      return record ? [record] : []
    })
    const localized =
      parsedLocales.find((locale) => {
        const lang = readString(locale.lang)
        return lang !== undefined && lang.toLowerCase().startsWith('zh')
      }) ?? parsedLocales[0]
    return [
      {
        identifier,
        ...(readString(localized?.name) ? { name: readString(localized?.name) } : {}),
        ...(readString(localized?.description)
          ? { description: readString(localized?.description) }
          : {}),
        ...(readString(item.severity) ? { severity: readString(item.severity) } : {}),
        ...(readString(item.blurs) ? { blurs: readString(item.blurs) } : {}),
        ...(readString(item.defaultSetting)
          ? { defaultSetting: readString(item.defaultSetting) }
          : {}),
        adultOnly: item.adultOnly === true,
      },
    ]
  })
}

export function LabelerPanel() {
  const provider = useDataProvider()

  const [config, setConfig] = useState<LabelerConfig | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let active = true
    setStatus('loading')
    setError(null)
    provider
      .getLabelerConfig()
      .then((value) => {
        if (!active) return
        setConfig(value)
        setStatus('ready')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(describeAdminError(cause))
        setStatus('error')
      })
    return () => {
      active = false
    }
  }, [provider, reloadToken])

  function reload() {
    setReloadToken((value) => value + 1)
  }

  if (status === 'error') {
    return (
      <div className="overflow-hidden rounded-xl border bg-card">
        <ErrorState
          title="标签服务信息加载失败"
          message={error ?? '操作失败，请稍后重试。'}
          onRetry={reload}
        />
      </div>
    )
  }

  if (status === 'loading' || !config) {
    return (
      <div className="overflow-hidden rounded-xl border bg-card">
        <LoadingState label="正在加载标签服务信息…" />
      </div>
    )
  }

  if (!config.available) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-4">
          <p className="flex items-center gap-2 text-sm font-medium text-warning-foreground">
            <AlertTriangleIcon className="size-4" />
            标签服务当前不可用
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {config.reason ?? '暂时无法读取标签服务配置，请稍后重试。'}
          </p>
          {config.did ? (
            <p className="mt-2 text-xs text-muted-foreground">
              服务标识：<span className="font-mono break-all">{config.did}</span>
            </p>
          ) : null}
        </div>
        <div className="rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
          标签服务负责向社区分发内容标签；服务不可用期间，标签定义与展示策略无法在此查看，但既有审核判定不受影响。
        </div>
        <Button variant="outline" size="sm" onClick={reload}>
          <RefreshCwIcon />
          重新加载
        </Button>
      </div>
    )
  }

  const labelDefinitions = parseLabelDefinitions(config.labels)

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium">
              {config.displayName ?? config.handle ?? '社区标签服务'}
            </p>
            {config.handle ? (
              <p className="mt-0.5 text-xs text-muted-foreground">@{config.handle}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="success">服务运行中</Badge>
            <Button variant="outline" size="sm" onClick={reload}>
              <RefreshCwIcon />
              刷新
            </Button>
          </div>
        </div>
        {config.description ? (
          <p className="mt-3 text-xs whitespace-pre-line text-muted-foreground">
            {config.description}
          </p>
        ) : null}
        <dl className="mt-3 grid gap-1 text-xs">
          <div className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">服务标识</dt>
            <dd className="font-mono break-all text-muted-foreground">{config.did ?? '未提供'}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          服务标识是标签服务在社区网络中的唯一编号，用于在客户端和审核记录中定位该服务。
        </p>
      </div>

      <div className="rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
        标签定义由标签服务维护，本页只做展示；新增或调整标签需要在标签服务的部署配置中完成。
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <TagsIcon className="size-4 text-muted-foreground" />
            标签定义
          </p>
          <span className="text-xs text-muted-foreground">共 {labelDefinitions.length} 个</span>
        </div>
        {labelDefinitions.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            该标签服务未公开标签定义，客户端不会展示自定义标签说明。
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>标签标识</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>严重程度</TableHead>
                <TableHead>内容处理</TableHead>
                <TableHead>默认展示</TableHead>
                <TableHead>可见范围</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {labelDefinitions.map((definition) => (
                <TableRow key={definition.identifier}>
                  <TableCell
                    className="max-w-48 truncate font-mono text-xs"
                    title={definition.identifier}
                  >
                    {definition.identifier}
                  </TableCell>
                  <TableCell className="max-w-56">
                    <p className="text-xs">{definition.name ?? '未提供名称'}</p>
                    {definition.description ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {definition.description}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {definition.severity
                      ? (SEVERITY_LABELS[definition.severity] ?? definition.severity)
                      : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {definition.blurs
                      ? (BLURS_LABELS[definition.blurs] ?? definition.blurs)
                      : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {definition.defaultSetting
                      ? (DEFAULT_SETTING_LABELS[definition.defaultSetting] ??
                        definition.defaultSetting)
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={definition.adultOnly ? 'warning' : 'muted'}>
                      {definition.adultOnly ? '仅成人账号可见' : '全部账号可见'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
