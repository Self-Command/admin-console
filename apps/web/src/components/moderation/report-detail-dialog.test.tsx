import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReportView } from '@/lib/data/types'
import { AdminApiError } from '@/lib/api/admin-client'
import { ReportDetailDialog } from '@/components/moderation/report-detail-dialog'

const mocks = vi.hoisted(() => ({
  permissions: ['moderation.read', 'moderation.write'] as string[],
  getReport: vi.fn(),
  actOnReport: vi.fn(),
  actOnSubjects: vi.fn(),
  createApproval: vi.fn(),
  onClose: vi.fn(),
  onChanged: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({
    identity: {
      did: 'did:web:ops.selfcommand.example',
      role: 'admin',
      permissions: mocks.permissions,
    },
    callAdmin: vi.fn(),
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: vi.fn(),
  },
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    getReport: mocks.getReport,
    actOnReport: mocks.actOnReport,
    actOnSubjects: mocks.actOnSubjects,
    createApproval: mocks.createApproval,
  }
  return { useDataProvider: () => provider }
})

const report: ReportView = {
  id: 4321,
  status: 'open',
  subject: 'did:plc:alice7x4k2m6q3n5p4w',
  subjectType: 'account',
  subjectHandle: 'alice.example.com',
  reportType: 'tools.ozone.report.defs#reasonSpam',
  reportedBy: 'did:plc:reporter5',
  reporterHandle: 'reporter.example.com',
  comment: '该账号持续发布广告',
  actionNote: '已电话回访',
  createdAt: '2026-10-28T01:00:00.000Z',
  priorityScore: 42,
  relatedReportCount: 3,
  queueId: 2,
}

function renderDialog() {
  return render(
    <ReportDetailDialog
      reportId={4321}
      onClose={mocks.onClose}
      onChanged={mocks.onChanged}
    />,
  )
}

describe('report detail dialog', () => {
  beforeEach(() => {
    mocks.permissions = ['moderation.read', 'moderation.write']
    mocks.getReport.mockReset()
    mocks.actOnReport.mockReset()
    mocks.actOnSubjects.mockReset()
    mocks.createApproval.mockReset()
    mocks.onClose.mockReset()
    mocks.onChanged.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()
    mocks.getReport.mockResolvedValue({ report })
    mocks.actOnReport.mockResolvedValue({})
    mocks.actOnSubjects.mockResolvedValue({ events: [], failed: [] })
  })

  it('renders the report details and subject link', async () => {
    renderDialog()

    const dialog = await screen.findByRole('dialog', { name: '举报详情 #4321' })
    expect(mocks.getReport).toHaveBeenCalledWith(4321)
    expect(within(dialog).getByText('待处理')).toBeInTheDocument()
    expect(within(dialog).getByText('垃圾信息')).toBeInTheDocument()
    expect(within(dialog).getByText('账号')).toBeInTheDocument()
    expect(within(dialog).getByText('队列 #2')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: report.subject })).toHaveAttribute(
      'href',
      `/directory/${encodeURIComponent(report.subject)}`,
    )
    expect(within(dialog).getByText('alice.example.com')).toBeInTheDocument()
    expect(within(dialog).getByText('reporter.example.com')).toBeInTheDocument()
    expect(within(dialog).getByText('未分配')).toBeInTheDocument()
    expect(within(dialog).getByText('42')).toBeInTheDocument()
    expect(within(dialog).getByText('3 条')).toBeInTheDocument()
    expect(within(dialog).getByText('该账号持续发布广告')).toBeInTheDocument()
    expect(within(dialog).getByText('已电话回访')).toBeInTheDocument()
  })

  it('explains when the reader can only view the report', async () => {
    mocks.permissions = ['moderation.read']
    renderDialog()

    const dialog = await screen.findByRole('dialog', { name: '举报详情 #4321' })
    expect(
      within(dialog).getByText(
        '当前账号没有执行举报处置的权限，只能查看举报信息。如需处理举报，请联系管理员开通审核权限。',
      ),
    ).toBeInTheDocument()
    expect(
      within(dialog).queryByRole('button', { name: '结案' }),
    ).not.toBeInTheDocument()
    expect(
      within(dialog).getByText(
        '当前账号没有执行审核处置的权限。如需下架、禁言或打标，请联系管理员开通审核权限。',
      ),
    ).toBeInTheDocument()
  })

  it('requires report types when closing by type and then closes the report', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = await screen.findByRole('dialog', { name: '举报详情 #4321' })
    await user.click(within(dialog).getByRole('button', { name: '结案' }))
    await user.selectOptions(within(dialog).getByLabelText('结案范围'), 'types')
    await user.click(within(dialog).getByRole('button', { name: '确认结案' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      '按举报类型结案时，请至少填写一个举报类型。',
    )
    expect(mocks.actOnReport).not.toHaveBeenCalled()

    await user.type(
      within(dialog).getByLabelText('举报类型'),
      'reasonSpam，reasonHarassment',
    )
    await user.click(within(dialog).getByRole('button', { name: '确认结案' }))

    await waitFor(() =>
      expect(mocks.actOnReport).toHaveBeenCalledWith({
        reportId: 4321,
        action: 'close',
        scope: 'types',
        reportTypes: ['reasonSpam', 'reasonHarassment'],
      }),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('举报已结案。')
    expect(mocks.onChanged).toHaveBeenCalled()
    await waitFor(() => expect(mocks.getReport).toHaveBeenCalledTimes(2))
  })

  it('validates an assignee account identifier before assigning', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = await screen.findByRole('dialog', { name: '举报详情 #4321' })
    await user.click(within(dialog).getByRole('button', { name: '分配处理人' }))

    const assignee = within(dialog).getByLabelText('处理人账号标识（留空表示指派给自己）')
    await user.type(assignee, 'moderator.example.com')
    await user.click(within(dialog).getByRole('button', { name: '确认分配处理人' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      '处理人需要填写完整的账号标识，例如 did:plc:…',
    )
    expect(mocks.actOnReport).not.toHaveBeenCalled()

    await user.clear(assignee)
    await user.type(assignee, 'did:plc:moderator7x4k2m6q3n5p4w')
    await user.click(within(dialog).getByRole('button', { name: '确认分配处理人' }))

    await waitFor(() =>
      expect(mocks.actOnReport).toHaveBeenCalledWith({
        reportId: 4321,
        action: 'assign',
        did: 'did:plc:moderator7x4k2m6q3n5p4w',
      }),
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('举报已分配给处理人。')
  })

  it('opens a moderation action that carries the report id', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = await screen.findByRole('dialog', { name: '举报详情 #4321' })
    await user.click(within(dialog).getByRole('button', { name: '执行下架处置' }))

    const actionDialog = await screen.findByRole('dialog', { name: '下架处置' })
    await user.type(within(actionDialog).getByLabelText('处置说明'), '核实后下架账号内容')
    await user.click(within(actionDialog).getByRole('button', { name: '确认处置' }))

    await waitFor(() =>
      expect(mocks.actOnSubjects).toHaveBeenCalledWith({
        subjects: [report.subject],
        action: 'takedown',
        comment: '核实后下架账号内容',
        reportId: 4321,
      }),
    )
    expect(mocks.onChanged).toHaveBeenCalled()
  })

  it('reports a missing report and retries', async () => {
    mocks.getReport.mockRejectedValueOnce(new AdminApiError('not_found', 404))
    const user = userEvent.setup()
    renderDialog()

    expect(await screen.findByText('举报详情加载失败')).toBeInTheDocument()
    expect(
      screen.getByText('该举报不存在，可能已被其他管理员删除。'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /重试/ }))

    expect(
      await screen.findByRole('dialog', { name: '举报详情 #4321' }),
    ).toBeInTheDocument()
    expect(mocks.getReport).toHaveBeenCalledTimes(2)
  })

  it('closes through the footer button', async () => {
    const user = userEvent.setup()
    renderDialog()

    const dialog = await screen.findByRole('dialog', { name: '举报详情 #4321' })
    const closeButton = within(dialog).getAllByRole('button', { name: '关闭' })[0]
    if (!closeButton) throw new Error('close button not found')
    await user.click(closeButton)

    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })
})
