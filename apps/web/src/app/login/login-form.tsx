'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth, NoAdminRoleError } from '@/components/auth/auth-provider'
import { AdminApiError } from '@/lib/api/admin-client'
import { PdsAuthError } from '@/lib/auth/pds'
import { PREVIEW_CREDENTIALS } from '@/lib/auth/preview-auth'
import { defaultPdsUrl, previewAuthEnabled } from '@/lib/config'

function loginErrorMessage(error: unknown): string {
  if (error instanceof NoAdminRoleError) {
    return '该账号没有后台角色，请联系管理员开通后再登录。'
  }
  if (error instanceof PdsAuthError) {
    if (error.reason === 'invalid_credentials') return '账号或密码不正确，请重试。'
    if (error.reason === 'network') return '无法连接 PDS，请检查地址与网络后重试。'
    return '无法识别 PDS 的响应，请确认地址正确。'
  }
  if (error instanceof AdminApiError) {
    if (error.kind === 'forbidden' || error.kind === 'unauthorized') {
      return '该账号没有后台角色，请联系管理员开通后再登录。'
    }
    if (error.kind === 'network') return '无法连接后台服务，请稍后重试。'
    return '后台服务暂时不可用，请稍后重试。'
  }
  return '登录失败，请稍后重试。'
}

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { status, signIn, signInPreview } = useAuth()
  const [service, setService] = useState(defaultPdsUrl)
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const nextParam = searchParams.get('next')
  const target = nextParam && nextParam.startsWith('/') ? nextParam : '/'

  useEffect(() => {
    if (status === 'authenticated') router.replace(target)
  }, [status, router, target])

  function failWith(cause: unknown) {
    setPending(false)
    setError(loginErrorMessage(cause))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      await signIn({ service, identifier: identifier.trim(), password })
      router.replace(target)
    } catch (cause) {
      failWith(cause)
    }
  }

  async function handlePreview() {
    setError(null)
    setPending(true)
    try {
      await signInPreview(PREVIEW_CREDENTIALS.username, PREVIEW_CREDENTIALS.password)
      router.replace(target)
    } catch (cause) {
      failWith(cause)
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <label htmlFor="service" className="text-sm font-medium">
          PDS 地址
        </label>
        <Input
          id="service"
          name="service"
          placeholder="https://pds.example.com"
          autoComplete="url"
          inputMode="url"
          value={service}
          onChange={(event) => setService(event.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="identifier" className="text-sm font-medium">
          账号
        </label>
        <Input
          id="identifier"
          name="identifier"
          placeholder="alice.example.com"
          autoComplete="username"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-sm font-medium">
            密码
          </label>
          <span className="text-xs text-muted-foreground">应用专用密码</span>
        </div>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            placeholder="••••••••"
            autoComplete="current-password"
            className="pr-9"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button
            type="button"
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <LoaderCircleIcon className="animate-spin" /> : <ArrowRightIcon />}
        登录
      </Button>

      {previewAuthEnabled ? (
        <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <KeyRoundIcon className="mt-0.5 size-3.5 shrink-0" />
          <div className="space-y-2">
            <p>
              界面预览账号{' '}
              <span className="font-mono text-foreground">{PREVIEW_CREDENTIALS.username}</span>
              ，密码{' '}
              <span className="font-mono text-foreground">{PREVIEW_CREDENTIALS.password}</span>
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-full text-xs"
              onClick={handlePreview}
              disabled={pending}
            >
              使用预览账号登录
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  )
}
