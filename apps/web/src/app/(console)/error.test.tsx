import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ConsoleError from '@/app/(console)/error'

describe('console error boundary', () => {
  it('shows a generic message without stack traces, addresses or error codes', () => {
    const error = new Error(
      'connect ECONNREFUSED 127.0.0.1:2587 at AdminClient.getSystemStatus (file:///C:/app/lib/api/admin-client.ts:42:13)',
    )
    error.stack = 'Error: boom\n    at AdminClient.getSystemStatus (admin-client.ts:42:13)'

    render(<ConsoleError error={error} reset={vi.fn()} />)

    expect(screen.getByRole('heading', { name: '页面加载失败' })).toBeInTheDocument()
    expect(
      screen.getByText('服务暂时不可用，请稍后重试。若问题持续，请把当前时间与页面地址提供给管理员。'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/ECONNREFUSED|admin-client|127\.0\.0\.1|at AdminClient/)).toBeNull()
    expect(screen.queryByText(/stack/i)).toBeNull()
  })
})
