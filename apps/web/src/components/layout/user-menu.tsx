'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ChevronDownIcon,
  LogOutIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  UsersIcon,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import { hasPermission } from '@/lib/access'
import { roleLabels } from '@/lib/roles'

export function UserMenu() {
  const { identity, displayName, signOut } = useAuth()
  const router = useRouter()

  if (!identity) return null

  const canReadRoles = hasPermission(identity, 'role.read')
  const canReadSettings = hasPermission(identity, 'settings.read')
  const canReadAudit = hasPermission(identity, 'audit.read')

  async function handleSignOut() {
    await signOut()
    router.replace('/login')
  }

  const name = displayName ?? identity.did

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5 sm:pr-2">
          <Avatar className="size-7">
            <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
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
          <Link href="/profile">
            <UserRoundIcon />
            个人资料
          </Link>
        </DropdownMenuItem>
        {canReadRoles ? (
          <DropdownMenuItem asChild>
            <Link href="/roles">
              <UsersIcon />
              管理员与角色
            </Link>
          </DropdownMenuItem>
        ) : null}
        {canReadSettings ? (
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <SettingsIcon />
              系统设置
            </Link>
          </DropdownMenuItem>
        ) : null}
        {canReadAudit ? (
          <DropdownMenuItem asChild>
            <Link href="/audit">
              <ShieldCheckIcon />
              审计日志
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void handleSignOut()}>
          <LogOutIcon />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
