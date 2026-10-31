import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedNavGroup } from '@/lib/navigation'
import { CommandPalette } from '@/components/layout/command-palette'

const mocks = vi.hoisted(() => {
  const icon = (() => null) as never
  const groups: ResolvedNavGroup[] = [
    {
      id: 'moderation',
      label: '内容审核',
      items: [
        {
          id: 'moderation-reports',
          title: '举报处理',
          href: '/moderation/reports',
          icon,
          external: false,
          builtin: true,
        },
      ],
    },
    {
      id: 'operations',
      label: '运营',
      items: [
        {
          id: 'directory',
          title: '账号目录',
          href: '/directory',
          icon,
          external: false,
          builtin: true,
        },
        {
          id: 'runbook',
          title: '运维手册',
          href: 'https://docs.example.com',
          icon,
          external: true,
          builtin: false,
        },
      ],
    },
  ]
  return { push: vi.fn(), groups }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspace: () => ({ groups: mocks.groups }),
}))

describe('command palette', () => {
  beforeEach(() => {
    mocks.push.mockReset()
  })

  it('filters pages and opens the selected page', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<CommandPalette open onOpenChange={onOpenChange} />)

    expect(screen.getByRole('option', { name: /账号目录/ })).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: '搜索页面' }), '举报')
    expect(screen.queryByRole('option', { name: /账号目录/ })).not.toBeInTheDocument()

    await user.keyboard('{Enter}')
    expect(mocks.push).toHaveBeenCalledWith('/moderation/reports')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('opens external entries in a new tab', async () => {
    const onOpenChange = vi.fn()
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const user = userEvent.setup()
    render(<CommandPalette open onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('option', { name: /运维手册/ }))
    expect(open).toHaveBeenCalledWith(
      'https://docs.example.com',
      '_blank',
      'noopener,noreferrer',
    )
    expect(mocks.push).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    open.mockRestore()
  })

  it('explains when no page matches the query', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open onOpenChange={vi.fn()} />)

    await user.type(screen.getByRole('textbox', { name: '搜索页面' }), '不存在的页面')
    expect(
      screen.getByText('没有匹配的页面，请调整搜索关键词。'),
    ).toBeInTheDocument()
  })
})
