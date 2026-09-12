import { useId, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from './button'
import { cn } from '@/lib/utils'

export function FileUpload({ label, accept, disabled = false, onSelect, className }: {
  label: string
  accept?: string
  disabled?: boolean
  onSelect: (file: File) => void | Promise<void>
  className?: string
}) {
  const id = useId()
  const [filename, setFilename] = useState('')

  return <div className={cn('flex min-w-0 flex-wrap items-center gap-3', className)}>
    <input id={id} type="file" className="peer sr-only" aria-label={label} aria-describedby={`${id}-filename`}
      accept={accept} disabled={disabled} onChange={(event) => {
        const file = event.target.files?.[0]
        // Reset so the same file can be selected again after editing it.
        event.target.value = ''
        if (!file || disabled) return
        setFilename(file.name)
        void onSelect(file)
      }} />
    <Button asChild variant="outline" className="cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-disabled:pointer-events-none peer-disabled:opacity-50">
      <label htmlFor={id}><Upload aria-hidden="true" />{label}を選択</label>
    </Button>
    <span id={`${id}-filename`} className="max-w-60 truncate text-sm text-muted-foreground" title={filename || undefined}>
      {filename || 'ファイル未選択'}
    </span>
  </div>
}
