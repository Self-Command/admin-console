'use client'

import { useState } from 'react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  LinkIcon,
  LockIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { BUILTIN_NAV, iconForName, isSafeNavHref } from '@/lib/navigation'
import type { NavGroupConfig, NavItemConfig, NavigationSettings } from '@/lib/runtime/types'

const BUILTIN_IDS = new Set(Object.keys(BUILTIN_NAV))
const MAX_GROUPS = 8
const MAX_ITEMS = 20

const ICON_OPTIONS = [
  { value: 'link', label: '链接' },
  { value: 'globe', label: '站点' },
  { value: 'file-text', label: '文档' },
  { value: 'bell', label: '通知' },
  { value: 'chart', label: '数据' },
  { value: 'database', label: '数据库' },
  { value: 'shield', label: '安全' },
  { value: 'users', label: '成员' },
  { value: 'user', label: '个人' },
  { value: 'search', label: '检索' },
  { value: 'list', label: '列表' },
]

function createId(prefix: string, taken: ReadonlySet<string>): string {
  let suffix = Date.now().toString(36)
  let candidate = `${prefix}-${suffix}`
  while (taken.has(candidate)) {
    suffix = `${suffix}${Math.floor(Math.random() * 36).toString(36)}`
    candidate = `${prefix}-${suffix}`
  }
  return candidate
}

function itemTitle(item: NavItemConfig): string {
  return item.label?.trim() || BUILTIN_NAV[item.id]?.title || item.id
}

type PendingRemoval = {
  groupIndex: number
  itemIndex: number
  title: string
}

