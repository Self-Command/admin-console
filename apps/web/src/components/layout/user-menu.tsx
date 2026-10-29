'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDownIcon, LogOutIcon, UsersIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/components/auth/auth-provider'
import { roleLabels } from '@/lib/roles'

export function UserMenu() {
  const { identity, displayName, signOut } = useAuth()
  const router = useRouter()

  if (!identity) return null

  async function handleSignOut() {
    await signOut()
    router.replace('/login')
  }

  const name = displayName ?? identity.did

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5 sm:pr-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden min-w-0 text-left leading-tight sm:block">
            <span className="block max-w-40 truncate text-xs font-medium">{name}</span>
            <span className="block text-[10px] text-muted-foreground">
              {identity.role ? roleLabels[identity.role] : '无角色'}
            </span>
          </span>
          <ChevronDownIcon className="hidden size-3.5 text-muted-foreground sm:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <span className="block truncate text-xs font-medium text-foreground">{name}</span>
          <span className="mt-0.5 block truncate font-mono text-[10px] font-normal">
            {identity.did}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/roles">
            <UsersIcon />
            管理员与角色
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void handleSignOut()}>
          <LogOutIcon />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
