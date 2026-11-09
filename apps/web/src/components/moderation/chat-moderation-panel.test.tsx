import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError } from '@/lib/api/admin-client'
import { ChatModerationPanel } from '@/components/moderation/chat-moderation-panel'

const mocks = vi.hoisted(() => ({
  permissions: ['chat.read'] as string[],
  getChatMetadata: vi.fn(),
}))

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({
    identity: {
      did: 'did:web:ops.selfcommand.example',
      role: 'moderator',
      permissions: mocks.permissions,
    },
    callAdmin: vi.fn(),
  }),
}))

vi.mock('@/lib/data/use-data-provider', () => ({
  useDataProvider: () => ({ getChatMetadata: mocks.getChatMetadata }),
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

describe('chat moderation panel', () => {
  beforeEach(() => {
    mocks.permissions = ['chat.read']
    mocks.getChatMetadata.mockReset()
  })

  it('shows why chat moderation is unavailable without contacting chat', async () => {
    mocks.getChatMetadata.mockResolvedValue({
      enabled: false,
      reason: '当前部署未接入聊天服务，聊天审核暂不可用。',
    })
    render(<ChatModerationPanel />)

    expect(await screen.findByText('未启用')).toBeInTheDocument()
    expect(
      screen.getByText('当前部署未接入聊天服务，聊天审核暂不可用。'),
    ).toBeInTheDocument()
    expect(mocks.getChatMetadata).toHaveBeenCalled()
  })

  it('reports the connected state without reading chat content', async () => {
    mocks.getChatMetadata.mockResolvedValue({ enabled: true })
    render(<ChatModerationPanel />)

    expect(await screen.findByText('已接入')).toBeInTheDocument()
    expect(
      screen.getByText(
        '聊天服务已接入。聊天审核在聊天服务内进行，本系统不读取聊天正文；如需处置聊天内容，请通过聊天服务的管理入口操作。',
      ),
    ).toBeInTheDocument()
  })

  it('reports a failure and retries the metadata request', async () => {
    mocks.getChatMetadata.mockRejectedValue(new AdminApiError('network', null))
    const user = userEvent.setup()
    render(<ChatModerationPanel />)

    expect(await screen.findByText('聊天审核状态加载失败')).toBeInTheDocument()
    mocks.getChatMetadata.mockResolvedValue({
      enabled: false,
      reason: '当前部署未接入聊天服务，聊天审核暂不可用。',
    })
    await user.click(screen.getByRole('button', { name: /重试/ }))

    expect(await screen.findByText('未启用')).toBeInTheDocument()
  })

  it('stays hidden and makes no request without chat.read', () => {
    mocks.permissions = ['moderation.read']
    render(<ChatModerationPanel />)

    expect(screen.queryByText('聊天审核')).not.toBeInTheDocument()
    expect(mocks.getChatMetadata).not.toHaveBeenCalled()
  })
})
