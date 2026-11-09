'use client'

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { CornerDownLeftIcon, ExternalLinkIcon, SearchIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useWorkspace } from '@/components/layout/workspace-provider'
import type { ResolvedNavItem } from '@/lib/navigation'
import { cn } from '@/lib/utils'

type PaletteEntry = ResolvedNavItem & {
  group: string
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { groups } = useWorkspace()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const entries = useMemo<PaletteEntry[]>(
    () =>
      groups.flatMap((group) =>
        group.items.map((item) => ({ ...item, group: group.label })),
      ),
    [groups],
  )

  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    if (!term) return entries
    return entries.filter(
      (entry) =>
        entry.title.toLocaleLowerCase().includes(term) ||
        entry.group.toLocaleLowerCase().includes(term) ||
        entry.href.toLocaleLowerCase().includes(term),
    )
  }, [entries, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query, open])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const node = listRef.current?.children[activeIndex] as HTMLElement | undefined
    node?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, open, results.length])

  function go(entry: PaletteEntry) {
    onOpenChange(false)
    if (entry.external) {
      window.open(entry.href, '_blank', 'noopener,noreferrer')
    } else {
      router.push(entry.href)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (results.length === 0 ? 0 : (index + 1) % results.length))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) =>
        results.length === 0 ? 0 : (index - 1 + results.length) % results.length,
      )
      return
    }
    if (event.key === 'Enter') {
      const target = results[activeIndex]
      if (target) {
        event.preventDefault()
        go(target)
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>快速导航</DialogTitle>
          <DialogDescription>搜索并跳转到管理后台页面。</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b px-3">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索页面名称或路径"
            aria-label="搜索页面"
            className="h-11 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
        </div>

        <div
          ref={listRef}
          role="listbox"
          aria-label="可跳转页面"
          className="max-h-80 overflow-y-auto p-1.5"
        >
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              没有匹配的页面，请调整搜索关键词。
            </p>
          ) : (
            results.map((entry, index) => {
              const Icon = entry.icon
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => go(entry)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm outline-none',
                    index === activeIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{entry.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{entry.group}</span>
                  {entry.external ? (
                    <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : null}
                </button>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <CornerDownLeftIcon className="size-3" />
            回车打开，方向键选择
          </span>
          <span>Esc 关闭</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
