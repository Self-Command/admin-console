import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ContentGetResult,
  ContentView,
  EventView,
  ReportView,
} from '@/lib/data/types'
import { AdminApiError } from '@/lib/api/admin-client'
import ContentSearchPage from '@/app/(console)/content/page'

const mocks = vi.hoisted(() => ({
  permissions: ['content.read', 'moderation.write'] as string[],
  searchContent: vi.fn(),
  searchImages: vi.fn(),
  getContent: vi.fn(),
  actOnSubjects: vi.fn(),
  createApproval: vi.fn(),
  exportContent: vi.fn(),
  downloadTextFile: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
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

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspace: () => ({ pageSize: 10 }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: mocks.toastWarning,
  },
}))

vi.mock('@/lib/download', () => ({
  downloadTextFile: mocks.downloadTextFile,
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    searchContent: mocks.searchContent,
    searchImages: mocks.searchImages,
    getContent: mocks.getContent,
    actOnSubjects: mocks.actOnSubjects,
    createApproval: mocks.createApproval,
    exportContent: mocks.exportContent,
  }
  return { useDataProvider: () => provider }
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const uriA = 'at://did:plc:alice7x4k2m6q3n5p4w/app.bsky.feed.post/3kaaa'
const uriB = 'at://did:plc:bob/app.bsky.feed.post/3kbbb'

const firstContent: ContentView = {
  uri: uriA,
  author: 'did:plc:alice7x4k2m6q3n5p4w',
  authorHandle: 'alice.example.com',
  text: '第一条公开内容',
  indexedAt: '2026-10-28T01:00:00.000Z',
  hidden: false,
  labels: ['spam'],
  likeCount: 12,
  repostCount: 3,
}

const secondContent: ContentView = {
  ...firstContent,
  uri: uriB,
  author: 'did:plc:bob',
  authorHandle: 'bob.example.com',
  text: '第二条公开内容',
  hidden: true,
}

const detailEvent: EventView = {
  id: 9001,
  eventType: 'modEventTakedown',
  subject: uriA,
  subjectType: 'record',
  createdBy: 'did:web:moderation.selfcommand.example',
  createdAt: '2026-10-28T02:00:00.000Z',
  comment: '屡次发布违规内容',
}

const detailReport: ReportView = {
  id: 4321,
  status: 'open',
  subject: uriA,
  subjectType: 'record',
  reportType: 'tools.ozone.report.defs#reasonSpam',
  reportedBy: 'did:plc:reporter5',
  createdAt: '2026-10-28T01:30:00.000Z',
}

const detail: ContentGetResult = {
  record: firstContent,
  events: [detailEvent],
  reports: [detailReport],
  moderationAvailable: true,
}

describe('content search page', () => {
  beforeEach(() => {
    mocks.permissions = ['content.read', 'moderation.write']
    mocks.searchContent.mockReset()
    mocks.searchImages.mockReset()
    mocks.getContent.mockReset()
    mocks.actOnSubjects.mockReset()
    mocks.createApproval.mockReset()
    mocks.exportContent.mockReset()
    mocks.downloadTextFile.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()
    mocks.toastWarning.mockReset()
    mocks.searchContent.mockResolvedValue({
      content: [firstContent, secondContent],
      moderationAvailable: true,
    })
    mocks.getContent.mockResolvedValue(detail)
    mocks.actOnSubjects.mockResolvedValue({ events: [], failed: [] })
    mocks.exportContent.mockResolvedValue({
      filename: '内容检索结果-20261030-1030.csv',
      contentType: 'text/csv;charset=utf-8',
      content: 'uri,text\n' + uriA + ',第一条公开内容\n',
      rows: 2,
      truncated: false,
      limit: 10000,
    })
  })

  it('starts idle and requires a keyword before searching', async () => {
    const user = userEvent.setup()
    render(<ContentSearchPage />)

    expect(screen.getByText('输入关键词开始检索')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '检索' }))

    expect(screen.getByText('请输入检索关键词。')).toBeInTheDocument()
    expect(mocks.searchContent).not.toHaveBeenCalled()
  })

  it('searches public content and renders rows with audit status', async () => {
    const user = userEvent.setup()
    render(<ContentSearchPage />)

    await user.type(screen.getByLabelText('检索关键词'), '公开内容')
    await user.click(screen.getByRole('button', { name: '检索' }))

    const firstRow = (await screen.findByText('第一条公开内容')).closest('tr')
    if (!firstRow) throw new Error('content row not found')
    expect(within(firstRow).getByText(uriA)).toBeInTheDocument()
    expect(within(firstRow).getByText('alice.example.com')).toBeInTheDocument()
    expect(within(firstRow).getByText('可见')).toBeInTheDocument()
    expect(within(firstRow).getByText('spam')).toBeInTheDocument()
    expect(within(firstRow).getByText('赞 12 · 转 3')).toBeInTheDocument()

    const secondRow = screen.getByText('第二条公开内容').closest('tr')
    if (!secondRow) throw new Error('second content row not found')
    expect(within(secondRow).getByText('已隐藏')).toBeInTheDocument()

    expect(mocks.searchContent).toHaveBeenCalledWith({
      q: '公开内容',
      limit: 10,
      author: undefined,
      sort: 'latest',
    })
    expect(screen.getByText('已显示 2 条结果')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '已加载全部' })).toBeDisabled()
  })

  it('warns when the moderation service is unavailable for search results', async () => {
    mocks.searchContent.mockResolvedValue({
      content: [firstContent],
      moderationAvailable: false,
    })
    const user = userEvent.setup()
    render(<ContentSearchPage />)

    await user.type(screen.getByLabelText('检索关键词'), '公开内容')
    await user.click(screen.getByRole('button', { name: '检索' }))

    expect(
      await screen.findByText(
        '审核服务尚未配置，当前只能查看公开内容，无法执行下架等处置。请联系部署管理员完成审核服务配置。',
      ),
    ).toBeInTheDocument()
  })

  it('reports a not-configured content search and retries the request', async () => {
    mocks.searchContent.mockRejectedValueOnce(
      new AdminApiError('server', 503, 'NotConfigured'),
    )
    const user = userEvent.setup()
    render(<ContentSearchPage />)

    await user.type(screen.getByLabelText('检索关键词'), '公开内容')
    await user.click(screen.getByRole('button', { name: '检索' }))

    expect(await screen.findByText('内容检索失败')).toBeInTheDocument()
    expect(
      screen.getByText(
        '内容检索依赖的服务尚未配置，暂时无法查询内容。请联系部署管理员完成配置。',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /重试/ }))

    expect(await screen.findByText('第一条公开内容')).toBeInTheDocument()
    expect(mocks.searchContent).toHaveBeenCalledTimes(2)
  })

  it('exports the current search result as a CSV file', async () => {
    const user = userEvent.setup()
    render(<ContentSearchPage />)

    const exportButton = screen.getByRole('button', { name: '导出结果' })
    expect(exportButton).toBeDisabled()

    await user.type(screen.getByLabelText('检索关键词'), '公开内容')
    await user.click(screen.getByRole('button', { name: '检索' }))
    await screen.findByText('第一条公开内容')

    await user.click(screen.getByRole('button', { name: '导出结果' }))

    await waitFor(() =>
      expect(mocks.exportContent).toHaveBeenCalledWith({
        q: '公开内容',
        sort: 'latest',
      }),
    )
    expect(mocks.downloadTextFile).toHaveBeenCalledWith(
      '内容检索结果-20261030-1030.csv',
      expect.stringContaining(uriA),
      'text/csv;charset=utf-8',
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith('已导出 2 条内容。')
  })

  it('warns when the export reaches the row limit', async () => {
    mocks.exportContent.mockResolvedValue({
      filename: '内容检索结果-20261030-1030.csv',
      contentType: 'text/csv;charset=utf-8',
      content: 'x',
      rows: 10000,
      truncated: true,
      limit: 10000,
    })
    const user = userEvent.setup()
    render(<ContentSearchPage />)

    await user.type(screen.getByLabelText('检索关键词'), '公开内容')
    await user.click(screen.getByRole('button', { name: '检索' }))
    await screen.findByText('第一条公开内容')
    await user.click(screen.getByRole('button', { name: '导出结果' }))

    await waitFor(() =>
      expect(mocks.toastWarning).toHaveBeenCalledWith(
        '已导出 10,000 条内容，达到 10,000 行上限并截断。请缩小筛选范围后重新导出。',
      ),
    )
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('reports an export rejected by the rate limit', async () => {
    mocks.exportContent.mockRejectedValue(
      new AdminApiError('validation', 429, 'RateLimited'),
    )
    const user = userEvent.setup()
    render(<ContentSearchPage />)

    await user.type(screen.getByLabelText('检索关键词'), '公开内容')
    await user.click(screen.getByRole('button', { name: '检索' }))
    await screen.findByText('第一条公开内容')
    await user.click(screen.getByRole('button', { name: '导出结果' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('操作过于频繁，请稍后再试。'),
    )
    expect(mocks.downloadTextFile).not.toHaveBeenCalled()
  })

  it('selects content and submits a batch moderation request', async () => {
    const user = userEvent.setup()
    render(<ContentSearchPage />)

    await user.type(screen.getByLabelText('检索关键词'), '公开内容')
    await user.click(screen.getByRole('button', { name: '检索' }))
    await screen.findByText('第一条公开内容')

    await user.click(screen.getByRole('checkbox', { name: `选择内容 ${uriA}` }))
    await user.click(screen.getByRole('checkbox', { name: `选择内容 ${uriB}` }))
    expect(screen.getByText('已选择 2 条内容')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '批量处置' }))

    const dialog = await screen.findByRole('dialog', { name: '下架处置（2 个对象）' })
    await user.type(within(dialog).getByLabelText('处置说明'), '批量下架违规内容')
    await user.click(within(dialog).getByRole('button', { name: '确认处置' }))

    await waitFor(() =>
      expect(mocks.actOnSubjects).toHaveBeenCalledWith({
        subjects: [uriA, uriB],
        action: 'takedown',
        comment: '批量下架违规内容',
      }),
    )
    await waitFor(() => expect(mocks.searchContent).toHaveBeenCalledTimes(2))
    expect(screen.getByText('已选择 0 条内容')).toBeInTheDocument()
  })

  it('opens the content detail dialog with moderation history', async () => {
    const user = userEvent.setup()
    render(<ContentSearchPage />)

    await user.type(screen.getByLabelText('检索关键词'), '公开内容')
    await user.click(screen.getByRole('button', { name: '检索' }))

    const row = (await screen.findByText('第一条公开内容')).closest('tr')
    if (!row) throw new Error('content row not found')
    await user.click(within(row).getByRole('button', { name: '详情' }))

    const dialog = await screen.findByRole('dialog', { name: '内容详情' })
    expect(mocks.getContent).toHaveBeenCalledWith(uriA)
    expect(await within(dialog).findByText('近期处置记录')).toBeInTheDocument()
    expect(within(dialog).getByText('屡次发布违规内容')).toBeInTheDocument()
    expect(within(dialog).getByText('#4321')).toBeInTheDocument()
    expect(within(dialog).getByText('垃圾信息')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '执行下架处置' })).toBeInTheDocument()
  })

  it('explains unavailable moderation inside the content detail dialog', async () => {
    mocks.getContent.mockResolvedValue({ ...detail, moderationAvailable: false })
    const user = userEvent.setup()
    render(<ContentSearchPage />)

    await user.type(screen.getByLabelText('检索关键词'), '公开内容')
    await user.click(screen.getByRole('button', { name: '检索' }))

    const row = (await screen.findByText('第一条公开内容')).closest('tr')
    if (!row) throw new Error('content row not found')
    await user.click(within(row).getByRole('button', { name: '详情' }))

    const dialog = await screen.findByRole('dialog', { name: '内容详情' })
    expect(
      await within(dialog).findByText(
        '审核服务尚未配置，当前只能查看公开内容，无法执行处置。请联系部署管理员完成审核服务配置。',
      ),
    ).toBeInTheDocument()
    expect(
      within(dialog).queryByRole('button', { name: '执行下架处置' }),
    ).not.toBeInTheDocument()
  })

  it('hides batch selection without the moderation write permission', async () => {
    mocks.permissions = ['content.read']
    const user = userEvent.setup()
    render(<ContentSearchPage />)

    await user.type(screen.getByLabelText('检索关键词'), '公开内容')
    await user.click(screen.getByRole('button', { name: '检索' }))

    await screen.findByText('第一条公开内容')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '批量处置' })).not.toBeInTheDocument()
  })

  it('reports the image search service as not configured', async () => {
    mocks.searchImages.mockRejectedValue(new AdminApiError('server', 503, 'NotConfigured'))
    const user = userEvent.setup()
    render(<ContentSearchPage />)

    await user.click(screen.getByRole('tab', { name: '图片检索' }))
    await user.click(screen.getByRole('button', { name: '检索图片' }))

    expect(screen.getByText('请输入图片检索关键词。')).toBeInTheDocument()
    expect(mocks.searchImages).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('图片检索关键词'), '违规图片')
    await user.click(screen.getByRole('button', { name: '检索图片' }))

    expect(await screen.findByText('图片检索服务尚未配置')).toBeInTheDocument()
    expect(
      screen.getByText(
        '当前部署没有启用图片检索。若要使用该功能，请联系部署管理员配置图片检索服务地址与访问凭据。',
      ),
    ).toBeInTheDocument()
    expect(mocks.searchImages).toHaveBeenCalledWith({ q: '违规图片', limit: 10 })
  })

  it('renders image results and opens the source content', async () => {
    mocks.searchImages.mockResolvedValue({
      results: [
        {
          imageUrl: 'https://cdn.example.com/img.jpg',
          description: '疑似违规图片',
          author: 'did:plc:alice7x4k2m6q3n5p4w',
          score: 0.87,
          postUri: uriA,
        },
      ],
      total: 1,
    })
    const user = userEvent.setup()
    render(<ContentSearchPage />)

    await user.click(screen.getByRole('tab', { name: '图片检索' }))
    await user.type(screen.getByLabelText('图片检索关键词'), '违规图片')
    await user.click(screen.getByRole('button', { name: '检索图片' }))

    expect(await screen.findByAltText('疑似违规图片')).toBeInTheDocument()
    expect(screen.getByText(/匹配度 0\.87/)).toBeInTheDocument()
    expect(screen.getByText('已显示 1 / 1 张')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '查看来源内容' }))

    expect(await screen.findByRole('dialog', { name: '内容详情' })).toBeInTheDocument()
    expect(mocks.getContent).toHaveBeenCalledWith(uriA)
  })

  it('explains when the reader lacks content.read', async () => {
    mocks.permissions = []
    render(<ContentSearchPage />)

    expect(await screen.findByText('没有查看内容的权限')).toBeInTheDocument()
    expect(mocks.searchContent).not.toHaveBeenCalled()
  })
})
