import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { MarkdownCodeBlock } from '@/components/MarkdownCodeBlock'
import 'katex/dist/katex.min.css'
import markdownContent from './about.md?raw'
import './about.css'

export function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <article className="about-markdown min-w-0 rounded-lg border bg-card p-4 text-card-foreground shadow-sm sm:p-8" lang="ja">
        <Markdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, [rehypeHighlight, { plainText: ['text', 'txt'] }]]}
          components={{
            pre: MarkdownCodeBlock,
            table: ({ children }) => (
              <div className="my-6 overflow-x-auto">
                <table>{children}</table>
              </div>
            ),
          }}
        >
          {markdownContent}
        </Markdown>
      </article>
    </main>
  )
}
