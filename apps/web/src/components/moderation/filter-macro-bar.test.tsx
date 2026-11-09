import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FilterMacroBar } from '@/components/moderation/filter-macro-bar'
import type { FilterMacro, Preferences } from '@/lib/runtime/types'

const mocks = vi.hoisted(() => ({
  preferences: {} as Preferences,
  savePreferences: vi.fn(),
  onApply: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/components/layout/workspace-provider', () => ({
  useWorkspace: () => ({
    status: 'ready',
    preferences: mocks.preferences,
    savingPreferences: false,
    savePreferences: mocks.savePreferences,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const urgentMacro: FilterMacro = {
  id: 'urgent',
  name: '紧急举报',
  scope: 'reports',
  filters: { status: 'escalated', direction: 'asc' },
}

const recentMacro: FilterMacro = {
  id: 'recent',
  name: '近期事件',
  scope: 'reports',
  filters: { direction: 'asc' },
}

describe('filter macro bar', () => {
  beforeEach(() => {
    mocks.preferences = {}
    mocks.savePreferences.mockReset()
    mocks.savePreferences.mockResolvedValue(true)
    mocks.onApply.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()
  })

  it('applies a saved macro through the page callback', async () => {
    mocks.preferences = { filterMacros: [urgentMacro] }
    const user = userEvent.setup()
    render(<FilterMacroBar scope="reports" current={{}} onApply={mocks.onApply} />)

    await user.click(screen.getByRole('button', { name: '应用筛选宏：紧急举报' }))

    expect(mocks.onApply).toHaveBeenCalledWith({ status: 'escalated', direction: 'asc' })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('已应用筛选宏「紧急举报」。')
  })

  it('saves the current filters as a macro for this page only', async () => {
    const user = userEvent.setup()
    render(
      <FilterMacroBar
        scope="reports"
        current={{ status: 'escalated', queue: 'abuse' }}
        onApply={mocks.onApply}
      />,
    )

    await user.click(screen.getByRole('button', { name: '保存当前筛选' }))
    await user.type(screen.getByLabelText('名称'), '紧急举报')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mocks.savePreferences).toHaveBeenCalledTimes(1))
    const patch = mocks.savePreferences.mock.calls.at(0)?.[0] as { filterMacros: FilterMacro[] }
    expect(patch.filterMacros).toHaveLength(1)
    expect(patch.filterMacros[0]).toMatchObject({
      name: '紧急举报',
      scope: 'reports',
      isDefault: true,
      filters: { status: 'escalated', queue: 'abuse' },
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('已保存筛选宏「紧急举报」。')
  })

  it('rejects a duplicate macro name on the same page', async () => {
    mocks.preferences = { filterMacros: [urgentMacro] }
    const user = userEvent.setup()
    render(<FilterMacroBar scope="reports" current={{}} onApply={mocks.onApply} />)

    await user.click(screen.getByRole('button', { name: '保存当前筛选' }))
    await user.type(screen.getByLabelText('名称'), '紧急举报')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(
      await screen.findByText('当前页面已存在同名筛选宏，请使用其他名称。'),
    ).toBeInTheDocument()
    expect(mocks.savePreferences).not.toHaveBeenCalled()
  })

  it('applies the default macro once when the workspace is ready', async () => {
    mocks.preferences = { filterMacros: [{ ...urgentMacro, isDefault: true }] }
    const { rerender } = render(
      <FilterMacroBar scope="reports" current={{}} onApply={mocks.onApply} />,
    )

    await waitFor(() =>
      expect(mocks.onApply).toHaveBeenCalledWith({ status: 'escalated', direction: 'asc' }),
    )
    rerender(<FilterMacroBar scope="reports" current={{}} onApply={mocks.onApply} />)
    expect(mocks.onApply).toHaveBeenCalledTimes(1)
  })

  it('keeps only one default macro when marking another as default', async () => {
    mocks.preferences = {
      filterMacros: [
        { id: 'old', name: '旧默认', scope: 'reports', isDefault: true },
        { id: 'new', name: '新默认', scope: 'reports' },
      ],
    }
    const user = userEvent.setup()
    render(
      <FilterMacroBar scope="reports" current={{}} onApply={mocks.onApply} autoApply={false} />,
    )

    await user.click(screen.getByRole('button', { name: '管理' }))
    await user.click(screen.getByRole('button', { name: '设为默认' }))

    await waitFor(() => expect(mocks.savePreferences).toHaveBeenCalledTimes(1))
    const patch = mocks.savePreferences.mock.calls.at(0)?.[0] as { filterMacros: FilterMacro[] }
    expect(patch.filterMacros).toEqual([
      { id: 'old', name: '旧默认', scope: 'reports' },
      { id: 'new', name: '新默认', scope: 'reports', isDefault: true },
    ])
  })

  it('renames and deletes macros from the manage dialog', async () => {
    mocks.preferences = { filterMacros: [urgentMacro, recentMacro] }
    const user = userEvent.setup()
    render(
      <FilterMacroBar scope="reports" current={{}} onApply={mocks.onApply} autoApply={false} />,
    )

    await user.click(screen.getByRole('button', { name: '管理' }))
    await user.click(screen.getByRole('button', { name: '重命名筛选宏：紧急举报' }))
    const renameDialog = screen.getByRole('dialog', { name: '重命名筛选宏' })
    const input = within(renameDialog).getByLabelText('名称')
    await user.clear(input)
    await user.type(input, '高优举报')
    await user.click(within(renameDialog).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mocks.savePreferences).toHaveBeenCalledTimes(1))
    let patch = mocks.savePreferences.mock.calls.at(0)?.[0] as { filterMacros: FilterMacro[] }
    expect(patch.filterMacros[0]).toMatchObject({ id: 'urgent', name: '高优举报' })

    await user.click(screen.getByRole('button', { name: '删除筛选宏：近期事件' }))
    const confirm = await screen.findByRole('alertdialog')
    await user.click(within(confirm).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(mocks.savePreferences).toHaveBeenCalledTimes(2))
    patch = mocks.savePreferences.mock.calls.at(1)?.[0] as { filterMacros: FilterMacro[] }
    expect(patch.filterMacros.map((macro) => macro.id)).toEqual(['urgent'])
    expect(mocks.toastSuccess).toHaveBeenCalledWith('已删除筛选宏「近期事件」。')
  })
})
