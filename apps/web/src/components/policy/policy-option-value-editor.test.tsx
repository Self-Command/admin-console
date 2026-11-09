import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  PolicyOptionValueEditor,
  STRUCTURED_POLICY_KEYS,
  isStructuredPolicyKey,
  policyValueTemplate,
  validatePolicyValue,
} from '@/components/policy/policy-option-value-editor'

const KEYS = {
  priority: 'tools.ozone.setting.priorityLevels',
  report: 'tools.ozone.setting.reportPriorityLevels',
  severity: 'tools.ozone.setting.severityLevels',
  protectedTags: 'tools.ozone.setting.protectedTags',
  labelGroups: 'tools.ozone.setting.labelGroups',
  policyList: 'tools.ozone.setting.policyList',
} as const

type ValueMap = Record<string, unknown>

function Harness({
  valueKey,
  initialValue,
  onChange,
}: {
  valueKey: string
  initialValue: ValueMap
  onChange: (next: ValueMap) => void
}) {
  const [value, setValue] = useState<ValueMap>(initialValue)
  return (
    <PolicyOptionValueEditor
      valueKey={valueKey}
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

function renderEditor(valueKey: string, initialValue: ValueMap) {
  let latest = initialValue
  const onChange = vi.fn((next: ValueMap) => {
    latest = next
  })
  render(<Harness valueKey={valueKey} initialValue={initialValue} onChange={onChange} />)
  return { onChange, latest: () => latest }
}

describe('structured policy keys', () => {
  it('recognizes exactly the six known policy options', () => {
    expect(STRUCTURED_POLICY_KEYS).toEqual(Object.values(KEYS))
    for (const key of Object.values(KEYS)) {
      expect(isStructuredPolicyKey(key)).toBe(true)
    }
    expect(isStructuredPolicyKey('tools.ozone.setting.custom')).toBe(false)
    expect(isStructuredPolicyKey('tools.ozone.setting.prioritylevels')).toBe(false)
    expect(isStructuredPolicyKey('')).toBe(false)
  })

  it('returns a valid template for every structured key and an empty object otherwise', () => {
    for (const key of Object.values(KEYS)) {
      const template = policyValueTemplate(key)
      expect(Object.keys(template).length).toBeGreaterThan(0)
      expect(validatePolicyValue(key, template)).toBeNull()
    }
    expect(policyValueTemplate('tools.ozone.setting.custom')).toEqual({})
  })

  it('renders nothing for an unknown key', () => {
    const { container } = render(
      <PolicyOptionValueEditor
        valueKey="tools.ozone.setting.custom"
        value={{ enabled: true }}
        onChange={vi.fn()}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('priority levels editor', () => {
  it('adds a level, updates its fields and rejects a fractional score', () => {
    const { onChange } = renderEditor(KEYS.priority, {})

    fireEvent.click(screen.getByRole('button', { name: '添加层级' }))
    expect(onChange).toHaveBeenLastCalledWith({
      新层级: { name: '新层级', targetResolutionMinutes: 60, score: 50 },
    })

    fireEvent.change(screen.getByLabelText('层级名称'), { target: { value: '紧急' } })
    fireEvent.change(screen.getByLabelText('目标处理时长（分钟）'), {
      target: { value: '30' },
    })
    fireEvent.change(screen.getByLabelText('优先级分值'), { target: { value: '90' } })
    expect(onChange).toHaveBeenLastCalledWith({
      新层级: { name: '紧急', targetResolutionMinutes: 30, score: 90 },
    })

    fireEvent.change(screen.getByLabelText('优先级分值'), { target: { value: '90.5' } })
    expect(screen.getByText('分值必须是 0 到 100 之间的整数。')).toBeInTheDocument()
  })
})

describe('report priority levels editor', () => {
  it('adds, renames and removes mappings without overwriting an existing key', () => {
    const { onChange } = renderEditor(KEYS.report, { 垃圾信息: '标准' })

    fireEvent.click(screen.getByRole('button', { name: '添加映射' }))
    expect(onChange).toHaveBeenLastCalledWith({
      垃圾信息: '标准',
      新举报原因: '新层级',
    })

    fireEvent.change(screen.getAllByLabelText('优先级标识')[1]!, { target: { value: '高' } })
    expect(onChange).toHaveBeenLastCalledWith({ 垃圾信息: '标准', 新举报原因: '高' })

    const reasonInputs = screen.getAllByLabelText('举报原因')
    fireEvent.change(reasonInputs[1]!, { target: { value: '骚扰' } })
    fireEvent.blur(reasonInputs[1]!)
    expect(onChange).toHaveBeenLastCalledWith({ 垃圾信息: '标准', 骚扰: '高' })

    const renamedInputs = screen.getAllByLabelText('举报原因')
    fireEvent.change(renamedInputs[0]!, { target: { value: '骚扰' } })
    fireEvent.blur(renamedInputs[0]!)
    expect(screen.getByText('键名“骚扰”已存在，请更换名称。')).toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith({ 垃圾信息: '标准', 骚扰: '高' })

    fireEvent.click(screen.getByRole('button', { name: '删除映射 垃圾信息' }))
    expect(onChange).toHaveBeenLastCalledWith({ 骚扰: '高' })
  })
})

describe('protected tags editor', () => {
  it('converts comma separated moderators and roles into string arrays', () => {
    const { onChange } = renderEditor(KEYS.protectedTags, { 敏感内容: {} })

    expect(
      screen.getByText(/建议至少填写一个审核员账号或管理角色/),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('审核员账号（可选）'), {
      target: { value: 'did:plc:alice, did:plc:bob ,' },
    })
    expect(onChange).toHaveBeenLastCalledWith({
      敏感内容: { moderators: ['did:plc:alice', 'did:plc:bob'] },
    })

    fireEvent.change(screen.getByLabelText('管理角色（可选）'), {
      target: {
        value:
          'tools.ozone.team.defs#roleAdmin，tools.ozone.team.defs#roleModerator',
      },
    })
    expect(onChange).toHaveBeenLastCalledWith({
      敏感内容: {
        moderators: ['did:plc:alice', 'did:plc:bob'],
        roles: [
          'tools.ozone.team.defs#roleAdmin',
          'tools.ozone.team.defs#roleModerator',
        ],
      },
    })
    expect(
      screen.queryByText(/建议至少填写一个审核员账号或管理角色/),
    ).not.toBeInTheDocument()
  })
})

describe('label groups editor', () => {
  it('requires at least one label and validates the color format', () => {
    const { latest } = renderEditor(KEYS.labelGroups, { 垃圾内容: { labels: [] } })

    expect(screen.getByText('请至少填写一个标签。')).toBeInTheDocument()
    expect(validatePolicyValue(KEYS.labelGroups, latest())).not.toBeNull()

    fireEvent.change(screen.getByLabelText('标签'), {
      target: { value: '垃圾信息, 骚扰' },
    })
    expect(screen.queryByText('请至少填写一个标签。')).not.toBeInTheDocument()
    expect(validatePolicyValue(KEYS.labelGroups, latest())).toBeNull()

    fireEvent.change(screen.getByLabelText('颜色（可选）'), {
      target: { value: 'blue' },
    })
    expect(screen.getByText('颜色必须是 #RRGGBB 格式。')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('颜色（可选）'), {
      target: { value: '#1D4ED8' },
    })
    expect(screen.queryByText('颜色必须是 #RRGGBB 格式。')).not.toBeInTheDocument()
    expect(latest()).toEqual({
      垃圾内容: { labels: ['垃圾信息', '骚扰'], color: '#1D4ED8' },
    })
  })
})

describe('policy list editor', () => {
  it('shows field errors for an invalid URL and invalid severity JSON', () => {
    const { onChange } = renderEditor(KEYS.policyList, {
      骚扰: { name: '骚扰', description: '禁止骚扰行为。' },
    })

    fireEvent.change(screen.getByLabelText('政策链接（可选）'), {
      target: { value: 'ftp://example.com/policy' },
    })
    expect(
      screen.getByText('政策链接必须以 http:// 或 https:// 开头。'),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('政策链接（可选）'), {
      target: { value: 'https://example.com/policy' },
    })
    expect(
      screen.queryByText('政策链接必须以 http:// 或 https:// 开头。'),
    ).not.toBeInTheDocument()

    const severity = screen.getByLabelText('严重度配置（JSON 对象）')
    fireEvent.change(severity, { target: { value: '{invalid' } })
    expect(
      screen.getByText('严重度配置不是有效的 JSON 对象。'),
    ).toBeInTheDocument()

    fireEvent.change(severity, {
      target: {
        value: JSON.stringify(
          {
            标准: {
              description: '标准处置。',
              isDefault: true,
              targetServices: ['appview'],
            },
          },
          null,
          2,
        ),
      },
    })
    expect(
      screen.queryByText('严重度配置不是有效的 JSON 对象。'),
    ).not.toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith({
      骚扰: {
        name: '骚扰',
        description: '禁止骚扰行为。',
        url: 'https://example.com/policy',
        severityLevels: {
          标准: {
            description: '标准处置。',
            isDefault: true,
            targetServices: ['appview'],
          },
        },
      },
    })
  })
})

describe('validatePolicyValue', () => {
  const validValues: Record<string, ValueMap> = {
    [KEYS.priority]: {
      高: { name: '高', targetResolutionMinutes: 60, score: 90 },
    },
    [KEYS.report]: { 垃圾信息: '高' },
    [KEYS.severity]: { 高: { name: '高', strikeCount: 2, needsTakedown: true } },
    [KEYS.protectedTags]: {
      敏感内容: {
        moderators: ['did:plc:alice'],
        roles: ['tools.ozone.team.defs#roleAdmin'],
      },
    },
    [KEYS.labelGroups]: {
      垃圾信息: { labels: ['spam'], color: '#1D4ED8' },
    },
    [KEYS.policyList]: {
      骚扰: {
        name: '骚扰',
        description: '禁止骚扰行为。',
        url: 'https://example.com/policy',
        emailBullets: '说明风险',
        severityLevels: {
          标准: {
            description: '标准处置。',
            isDefault: true,
            targetServices: ['appview', 'pds'],
          },
        },
      },
    },
  }

  it('accepts a valid value for each known key', () => {
    for (const key of Object.values(KEYS)) {
      expect(validatePolicyValue(key, validValues[key])).toBeNull()
    }
  })

  it('returns a Chinese error for each invalid known key', () => {
    expect(
      validatePolicyValue(KEYS.priority, {
        高: { name: '高', targetResolutionMinutes: 0, score: 90 },
      }),
    ).toContain('大于等于 1')
    expect(
      validatePolicyValue(KEYS.priority, {
        高: { name: '高', targetResolutionMinutes: 60, score: 101 },
      }),
    ).toContain('0 到 100')
    expect(
      validatePolicyValue(KEYS.priority, {
        高: { name: '高', targetResolutionMinutes: 60, score: 90 },
        紧急: { name: '高', targetResolutionMinutes: 30, score: 80 },
      }),
    ).toContain('重复')
    expect(
      validatePolicyValue(KEYS.priority, {
        高: { name: '高', targetResolutionMinutes: 60, score: 90, extra: true },
      }),
    ).toContain('无法识别的字段')

    expect(validatePolicyValue(KEYS.report, { 垃圾信息: ' ' })).toContain(
      '优先级标识不能为空',
    )

    expect(
      validatePolicyValue(KEYS.severity, {
        高: { name: '高', strikeCount: -1 },
      }),
    ).toContain('大于等于 0')
    expect(
      validatePolicyValue(KEYS.severity, {
        高: { name: '高', needsTakedown: 'yes' },
      }),
    ).toContain('布尔值')

    expect(
      validatePolicyValue(KEYS.protectedTags, {
        敏感内容: { moderators: 'did:plc:alice' },
      }),
    ).toContain('字符串数组')
    expect(
      validatePolicyValue(KEYS.protectedTags, {
        敏感内容: { moderators: ['alice'] },
      }),
    ).toContain('did:')

    expect(
      validatePolicyValue(KEYS.labelGroups, { 垃圾信息: { labels: [] } }),
    ).toContain('至少需要一个标签')
    expect(
      validatePolicyValue(KEYS.labelGroups, {
        垃圾信息: { labels: ['spam'], color: 'blue' },
      }),
    ).toContain('#RRGGBB')

    expect(
      validatePolicyValue(KEYS.policyList, {
        骚扰: { name: '骚扰', description: '' },
      }),
    ).toContain('说明不能为空')
    expect(
      validatePolicyValue(KEYS.policyList, {
        骚扰: { name: '骚扰', description: '禁止骚扰行为。', url: 'ftp://example.com' },
      }),
    ).toContain('http://')
    expect(
      validatePolicyValue(KEYS.policyList, {
        骚扰: {
          name: '骚扰',
          description: '禁止骚扰行为。',
          severityLevels: {
            标准: { description: '', isDefault: true },
          },
        },
      }),
    ).toContain('说明不能为空')
    expect(
      validatePolicyValue(KEYS.policyList, {
        骚扰: {
          name: '骚扰',
          description: '禁止骚扰行为。',
          severityLevels: {
            标准: { description: '标准处置。', isDefault: 'yes' },
          },
        },
      }),
    ).toContain('布尔值')
    expect(
      validatePolicyValue(KEYS.policyList, {
        骚扰: {
          name: '骚扰',
          description: '禁止骚扰行为。',
          severityLevels: {
            标准: {
              description: '标准处置。',
              isDefault: true,
              targetServices: ['labeler'],
            },
          },
        },
      }),
    ).toContain('appview 或 pds')
  })

  it('rejects non-object values only for known keys', () => {
    expect(validatePolicyValue(KEYS.priority, null)).toBe('选项值必须是 JSON 对象。')
    expect(validatePolicyValue(KEYS.labelGroups, ['spam'])).toBe(
      '选项值必须是 JSON 对象。',
    )
    expect(validatePolicyValue('tools.ozone.setting.custom', 'anything')).toBeNull()
  })
})
