import type { ReactNode } from 'react'

export function Page({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-background p-4 text-foreground">
      <section className="flex w-full max-w-sm flex-col gap-5 rounded-lg border bg-card p-6 shadow-sm">
        {children}
      </section>
    </main>
  )
}
