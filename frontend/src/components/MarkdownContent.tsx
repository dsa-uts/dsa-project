import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { MarkdownCodeBlock } from '@/components/MarkdownCodeBlock'
import 'katex/dist/katex.min.css'
import './markdown.css'

export function MarkdownContent({ children, components }: { children: string; components?: Components }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex, [rehypeHighlight, { plainText: ['text', 'txt'], ignoreMissing: true }]]}
      components={{
        pre: MarkdownCodeBlock,
        table: ({ children }) => (
          <div className="my-6 overflow-x-auto">
            <table>{children}</table>
          </div>
        ),
        ...components,
      }}
    >
      {children}
    </Markdown>
  )
}
