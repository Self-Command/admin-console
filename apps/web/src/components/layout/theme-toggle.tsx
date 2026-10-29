'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

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
          onCheckedChange={() => setTheme('light')}
        >
          <SunIcon />
          浅色
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={mounted && theme === 'dark'}
          onCheckedChange={() => setTheme('dark')}
        >
          <MoonIcon />
          深色
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={mounted && theme === 'system'}
          onCheckedChange={() => setTheme('system')}
        >
          <MonitorIcon />
          跟随系统
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
