import { MarkdownContent } from '@/components/MarkdownContent'
import markdownContent from './about.md?raw'

export function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <article className="markdown-content min-w-0 rounded-lg border bg-card p-4 text-card-foreground shadow-sm sm:p-8" lang="ja">
        <MarkdownContent>{markdownContent}</MarkdownContent>
      </article>
    </main>
  )
}
