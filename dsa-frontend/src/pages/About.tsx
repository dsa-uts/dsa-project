
import Markdown from 'react-markdown';
import markdownContent from './About.md?raw';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import rehypeRaw from 'rehype-raw';

const About: React.FC = () => {
  return (
    <div className='container mx-auto px-4 py-8 max-w-6xl'>
      <div className='bg-white rounded-lg shadow-lg p-8'>
        <div className="prose prose-lg max-w-none 
                      prose-headings:text-gray-800 
                      prose-h1:text-3xl prose-h1:font-bold prose-h1:mb-6 prose-h1:mt-8 
                      prose-h2:text-2xl prose-h2:font-semibold prose-h2:mb-4 prose-h2:mt-6 
                      prose-h3:text-xl prose-h3:font-semibold prose-h3:mb-3 prose-h3:mt-4 
                      prose-p:text-gray-700 prose-p:leading-relaxed prose-p:mb-4 
                      prose-a:text-blue-600 prose-a:underline hover:prose-a:text-blue-800 
                      prose-strong:font-semibold 
                      prose-code:bg-gray-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:font-mono 
                      prose-pre:bg-gray-900 prose-pre:p-0 prose-pre:overflow-hidden 
                      prose-ul:list-disc prose-ul:pl-6 
                      prose-ol:list-decimal prose-ol:pl-6 
                      prose-li:mb-2 
                      prose-blockquote:border-l-4 prose-blockquote:border-gray-300 prose-blockquote:pl-4 prose-blockquote:italic 
                      prose-table:w-full 
                      prose-th:bg-gray-100 prose-th:p-2 prose-th:text-left prose-th:font-semibold p
                      rose-td:p-2 prose-td:border-t prose-td:border-gray-200">
          <Markdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex, rehypeRaw]}
            components={{
              // Customization of code block
              pre: ({ children }) => (
                <div className="relative group">
                  <pre className="overflow-x-auto">{children}</pre>
                  <button
                    className="absolute top-2 right-2 bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs"
                    onClick={(e) => {
                      const code = e.currentTarget.parentElement?.querySelector('code')?.textContent;
                      if (code) navigator.clipboard.writeText(code);
                    }}
                  >Copy</button>
                </div>
              ),
              // Customization of inline code
              code({ node, className, children, ...rest }) {
                const match = /language-(\w+)/.exec(className || '');
                const isCodeBlock = !!match;
                const language = isCodeBlock ? match[1] : '';
                if (isCodeBlock) {
                  // return <code className="px-0 py-0.5 rounded text-sm" {...rest}>{children}</code>
                  return (
                    <SyntaxHighlighter
                      // refを除くrest
                      className="text-base"
                      PreTag="pre"
                      children={String(children).replace(/\n$/, '')}
                      language={language}
                      style={oneDark}
                    />
                  )
                }
                return (
                  <code className="bg-gray-100 text-pink-600 px-1 py-0.5 rounded text-sm before:content-[''] after:content-['']" {...rest}>
                    {children}
                  </code>
                );
              },
              // Customization of link
              a: ({ children, href }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 no-underline hover:underline inline-flex items-center gap-1"
                >
                  {children}
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              ),
              // // テーブルのカスタマイズ
              // table: ({ children }) => (
              //   <div className="overflow-x-auto my-6">
              //     <table className="min-w-full divide-y divide-gray-200">
              //       {children}
              //     </table>
              //   </div>
              // ),
              // thead: ({ children }) => (
              //   <thead className="bg-gray-50">
              //     {children}
              //   </thead>
              // ),
              // tbody: ({ children }) => (
              //   <tbody className="bg-white divide-y divide-gray-200">
              //     {children}
              //   </tbody>
              // ),
              // tr: ({ children }) => (
              //   <tr className="hover:bg-gray-50 transition-colors">
              //     {children}
              //   </tr>
              // ),
              // th: ({ children }) => (
              //   <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              //     {children}
              //   </th>
              // ),
              // td: ({ children }) => (
              //   <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
              //     {children}
              //   </td>
              // ),
            }}
          >
            {markdownContent}
          </Markdown>
        </div>
      </div>
    </div>
  )
}

export default About;
