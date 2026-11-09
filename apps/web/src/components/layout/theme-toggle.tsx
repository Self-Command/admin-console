'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useWorkspace } from '@/components/layout/workspace-provider'
import type { ThemeMode } from '@/lib/runtime/types'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const { savePreferences } = useWorkspace()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  async function choose(mode: ThemeMode) {
    setTheme(mode)
    const saved = await savePreferences({ themeMode: mode })
    if (!saved) {
      toast.warning('主题已在本机生效，未能同步到账号。')
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="切换主题">
          {mounted && theme === 'dark' ? (
            <MoonIcon />
          ) : mounted && theme === 'light' ? (
            <SunIcon />
          ) : (
            <MonitorIcon />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuCheckboxItem
          checked={mounted && theme === 'light'}
          onCheckedChange={() => void choose('light')}
        >
          <SunIcon />
          浅色
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={mounted && theme === 'dark'}
          onCheckedChange={() => void choose('dark')}
        >
          <MoonIcon />
          深色
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={mounted && theme === 'system'}
          onCheckedChange={() => void choose('system')}
        >
          <MonitorIcon />
          跟随系统
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
