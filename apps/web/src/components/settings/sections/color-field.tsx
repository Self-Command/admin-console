'use client'

import { HexColorPicker } from 'react-colorful'
import { CheckIcon, TriangleAlertIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { contrastRatio } from '@/lib/runtime/theme'

const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function ColorField({
  id,
  label,
  value,
  against,
  againstLabel,
  onChange,
}: {
  id: string
  label: string
  value: string
  against: string
  againstLabel: string
  onChange: (value: string) => void
}) {
  const valid = HEX_COLOR.test(value)
  const ratio = valid ? contrastRatio(value, against) : null
  const passes = ratio !== null && ratio >= 3

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`选择${label}`}
              className="size-9 shrink-0 rounded-md border shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              style={{ backgroundColor: valid ? value : '#d4d4d8' }}
            />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3">
            <HexColorPicker color={valid ? value : '#000000'} onChange={onChange} />
          </PopoverContent>
        </Popover>
        <Input
          id={id}
          value={value}
          maxLength={7}
          spellCheck={false}
          className="font-mono"
          aria-invalid={!valid || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <p
        className={
          ratio === null || passes
            ? 'text-[11px] text-muted-foreground'
            : 'text-[11px] text-destructive'
        }
      >
        {ratio === null ? (
          '请输入 #rrggbb 格式的颜色'
        ) : passes ? (
          <span className="inline-flex items-center gap-1">
            <CheckIcon className="size-3" />
            与{againstLabel}对比度 {ratio.toFixed(1)}:1
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <TriangleAlertIcon className="size-3" />
            与{againstLabel}对比度仅 {ratio.toFixed(1)}:1，需要达到 3.0
          </span>
        )}
      </p>
    </div>
  )
}
