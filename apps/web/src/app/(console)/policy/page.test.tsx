import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminApiError } from '@/lib/api/admin-client'
import type {
  LabelerConfig,
  PolicyOption,
  PolicySetView,
  SafelinkRule,
} from '@/lib/data/types'
import PolicyPage from '@/app/(console)/policy/page'

const mocks = vi.hoisted(() => ({
  permissions: ['policy.read', 'policy.write'] as string[],
  listPolicyOptions: vi.fn(),
  actOnPolicyOption: vi.fn(),
  listPolicySets: vi.fn(),
  getPolicySet: vi.fn(),
  actOnPolicySet: vi.fn(),
  listSafelinkRules: vi.fn(),
  actOnPolicySafelink: vi.fn(),
  getLabelerConfig: vi.fn(),
  createApproval: vi.fn(),
}))

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({
    identity: {
      did: 'did:web:ops.selfcommand.example',
      role: 'admin',
      permissions: mocks.permissions,
    },
  }),
}))

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspace: () => ({ pageSize: 10, dateFormat: 'date-time' as const }),
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    listPolicyOptions: mocks.listPolicyOptions,
    actOnPolicyOption: mocks.actOnPolicyOption,
    listPolicySets: mocks.listPolicySets,
    getPolicySet: mocks.getPolicySet,
    actOnPolicySet: mocks.actOnPolicySet,
    listSafelinkRules: mocks.listSafelinkRules,
    actOnPolicySafelink: mocks.actOnPolicySafelink,
    getLabelerConfig: mocks.getLabelerConfig,
    createApproval: mocks.createApproval,
  }
  return { useDataProvider: () => provider }
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const OPTION_KEY = 'tools.ozone.team.setting'

const option: PolicyOption = {
  key: OPTION_KEY,
  scope: 'instance',
  value: { enabled: true },
  description: '审核服务设置',
  managerRole: 'tools.ozone.team.defs#roleAdmin',
  updatedAt: '2026-10-28T02:00:00.000Z',
}

const set: PolicySetView = {
  name: 'muted-accounts',
  description: '禁言名单',
  valuesCount: 2,
  updatedAt: '2026-10-28T02:00:00.000Z',
}

const rule: SafelinkRule = {
  url: 'example.com',
  pattern: 'domain',
  action: 'block',
  reason: 'csam',
  source: '威胁情报',
  updatedAt: '2026-10-28T02:00:00.000Z',
}

const labeler: LabelerConfig = {
  available: true,
  did: 'did:web:labeler.selfcommand.example',
  handle: 'labeler.selfcommand.example',
  displayName: '社区标签服务',
  description: '为社区内容提供审核标签。',
  labels: {
    labelValueDefinitions: [
      {
        identifier: 'spam',
        severity: 'alert',
        blurs: 'content',
        defaultSetting: 'warn',
        adultOnly: false,
        locales: [{ lang: 'zh', name: '垃圾信息', description: '重复发布的内容' }],
      },
    ],
  },
}

