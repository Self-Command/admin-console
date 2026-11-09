import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError } from '@/lib/api/admin-client'
import {
  ModerationActionDialog,
  type ModerationActionRequest,
} from '@/components/moderation/moderation-action-dialog'

const mocks = vi.hoisted(() => ({
  actOnSubjects: vi.fn(),
  createApproval: vi.fn(),
}))

vi.mock('@/lib/data/use-data-provider', () => ({
  useDataProvider: () => ({
    actOnSubjects: mocks.actOnSubjects,
    createApproval: mocks.createApproval,
  }),
}))

const subject = 'at://did:plc:alice7x4k2m6q3n5p4w/app.bsky.feed.post/3kabc'

describe('moderation action dialog', () => {
  beforeEach(() => {
    mocks.actOnSubjects.mockReset()
    mocks.createApproval.mockReset()
  })

  it('requires a disposition comment before submitting', async () => {
    const request: ModerationActionRequest = { subjects: [subject], action: 'comment' }
    const user = userEvent.setup()
    render(<ModerationActionDialog request={request} onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '确认处置' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      '请填写不少于 2 个字符的处置说明',
    )
    expect(mocks.actOnSubjects).not.toHaveBeenCalled()
  })

  it('requires labels for a label action', async () => {
    const request: ModerationActionRequest = { subjects: [subject], action: 'label' }
    const user = userEvent.setup()
    render(<ModerationActionDialog request={request} onClose={vi.fn()} />)

    await user.type(screen.getByLabelText('处置说明'), '内容涉及误导信息')
    await user.click(screen.getByRole('button', { name: '确认处置' }))

    expect(screen.getByRole('alert')).toHaveTextContent('标签处置需要至少填写 1 个标签。')
    expect(mocks.actOnSubjects).not.toHaveBeenCalled()
  })

  it('submits comment, reason and duration for a single takedown', async () => {
    mocks.actOnSubjects.mockResolvedValue({
      events: [{ subject, eventId: 12 }],
      failed: [],
    })
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <ModerationActionDialog
        request={{ subjects: [subject], action: 'takedown', subjectType: 'record' }}
        onClose={onClose}
      />,
    )

    await user.type(screen.getByLabelText('处置说明'), '内容违反社区准则')
    await user.type(screen.getByLabelText('处置理由（可选）'), '重复发布垃圾信息')
    await user.type(screen.getByLabelText('处置时长（小时，可选）'), '48')
    await user.click(screen.getByRole('button', { name: '确认处置' }))

    await waitFor(() =>
      expect(mocks.actOnSubjects).toHaveBeenCalledWith({
        subjects: [subject],
        action: 'takedown',
        comment: '内容违反社区准则',
        reason: '重复发布垃圾信息',
        durationInHours: 48,
      }),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('turns a 409 approval requirement into an approval request draft', async () => {
    mocks.actOnSubjects.mockRejectedValue(
      new AdminApiError('conflict', 409, 'ApprovalRequired'),
    )
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <ModerationActionDialog
        request={{
          subjects: [subject, `${subject}-b`],
          action: 'takedown',
          subjectType: 'record',
        }}
        onClose={onClose}
      />,
    )

    expect(screen.getByText(/该动作需要另一位管理员批准/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('处置说明'), '批量下架违规内容')
    await user.click(screen.getByRole('button', { name: '确认处置' }))

    expect(
      await screen.findByRole('heading', { name: '发起审批请求' }),
    ).toBeInTheDocument()
    expect(screen.getByText('批量内容处置')).toBeInTheDocument()
    expect(
      screen.getByText(`对 2 个对象执行下架处置`),
    ).toBeInTheDocument()
    expect(onClose).toHaveBeenCalled()
  })

  it('explains when the moderation service is not configured', async () => {
    mocks.actOnSubjects.mockRejectedValue(
      new AdminApiError('server', 503, 'UpstreamUnavailable'),
    )
    const user = userEvent.setup()
    render(
      <ModerationActionDialog
        request={{ subjects: [subject], action: 'acknowledge' }}
        onClose={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText('处置说明'), '人工复核完成')
    await user.click(screen.getByRole('button', { name: '确认处置' }))

    expect(
      await screen.findByText(
        '审核服务尚未配置，暂时无法执行处置。请联系部署管理员完成审核服务配置。',
      ),
    ).toBeInTheDocument()
  })
})
