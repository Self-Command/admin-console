'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import type { RuntimeTheme } from '@/lib/runtime/types'
import { readableForeground } from '@/lib/runtime/theme'
import { cn } from '@/lib/utils'
import { ColorField } from './color-field'

const RADIUS_PRESETS = [0, 6, 10, 16, 24]

function Swatch({ color, label }: { color: string; label: string }) {
  const valid = /^#[0-9a-f]{6}$/i.test(color)
  return (
    <div className="space-y-1.5">
      <div
        className="flex h-9 items-center justify-center rounded-md text-xs font-medium shadow-xs"
        style={{
          backgroundColor: valid ? color : '#d4d4d8',
          color: valid ? readableForeground(color) : '#3f3f46',
        }}
      >
        {label}
      </div>
    </div>
  )
}

export function AppearanceSection({
  value,
  onChange,
}: {
  value: RuntimeTheme
  onChange: (next: RuntimeTheme) => void
}) {
  function update<K extends keyof RuntimeTheme>(key: K, next: RuntimeTheme[K]) {
    onChange({ ...value, [key]: next })
  }

  return (
    <div className="space-y-7">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4 rounded-lg border p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">浅色模式</p>
            <p className="text-xs text-muted-foreground">用于明亮环境与日间办公场景。</p>
          </div>
          <ColorField
            id="primary-light"
            label="主色"
            value={value.primaryLight}
            against="#ffffff"
            againstLabel="白色背景"
            onChange={(next) => update('primaryLight', next)}
          />
          <ColorField
            id="accent-light"
            label="强调色"
            value={value.accentLight}
            against="#ffffff"
            againstLabel="白色背景"
            onChange={(next) => update('accentLight', next)}
          />
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Swatch color={value.primaryLight} label="主按钮" />
            <Swatch color={value.accentLight} label="选中状态" />
          </div>
        </div>

        <div className="space-y-4 rounded-lg border border-white/10 bg-[#0b1020] p-4 text-white">
          <div className="space-y-1">
            <p className="text-sm font-medium">深色模式</p>
            <p className="text-xs text-white/60">用于夜间与低亮度环境。</p>
          </div>
          <ColorField
            id="primary-dark"
            label="主色"
            value={value.primaryDark}
            against="#0b1020"
            againstLabel="深色背景"
            onChange={(next) => update('primaryDark', next)}
          />
          <ColorField
            id="accent-dark"
            label="强调色"
            value={value.accentDark}
            against="#0b1020"
            againstLabel="深色背景"
            onChange={(next) => update('accentDark', next)}
          />
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Swatch color={value.primaryDark} label="主按钮" />
            <Swatch color={value.accentDark} label="选中状态" />
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="theme-radius">圆角大小</Label>
          <div className="flex items-center gap-2">
            <Input
              id="theme-radius"
              type="number"
              min={0}
              max={24}
              value={value.radius}
              onChange={(event) => update('radius', Number(event.target.value))}
              className="w-24"
            />
            <span className="text-xs text-muted-foreground">像素，范围 0–24</span>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {RADIUS_PRESETS.map((preset) => (
              <Button
                key={preset}
                type="button"
                variant={value.radius === preset ? 'secondary' : 'outline'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => update('radius', preset)}
              >
                {preset}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="theme-font">界面字体</Label>
          <Select
            id="theme-font"
            value={value.fontFamily}
            onChange={(event) =>
              update('fontFamily', event.target.value as RuntimeTheme['fontFamily'])
            }
          >
            <option value="sans">无衬线字体（默认，适合屏幕阅读）</option>
            <option value="serif">衬线字体（适合长文阅读）</option>
          </Select>
          <p className="text-xs text-muted-foreground">
            字体变更会影响全站正文与按钮文字。
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="theme-density">默认界面密度</Label>
          <Select
            id="theme-density"
            value={value.density}
            onChange={(event) =>
              update('density', event.target.value as RuntimeTheme['density'])
            }
          >
            <option value="comfortable">舒适（间距较大）</option>
            <option value="compact">紧凑（同屏显示更多内容）</option>
          </Select>
          <p className="text-xs text-muted-foreground">
            用户可在个人资料中覆盖此默认值。
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="theme-mode">默认明暗模式</Label>
          <Select
            id="theme-mode"
            value={value.defaultMode}
            onChange={(event) =>
              update('defaultMode', event.target.value as RuntimeTheme['defaultMode'])
            }
          >
            <option value="system">跟随系统</option>
            <option value="light">固定浅色</option>
            <option value="dark">固定深色</option>
          </Select>
          <p className="text-xs text-muted-foreground">
            未设置个人偏好的用户会使用此模式。
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">界面密度效果</p>
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          {['账号目录', '管理员与角色', '审计日志'].map((row) => (
            <div
              key={row}
              className={cn(
                'flex items-center justify-between rounded-md bg-background px-3 text-sm shadow-xs',
                value.density === 'compact' ? 'py-1.5' : 'py-3',
              )}
            >
              <span>{row}</span>
              <span className="text-xs text-muted-foreground">查看详情</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
