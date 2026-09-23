import { createElement, useEffect } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Accordion, Tooltip } from 'radix-ui'
import { ChevronRight, Upload } from 'lucide-react'
import { $api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { MarkdownContent } from '@/components/MarkdownContent'
import { SubmissionSummary } from './SubmissionSummary'

const heading: Components['h2'] = ({ children, node }) => createElement(node?.tagName === 'h1' ? 'h2' : node?.tagName ?? 'h2', { id: `section-${node?.position?.start.offset}`, className: 'scroll-mt-6', tabIndex: -1 }, children)
const outlineHeading: Components['h2'] = ({ children, node }) => <li><a href={`#section-${node?.position?.start.offset}`} className="block rounded-sm py-1.5 hover:text-link focus-visible:ring-2 focus-visible:ring-ring">{children}</a></li>

export function ProblemDetailPage() {
  const { projectId = '', workflowId } = useParams()
  const location = useLocation()
  const detail = $api.useQuery('get', '/api/projects/{project_id}', {
    params: { path: { project_id: projectId } },
  }, { retry: false })
  const project = detail.data
  const workflow = workflowId ? project?.workflows.find((item) => item.id === workflowId) : project?.workflows[0]
  // The page supplies the title; omit the same leading Markdown title.
  const description = workflow?.description_markdown.replace(/^# ([^\n]+)\r?\n?/, (title, name: string) => name.trim() === workflow.name ? '' : title) ?? ''

  useEffect(() => {
    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1))
      target?.scrollIntoView()
      target?.focus({ preventScroll: true })
    } else {
      window.scrollTo(0, 0)
    }
  }, [location.pathname, location.hash, description])

  if (detail.isPending) return <main className="p-8" role="status">読み込み中…</main>
  if (detail.isError || !project) return <main className="space-y-4 p-8">
    <p role="alert" className="text-destructive">{detail.error?.error.code === 'not_found' ? '課題が見つからないか、公開されていません。' : '課題を取得できませんでした。'}</p>
    <Button variant="outline" onClick={() => void detail.refetch()}>再読み込み</Button>
    <Link to="/projects" className="block text-link underline">Problem Listへ戻る</Link>
  </main>

  return <main className="mx-auto grid w-full max-w-screen-2xl flex-1 md:grid-cols-[18rem_minmax(0,1fr)] lg:grid-cols-[20rem_minmax(0,1fr)]">
    <aside className="min-w-0 border-b bg-muted/30 p-5 md:border-r md:border-b-0 md:p-6">
      <h2 className="mb-4 break-words text-xl font-bold">{project.name}</h2>
      <nav aria-label="課題の目次" className="space-y-2">
        <Accordion.Root key={workflow?.id} type="single" collapsible defaultValue={workflow?.id}>
        {project.workflows.map((item) => <Accordion.Item key={item.id} value={item.id}>
          <Accordion.Header><Accordion.Trigger asChild>
          <Link to={`/projects/${project.id}/${item.id}`} aria-current={item.id === workflow?.id ? 'page' : undefined} className="group flex items-center gap-3 rounded-md px-3 py-3 font-semibold hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-link/10 aria-[current=page]:text-link">
            <ChevronRight className="size-5 shrink-0 group-data-[state=open]:rotate-90" aria-hidden="true" /><span className="min-w-0 break-words">{item.name}</span>
          </Link>
          </Accordion.Trigger></Accordion.Header>
          <Accordion.Content>{item.id === workflow?.id && <ul className="my-2 ml-6 border-l pl-4 text-sm">
            <Markdown remarkPlugins={[remarkGfm]} allowedElements={['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'code', 'em', 'strong', 'del', 'a']} components={{ h1: outlineHeading, h2: outlineHeading, h3: outlineHeading, h4: outlineHeading, h5: outlineHeading, h6: outlineHeading, a: ({ children }) => <>{children}</>, code: ({ children }) => <>{children}</> }}>{description}</Markdown>
          </ul>}</Accordion.Content>
        </Accordion.Item>)}
        </Accordion.Root>
      </nav>
      <section aria-labelledby="upload-title" className="mt-8 space-y-4 rounded-md border bg-card p-4">
        <h2 id="upload-title" className="text-xl font-bold">課題を提出</h2>
        {project.required_files.length > 0 && <ul aria-label="提出が求められているファイル" className="rounded-md bg-muted p-3 font-mono text-sm">
          {project.required_files.map((file, index) => <li key={index} className="break-words whitespace-pre-wrap">{file}</li>)}
        </ul>}
        <div className="flex flex-col items-center gap-3 rounded-md border-2 border-dashed p-4 text-muted-foreground">
          <Upload className="size-8" aria-hidden="true" />
          <span className="text-sm">ファイルをドロップ</span><span className="text-sm">または</span>
          <Button variant="outline" disabled>ファイルを選択</Button>
        </div>
        <p className="text-sm text-muted-foreground">未選択</p>
        <Button className="w-full" disabled>提出する</Button>
        <p className="text-sm text-muted-foreground">提出機能は準備中です。</p>
      </section>
    </aside>
    <div className="min-w-0 space-y-5 bg-card p-5 sm:p-8">
      <nav aria-label="パンくずリスト"><ol className="flex flex-wrap items-center gap-2 text-sm">
        <li><Link to="/projects" className="text-link hover:underline">Problem List</Link></li>
        <li aria-hidden="true">/</li><li><Link to={`/projects/${project.id}`} className="text-link hover:underline">{project.name}</Link></li>
        {workflow && <><li aria-hidden="true">/</li><li aria-current="page">{workflow.name}</li></>}
      </ol></nav>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2"><span>{project.name}</span><Tooltip.Provider><SubmissionSummary project={project} /></Tooltip.Provider></div>
      {workflow ? <article key={workflow.id} lang="ja" className="markdown-content min-w-0">
        <h1 className="!mb-6 !text-4xl sm:!text-5xl">{workflow.name}</h1>
        {description.trim() ? <MarkdownContent components={{ h1: heading, h2: heading, h3: heading, h4: heading, h5: heading, h6: heading, img: () => null }}>{description}</MarkdownContent> : <p className="text-muted-foreground">課題説明はまだ登録されていません。</p>}
      </article> : <p role="alert">{workflowId ? '指定された問題が見つかりません。左の目次から選択してください。' : '問題はまだ登録されていません。'}</p>}
    </div>
  </main>
}
