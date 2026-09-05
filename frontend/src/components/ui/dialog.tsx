import { Dialog as DialogPrimitive } from 'radix-ui'
import type { ReactNode } from 'react'

export function Dialog({ title, description, children, onClose, busy = false }: {
  title: string
  description: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
}) {
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90svh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg border bg-card p-6 text-foreground shadow-lg">
          <DialogPrimitive.Title className="text-xl font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-sm text-muted-foreground">{description}</DialogPrimitive.Description>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