describe('policy page', () => {
  beforeEach(() => {
    mocks.permissions = ['policy.read', 'policy.write']
    mocks.listPolicyOptions.mockReset()
    mocks.actOnPolicyOption.mockReset()
    mocks.listPolicySets.mockReset()
    mocks.getPolicySet.mockReset()
    mocks.actOnPolicySet.mockReset()
    mocks.listSafelinkRules.mockReset()
    mocks.actOnPolicySafelink.mockReset()
    mocks.getLabelerConfig.mockReset()
    mocks.createApproval.mockReset()

    mocks.listPolicyOptions.mockResolvedValue({ options: [option] })
    mocks.actOnPolicyOption.mockResolvedValue({ option })
    mocks.listPolicySets.mockResolvedValue({ sets: [set] })
    mocks.getPolicySet.mockResolvedValue({
      set,
      values: ['did:plc:one', 'did:plc:two'],
    })
    mocks.actOnPolicySet.mockResolvedValue({})
    mocks.listSafelinkRules.mockResolvedValue({ rules: [rule] })
    mocks.actOnPolicySafelink.mockResolvedValue({})
    mocks.getLabelerConfig.mockResolvedValue(labeler)
    mocks.createApproval.mockResolvedValue({
      id: 'ap-1',
      action: 'policy.write',
      status: 'pending',
      expiresAt: '2026-10-30T02:00:00.000Z',
    })
  })

  it('lists policy options and reloads when the scope changes', async () => {
    const user = userEvent.setup()
    render(<PolicyPage />)

    expect(await screen.findByText(OPTION_KEY)).toBeInTheDocument()
    expect(screen.getByText('实例级')).toBeInTheDocument()
    expect(screen.getByText('审核服务设置')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('按选项范围筛选'), 'personal')
    await waitFor(() =>
      expect(mocks.listPolicyOptions).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: 'personal', limit: 10 }),
      ),
    )
  })

  it('validates the option JSON before saving', async () => {
    const user = userEvent.setup()
    render(<PolicyPage />)

    await user.click(await screen.findByRole('button', { name: /新建选项/ }))
    const dialog = await screen.findByRole('dialog', { name: '新建策略选项' })
    await user.type(within(dialog).getByLabelText('选项标识'), 'com.example.policy')
    fireEvent.change(within(dialog).getByLabelText('选项值（JSON 对象）'), {
      target: { value: '{oops' },
    })
    await user.click(within(dialog).getByRole('button', { name: '保存选项' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent('不是有效的 JSON')
    expect(mocks.actOnPolicyOption).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText('选项值（JSON 对象）'), {
      target: { value: '{"enabled":true}' },
    })
    await user.click(within(dialog).getByRole('button', { name: '保存选项' }))

    await waitFor(() =>
      expect(mocks.actOnPolicyOption).toHaveBeenCalledWith({
        operation: 'option.upsert',
        input: {
          key: 'com.example.policy',
          scope: 'instance',
          value: { enabled: true },
        },
      }),
    )
  })

  it('edits known policy keys with the structured form instead of raw JSON', async () => {
    const user = userEvent.setup()
    render(<PolicyPage />)

    await user.click(await screen.findByRole('button', { name: /新建选项/ }))
    const dialog = await screen.findByRole('dialog', { name: '新建策略选项' })
    fireEvent.change(within(dialog).getByLabelText('选项标识'), {
      target: { value: 'tools.ozone.setting.protectedTags' },
    })

    expect(within(dialog).getByText('保护标签')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('选项值（JSON 对象）')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '保存选项' }))

    await waitFor(() =>
      expect(mocks.actOnPolicyOption).toHaveBeenCalledWith({
        operation: 'option.upsert',
        input: {
          key: 'tools.ozone.setting.protectedTags',
          scope: 'instance',
          value: {
            新保护标签: { roles: ['tools.ozone.team.defs#roleAdmin'] },
          },
        },
      }),
    )
  })

  it('routes policy writes through an approval request when the server requires it', async () => {
    mocks.actOnPolicyOption.mockRejectedValue(
      new AdminApiError('conflict', 409, 'ApprovalRequired'),
    )
    const user = userEvent.setup()
    render(<PolicyPage />)

    await user.click(await screen.findByRole('button', { name: /新建选项/ }))
    const dialog = await screen.findByRole('dialog', { name: '新建策略选项' })
    await user.type(within(dialog).getByLabelText('选项标识'), 'com.example.policy')
    fireEvent.change(within(dialog).getByLabelText('选项值（JSON 对象）'), {
      target: { value: '{"enabled":true}' },
    })
    await user.click(within(dialog).getByRole('button', { name: '保存选项' }))

    const approvalDialog = await screen.findByRole('dialog', { name: '发起审批请求' })
    expect(within(approvalDialog).getByText('发布社区政策')).toBeInTheDocument()
    await user.click(
      within(approvalDialog).getByRole('button', { name: '发起审批请求' }),
    )

    await waitFor(() =>
      expect(mocks.createApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'policy.write',
          targetType: 'policy',
          target: 'com.example.policy',
          payload: {
            operation: 'option.upsert',
            input: {
              key: 'com.example.policy',
              scope: 'instance',
              value: { enabled: true },
            },
          },
        }),
      ),
    )
  })

  it('shows set members and adds values to the selected set', async () => {
    const user = userEvent.setup()
    render(<PolicyPage />)

    await user.click(await screen.findByRole('tab', { name: /对象集合/ }))
    expect(await screen.findByText('muted-accounts')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '查看成员' }))
    const detail = await screen.findByRole('dialog', { name: '集合成员' })
    expect(await within(detail).findByText('did:plc:one')).toBeInTheDocument()

    await user.click(within(detail).getByRole('button', { name: /添加值/ }))
    const addDialog = await screen.findByRole('dialog', { name: '向集合添加值' })
    fireEvent.change(within(addDialog).getByLabelText('成员值'), {
      target: { value: 'did:plc:three\ndid:plc:four\n' },
    })
    await user.click(within(addDialog).getByRole('button', { name: '添加值' }))

    await waitFor(() =>
      expect(mocks.actOnPolicySet).toHaveBeenCalledWith({
        operation: 'set.addValues',
        input: { name: 'muted-accounts', values: ['did:plc:three', 'did:plc:four'] },
      }),
    )
  })

  it('lists safelink rules with Chinese labels and creates a rule', async () => {
    const user = userEvent.setup()
    render(<PolicyPage />)

    await user.click(await screen.findByRole('tab', { name: /外链规则/ }))
    expect(await screen.findByText('example.com')).toBeInTheDocument()
    expect(screen.getByText('拦截访问')).toBeInTheDocument()
    expect(screen.getByText('儿童性虐待内容')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /新增规则/ }))
    const dialog = await screen.findByRole('dialog', { name: '新增外链规则' })
    await user.type(within(dialog).getByLabelText('规则地址'), 'bad.example')
    await user.click(within(dialog).getByRole('button', { name: '保存规则' }))

    await waitFor(() =>
      expect(mocks.actOnPolicySafelink).toHaveBeenCalledWith({
        operation: 'safelink.add',
        input: {
          url: 'bad.example',
          pattern: 'domain',
          action: 'block',
          reason: 'none',
        },
      }),
    )
  })

  it('renders the labeler configuration and its label definitions', async () => {
    const user = userEvent.setup()
    render(<PolicyPage />)

    await user.click(await screen.findByRole('tab', { name: /标签服务/ }))
    expect(await screen.findByText('社区标签服务')).toBeInTheDocument()
    expect(screen.getByText('垃圾信息')).toBeInTheDocument()
    expect(screen.getByText('警告')).toBeInTheDocument()
    expect(screen.getByText('默认提醒')).toBeInTheDocument()
  })

  it('explains why the labeler is unavailable and offers a retry', async () => {
    mocks.getLabelerConfig.mockResolvedValue({
      available: false,
      reason: '当前部署尚未在内容服务中注册标签器，标签信息暂不可用。',
    })
    const user = userEvent.setup()
    render(<PolicyPage />)

    await user.click(await screen.findByRole('tab', { name: /标签服务/ }))
    expect(await screen.findByText('标签服务当前不可用')).toBeInTheDocument()
    expect(
      screen.getByText('当前部署尚未在内容服务中注册标签器，标签信息暂不可用。'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重新加载/ })).toBeInTheDocument()
  })

  it('disables policy writes for readers without policy.write', async () => {
    mocks.permissions = ['policy.read']
    const user = userEvent.setup()
    render(<PolicyPage />)

    expect(await screen.findByText(/当前账号只有查看权限/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /新建选项/ })).toBeDisabled()

    await user.click(screen.getByRole('tab', { name: /对象集合/ }))
    expect(await screen.findByRole('button', { name: /新建集合/ })).toBeDisabled()

    await user.click(screen.getByRole('tab', { name: /外链规则/ }))
    expect(await screen.findByRole('button', { name: /新增规则/ })).toBeDisabled()
  })
})