export function NavigationSection({
  value,
  onChange,
}: {
  value: NavigationSettings
  onChange: (next: NavigationSettings) => void
}) {
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupError, setGroupError] = useState<string | null>(null)
  const [itemGroup, setItemGroup] = useState<number | null>(null)
  const [itemName, setItemName] = useState('')
  const [itemHref, setItemHref] = useState('https://')
  const [itemIcon, setItemIcon] = useState('link')
  const [itemError, setItemError] = useState<string | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null)

  const allIds = new Set(value.groups.flatMap((group) => group.items.map((item) => item.id)))
  const allGroupIds = new Set(value.groups.map((group) => group.id))

  function updateGroup(index: number, next: NavGroupConfig) {
    onChange({
      groups: value.groups.map((group, current) => (current === index ? next : group)),
    })
  }

  function updateItem(groupIndex: number, itemIndex: number, patch: Partial<NavItemConfig>) {
    const group = value.groups[groupIndex]
    if (!group) return
    updateGroup(groupIndex, {
      ...group,
      items: group.items.map((item, current) =>
        current === itemIndex ? { ...item, ...patch } : item,
      ),
    })
  }

  function moveGroup(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= value.groups.length) return
    const groups = [...value.groups]
    const [moved] = groups.splice(index, 1)
    if (!moved) return
    groups.splice(target, 0, moved)
    onChange({ groups })
  }

  function moveItem(groupIndex: number, itemIndex: number, direction: -1 | 1) {
    const group = value.groups[groupIndex]
    if (!group) return
    const target = itemIndex + direction
    if (target < 0 || target >= group.items.length) return
    const items = [...group.items]
    const [moved] = items.splice(itemIndex, 1)
    if (!moved) return
    items.splice(target, 0, moved)
    updateGroup(groupIndex, { ...group, items })
  }

  function removeItem(groupIndex: number, itemIndex: number) {
    const group = value.groups[groupIndex]
    if (!group) return
    updateGroup(groupIndex, {
      ...group,
      items: group.items.filter((_, current) => current !== itemIndex),
    })
  }

  function addGroup() {
    const label = groupName.trim()
    if (!label) {
      setGroupError('请填写分组名称。')
      return
    }
    if (value.groups.length >= MAX_GROUPS) {
      setGroupError(`最多只能保留 ${MAX_GROUPS} 个分组。`)
      return
    }
    onChange({
      groups: [
        ...value.groups,
        { id: createId('group', allGroupIds), label, items: [] },
      ],
    })
    setGroupDialogOpen(false)
    setGroupName('')
    setGroupError(null)
  }

  function openItemDialog(groupIndex: number) {
    setItemGroup(groupIndex)
    setItemName('')
    setItemHref('https://')
    setItemIcon('link')
    setItemError(null)
  }

  function addItem() {
    if (itemGroup === null) return
    const group = value.groups[itemGroup]
    if (!group) return
    if (group.items.length >= MAX_ITEMS) {
      setItemError(`每个分组最多 ${MAX_ITEMS} 个入口。`)
      return
    }
    const label = itemName.trim()
    const href = itemHref.trim()
    if (!label) {
      setItemError('请填写入口名称。')
      return
    }
    if (!isSafeNavHref(href)) {
      setItemError('链接必须是 https 地址或以 / 开头的站内路径。')
      return
    }
    updateGroup(itemGroup, {
      ...group,
      items: [
        ...group.items,
        { id: createId('custom', allIds), label, href, icon: itemIcon, hidden: false },
      ],
    })
    setItemGroup(null)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        内置页面必须保留，只能修改显示名称、图标与显示状态；自定义链接可用于帮助中心、审核后台等外部系统。
        入口还会按当前账号的角色权限自动过滤。
      </div>

      {value.groups.map((group, groupIndex) => (
        <div key={group.id} className="rounded-xl border">
          <div className="flex flex-col gap-3 border-b bg-muted/20 p-3 sm:flex-row sm:items-center">
            <GripVerticalIcon className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
            <Input
              value={group.label}
              maxLength={40}
              aria-label={`第 ${groupIndex + 1} 个分组名称`}
              className="h-8 max-w-56"
              onChange={(event) => updateGroup(groupIndex, { ...group, label: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {group.items.length} 个入口
              <span className="ml-2 font-mono text-[11px]">{group.id}</span>
            </p>
            <div className="flex items-center gap-1 sm:ml-auto">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="分组上移"
                disabled={groupIndex === 0}
                onClick={() => moveGroup(groupIndex, -1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="分组下移"
                disabled={groupIndex === value.groups.length - 1}
                onClick={() => moveGroup(groupIndex, 1)}
              >
                <ArrowDownIcon />
              </Button>
            </div>
          </div>

          <div className="space-y-2 p-3">
            {group.items.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">
                此分组暂无入口，可以添加自定义链接或从其他分组调整。
              </p>
            ) : null}

            {group.items.map((item, itemIndex) => {
              const builtin = BUILTIN_IDS.has(item.id)
              const Icon = iconForName(item.icon) ?? BUILTIN_NAV[item.id]?.icon ?? LinkIcon
              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon className="size-4 text-muted-foreground" />
                  </span>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={item.label ?? ''}
                        maxLength={40}
                        aria-label={`${itemTitle(item)}显示名称`}
                        placeholder={builtin ? BUILTIN_NAV[item.id]?.title : '入口名称'}
                        className="h-8 max-w-56"
                        onChange={(event) =>
                          updateItem(groupIndex, itemIndex, {
                            label: event.target.value || undefined,
                          })
                        }
                      />
                      {builtin ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <LockIcon className="size-3" />
                          内置页面
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] text-muted-foreground">{item.id}</span>
                      )}
                    </div>
                    {builtin ? (
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {BUILTIN_NAV[item.id]?.href ?? '页面地址固定'}
                      </p>
                    ) : (
                      <Input
                        value={item.href ?? ''}
                        maxLength={512}
                        aria-label={`${itemTitle(item)}链接`}
                        placeholder="https://example.com 或 /path"
                        className="h-8 font-mono text-xs"
                        onChange={(event) =>
                          updateItem(groupIndex, itemIndex, {
                            href: event.target.value || undefined,
                          })
                        }
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {item.hidden ? '已隐藏' : '显示'}
                    </span>
                    <Switch
                      checked={!item.hidden}
                      aria-label={`显示${itemTitle(item)}`}
                      onCheckedChange={(checked) =>
                        updateItem(groupIndex, itemIndex, { hidden: !checked })
                      }
                    />
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="入口上移"
                      disabled={itemIndex === 0}
                      onClick={() => moveItem(groupIndex, itemIndex, -1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="入口下移"
                      disabled={itemIndex === group.items.length - 1}
                      onClick={() => moveItem(groupIndex, itemIndex, 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    {builtin ? null : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`删除${itemTitle(item)}`}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setPendingRemoval({
                            groupIndex,
                            itemIndex,
                            title: itemTitle(item),
                          })
                        }
                      >
                        <Trash2Icon />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full border-dashed"
              disabled={group.items.length >= MAX_ITEMS}
              onClick={() => openItemDialog(groupIndex)}
            >
              <PlusIcon />
              添加自定义入口
            </Button>
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={value.groups.length >= MAX_GROUPS}
        onClick={() => {
          setGroupName('')
          setGroupError(null)
          setGroupDialogOpen(true)
        }}
      >
        <PlusIcon />
        新增分组
      </Button>
      <p className="text-xs text-muted-foreground">
        已使用 {value.groups.length} / {MAX_GROUPS} 个分组。未使用的分组不会显示在侧边栏。
      </p>

      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增导航分组</DialogTitle>
            <DialogDescription>
              分组用于在侧边栏中归类入口，例如“运营”“系统”。保存设置后生效。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="nav-group-name">分组名称</Label>
            <Input
              id="nav-group-name"
              value={groupName}
              maxLength={40}
              placeholder="例如：帮助中心"
              onChange={(event) => {
                setGroupName(event.target.value)
                setGroupError(null)
              }}
            />
            {groupError ? (
              <p role="alert" className="text-xs text-destructive">
                {groupError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={addGroup}>添加分组</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={itemGroup !== null}
        onOpenChange={(open) => {
          if (!open) setItemGroup(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加自定义入口</DialogTitle>
            <DialogDescription>
              自定义入口可以指向帮助中心、审核后台或其他管理页面。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="nav-item-name">入口名称</Label>
              <Input
                id="nav-item-name"
                value={itemName}
                maxLength={40}
                placeholder="例如：内容审核"
                onChange={(event) => {
                  setItemName(event.target.value)
                  setItemError(null)
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nav-item-href">链接地址</Label>
              <Input
                id="nav-item-href"
                value={itemHref}
                maxLength={512}
                className="font-mono text-xs"
                placeholder="https://review.example.com 或 /help"
                onChange={(event) => {
                  setItemHref(event.target.value)
                  setItemError(null)
                }}
              />
              <p className="text-xs text-muted-foreground">
                外部地址使用 https；站内页面以 / 开头。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nav-item-icon">图标</Label>
              <Select
                id="nav-item-icon"
                value={itemIcon}
                onChange={(event) => setItemIcon(event.target.value)}
              >
                {ICON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            {itemError ? (
              <p role="alert" className="text-xs text-destructive">
                {itemError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemGroup(null)}>
              取消
            </Button>
            <Button onClick={addItem}>添加入口</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除自定义入口</AlertDialogTitle>
            <AlertDialogDescription>
              删除后“{pendingRemoval?.title}”会从导航中移除，保存设置后生效。此操作不会影响其他入口。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!pendingRemoval) return
                removeItem(pendingRemoval.groupIndex, pendingRemoval.itemIndex)
                setPendingRemoval(null)
              }}
            >
              删除入口
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
