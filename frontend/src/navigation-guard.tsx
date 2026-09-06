import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useBlocker } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'

const message = '一覧とパスワードは保存されません。このページを離れますか？'
const GuardContext = createContext({ setGuard: (_guard: { active: boolean; busy: boolean }) => {}, canLeave: (): boolean => true })

export function NavigationGuard({ children }: { children: ReactNode }) {
  const [guard, setGuard] = useState({ active: false, busy: false })
  const blocker = useBlocker(guard.active)
  useEffect(() => {
    if (!guard.active) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [guard.active])
  return <GuardContext value={{ setGuard, canLeave: () => !guard.active || (!guard.busy && window.confirm(message)) }}>
    {children}
    {blocker.state === 'blocked' && <Dialog title="ページを離れる" description={guard.busy ? '作成処理が終わるまでお待ちください。' : message} onClose={() => blocker.reset()} busy={guard.busy}>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => blocker.reset()}>戻る</Button>
        <Button disabled={guard.busy} onClick={() => blocker.proceed()}>離れる</Button>
      </div>
    </Dialog>}
  </GuardContext>
}

// oxlint-disable-next-line react/only-export-components
export function useNavigationGuard() { return useContext(GuardContext) }
