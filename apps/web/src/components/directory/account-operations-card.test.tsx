import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountOperation } from '@/lib/data/types'
import { AccountOperationsCard } from '@/components/directory/account-operations-card'

const mocks = vi.hoisted(() => ({
  did: 'did:plc:alice7x4k2m6q3n5p4w',
  getAccountProfile: vi.fn(),
  updateAccountProfile: vi.fn(),
  exportAccount: vi.fn(),
  downloadTextFile: vi.fn(),
}))

vi.mock('@/lib/download', () => ({
  downloadTextFile: mocks.downloadTextFile,
  exportTimestamp: () => '20261029-1200',
}))

vi.mock('@/lib/data/use-data-provider', () => {
  const provider = {
    getAccountProfile: mocks.getAccountProfile,
    updateAccountProfile: mocks.updateAccountProfile,
    exportAccount: mocks.exportAccount,
  }
  return { useDataProvider: () => provider }
})

const operation: AccountOperation = {
  did: mocks.did,
  note: '重点客户，已电话回访',
  tags: ['重点客户', '已回访'],
  syncPaused: false,
  updatedAt: '2026-10-28T02:00:00.000Z',
}

function renderCard(canWrite = true) {
  return render(
    <AccountOperationsCard did={mocks.did} handle="alice.example.com" canWrite={canWrite} />,
  )
}

describe('account operations card', () => {
  beforeEach(() => {
    mocks.getAccountProfile.mockReset()
    mocks.updateAccountProfile.mockReset()
    mocks.exportAccount.mockReset()
    mocks.downloadTextFile.mockReset()
    mocks.getAccountProfile.mockResolvedValue({ operation })
    mocks.updateAccountProfile.mockImplementation(async (input: Partial<AccountOperation>) => ({
      ...operation,
      ...input,
    }))
  })

  it('renders the stored operation record and saves edits', async () => {
    const user = userEvent.setup()
    renderCard()

    const note = await screen.findByLabelText('运营备注')
    expect(note).toHaveValue('重点客户，已电话回访')
    expect(screen.getByText(/已识别 2 个/)).toBeInTheDocument()
    expect(screen.getByText('重点客户', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText(/最近更新：/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存运营记录' })).toBeDisabled()

    await user.clear(note)
    await user.type(note, '  已升级为重点客户  ')
    await user.clear(screen.getByLabelText('标签'))
    await user.type(screen.getByLabelText('标签'), '重点客户，续约意向')

    expect(screen.getByText(/已识别 2 个/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存运营记录' }))

    await waitFor(() =>
      expect(mocks.updateAccountProfile).toHaveBeenCalledWith({
        did: mocks.did,
        note: '已升级为重点客户',
        tags: ['重点客户', '续约意向'],
      }),
    )
  })

  it('rejects more than ten tags before calling the provider', async () => {
    const user = userEvent.setup()
    renderCard()

    const tags = await screen.findByLabelText('标签')
    await user.clear(tags)
    await user.type(tags, Array.from({ length: 11 }, (_, index) => `标签${index}`).join(','))

    expect(screen.getByText('标签最多 10 个，当前有 11 个。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存运营记录' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '保存运营记录' }))
    expect(mocks.updateAccountProfile).not.toHaveBeenCalled()
  })

  it('rejects an overlong note and an overlong tag', async () => {
    const user = userEvent.setup()
    renderCard()

    const note = await screen.findByLabelText('运营备注')
    fireEvent.change(note, { target: { value: 'a'.repeat(501) } })
    expect(screen.getByText('运营备注最长 500 个字符。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存运营记录' })).toBeDisabled()

    fireEvent.change(note, { target: { value: '回访' } })
    const tags = screen.getByLabelText('标签')
    await user.clear(tags)
    fireEvent.change(tags, { target: { value: 'a'.repeat(25) } })
    expect(screen.getByText(/超过 24 个字符。$/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存运营记录' })).toBeDisabled()
  })

  it('keeps the record read-only without account operations permission', async () => {
    renderCard(false)

    expect(await screen.findByLabelText('运营备注')).toBeDisabled()
    expect(screen.getByLabelText('标签')).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存运营记录' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '暂停目录同步' })).toBeDisabled()
    expect(
      screen.getByText(/当前账号没有账号运营权限，只能查看运营记录/),
    ).toBeInTheDocument()
  })

  it('pauses directory sync only after confirmation', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(await screen.findByRole('button', { name: '暂停目录同步' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('暂停目录同步')).toBeInTheDocument()
    expect(within(dialog).getByText(/社区账号本身不受影响/)).toBeInTheDocument()
    expect(mocks.updateAccountProfile).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: '确认暂停' }))

    await waitFor(() =>
      expect(mocks.updateAccountProfile).toHaveBeenCalledWith({
        did: mocks.did,
        syncPaused: true,
      }),
    )
  })

  it('exports the operation record as a JSON download', async () => {
    mocks.exportAccount.mockResolvedValue({ document: { did: mocks.did, note: '重点客户' } })
    const user = userEvent.setup()
    renderCard()

    await user.click(await screen.findByRole('button', { name: '导出记录' }))

    await waitFor(() => expect(mocks.exportAccount).toHaveBeenCalledWith(mocks.did))
    expect(mocks.downloadTextFile).toHaveBeenCalledTimes(1)
    const [filename, content, mime] = mocks.downloadTextFile.mock.calls[0] ?? []
    expect(filename).toBe('account-alice.example.com-20261029-1200.json')
    expect(mime).toBe('application/json;charset=utf-8')
    expect(JSON.parse(content as string)).toEqual({ did: mocks.did, note: '重点客户' })
  })
})