import { useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  const codeRef = useRef<HTMLPreElement>(null)
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(codeRef.current?.textContent ?? '')
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
  }

  return (
    <div className="markdown-code-block">
      <Button type="button" size="sm" className="markdown-code-copy" onClick={copyCode}>
        {status === 'copied' ? 'Copied!' : 'Copy'}
      </Button>
      <pre ref={codeRef}>{children}</pre>
      <span role="status" className={status === 'failed' ? 'markdown-code-error' : 'sr-only'}>
        {status === 'copied' && 'Code copied to clipboard.'}
        {status === 'failed' && 'Unable to copy. Please select and copy the code manually.'}
      </span>
    </div>
  )
}
