import { createElement, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Element, Root } from 'hast'
import { Accordion } from 'radix-ui'
import { ChevronRight } from 'lucide-react'
import { $api } from '@/api/client'
import type { components } from '@/api/schema'
import { MarkdownContent } from '@/components/MarkdownContent'
import { ValidationSubmitForm } from './ValidationSubmitForm'

const heading: Components['h2'] = ({ children, node }) =>
  createElement(
    `h${Math.min(Number(node?.tagName[1] ?? 1) + 1, 6)}`, // type
    { // props
      id: `section-${node?.position?.start.offset}`,
      className: 'scroll-mt-6',
      tabIndex: -1
    },
    children // ...children
  )
const outlineHeading: Components['h2'] = ({ children, node }) =>
  <a href={`#section-${node?.position?.start.offset}`}
    className="block rounded-sm py-1.5 hover:text-link focus-visible:ring-2 focus-visible:ring-ring">
    {children}
  </a>

function rehypeOutline() {
  /**
    * ============= Input ===============
    * "└─" or "├─" means "children"
    *
    * root
    * ├─ element: h2
    * │  └─ text: "入力"
    * ├─ element: p
    * │  └─ text: "入力の説明です。"
    * ├─ element: h3
    * │  └─ text: "形式"
    * ├─ element: p
    * │  └─ text: "形式の説明です。"
    * ├─ element: h3
    * │  └─ text: "制約"
    * ├─ element: p
    * │  └─ text: "制約の説明です。"
    * ├─ element: h2
    * │  └─ text: "出力"
    * └─ element: p
    *    └─ text: "出力の説明です。"
    * 
    * ============== Output ==============
    *
    * root
    * └─ element: ul
    *    ├─ element: li
    *    │  ├─ element: h2
    *    │  │  └─ text: "入力"
    *    │  └─ element: ul
    *    │     ├─ element: li
    *    │     │  └─ element: h3
    *    │     │     └─ text: "形式"
    *    │     └─ element: li
    *    │        └─ element: h3
    *    │           └─ text: "制約"
    *    └─ element: li
    *       └─ element: h2
    *          └─ text: "出力"
    *
    * */
  return (tree: Root) => {
    const headings = tree.children.filter(
      (node): node is Element =>
        node.type === 'element' && /^h[1-6]$/.test(node.tagName)
    )

    const list: Element = {
      type: 'element',
      tagName: 'ul',
      properties: {},
      children: [],
    }
    const ancestors = [{ depth: 0, item: list }]

    for (const heading of headings) {
      const depth = Number(heading.tagName[1])

      // 同じ階層と下の階層を外し、親となる見出しまで戻る。
      while (ancestors[ancestors.length - 1].depth >= depth) {
        ancestors.pop()
      }

      const parent = ancestors[ancestors.length - 1].item
      const parentList = getChildList(parent)
      const item: Element = {
        type: 'element',
        tagName: 'li',
        properties: {},
        children: [heading],
      }

      parentList.children.push(item)
      ancestors.push({ depth, item })
    }

    tree.children = headings.length > 0 ? [list] : []
  }
}

function getChildList(parent: Element): Element {
  if (parent.tagName === 'ul') return parent

  const lastChild = parent.children.at(-1)
  if (lastChild?.type === 'element' && lastChild.tagName === 'ul') {
    return lastChild
  }

  const list: Element = {
    type: 'element',
    tagName: 'ul',
    properties: {},
    children: [],
  }
  parent.children.push(list)
  return list
}

export function ProblemDetailPage() {
  const { projectId = '' } = useParams()
  const projectsQuery = $api.useQuery('get', '/api/projects', {}, { retry: false })
  const detailQuery = $api.useQuery('get', '/api/projects/{project_id}', {
    params: { path: { project_id: projectId } },
  }, { retry: false })

  if (projectsQuery.isPending || detailQuery.isPending) return <main className="p-8" role="status">読み込み中…</main>
  if (projectsQuery.isError || detailQuery.isError) return <main className="space-y-4 p-8">
    <p role="alert" className="text-destructive">{detailQuery.error?.code === 404 ? '課題が見つからないか、公開されていません。' : '課題を取得できませんでした。'}</p>
    <Link to="/projects" className="block text-link underline">Problem Listへ戻る</Link>
  </main>

  const projects = projectsQuery.data.projects
  const project = detailQuery.data
  return <ProblemDetailContent projects={projects} project={project} />
}

function ProblemDetailContent({ projects, project }: {
  projects: components['schemas']['Project'][]
  project: components['schemas']['ProjectDetail']
}) {
  const { workflowId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const pageRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const workflow = workflowId
    ? project.workflows.find((item) => item.id === workflowId)
    : project.workflows[0]
  // The page supplies the title; omit the same leading Markdown title.
  const description = workflow?.description_markdown || ''
  //  .replace(/^# ([^\n]+)\r?\n?/, (title, name: string) => name.trim() === workflow.name ? '' : title) ?? ''

  useEffect(() => {
    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1))
      target?.scrollIntoView()
      target?.focus({ preventScroll: true })
    } else {
      pageRef.current?.scrollIntoView({ block: 'start' })
      if (contentRef.current) contentRef.current.scrollTop = 0
    }
  }, [location.pathname, location.hash, description])

  return <main ref={pageRef} className="mx-auto grid w-full max-w-screen-2xl flex-1 md:min-h-0 md:grid-cols-[18rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[20rem_minmax(0,1fr)]">
    <aside tabIndex={0} aria-label="課題ナビゲーションと提出" className="min-w-0 border-b bg-muted/30 p-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:overflow-y-auto md:border-r md:border-b-0 md:p-6">
      <div className="mb-4 space-y-2 break-words">
        <select aria-label="課題を選択" value={project.id} onChange={event => void navigate(`/projects/${event.target.value}`)}
          className="h-12 w-full min-w-0 rounded-md border bg-card px-3 text-xl font-bold focus-visible:ring-2 focus-visible:ring-ring">
          {!projects.some(item => item.id === project.id) && <option value={project.id}>{project.name}</option>}
          {projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {project.description && <p className="text-sm text-muted-foreground">{project.description}</p>}
      </div>
      <nav aria-label="課題の目次" className="space-y-2">
        <Accordion.Root key={workflow?.id} type="single" collapsible defaultValue={workflow?.id}>
          {project.workflows.map((item) =>
            <Accordion.Item key={item.id} value={item.id}>
              <Accordion.Header>
                <Accordion.Trigger asChild>
                  <Link to={`/projects/${project.id}/${item.id}`} aria-current={item.id === workflow?.id ? 'page' : undefined} className="group flex items-center gap-3 rounded-md px-3 py-3 font-semibold hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-link/10 aria-[current=page]:text-link">
                    <ChevronRight className="size-5 shrink-0 group-data-[state=open]:rotate-90" aria-hidden="true" />
                    <span className="min-w-0 break-words">
                      {item.name}
                    </span>
                  </Link>
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                {item.id === workflow?.id &&
                  <div className="my-2 ml-3 text-sm break-words">
                    <Markdown
                      skipHtml
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeOutline]}
                      allowedElements={['ul', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'code', 'em', 'strong', 'del', 'a']}
                      components={{
                        ul: ({ children }) => <ul className="ml-3 border-l pl-3">{children}</ul>,
                        h1: outlineHeading,
                        h2: outlineHeading,
                        h3: outlineHeading,
                        h4: outlineHeading,
                        h5: outlineHeading,
                        h6: outlineHeading,
                        a: ({ children }) => <>{children}</>,
                        // code: ({ children }) => <>{children}</>
                      }}>
                      {description}
                    </Markdown>
                  </div>}
              </Accordion.Content>
            </Accordion.Item>)}
        </Accordion.Root>
      </nav>
      <ValidationSubmitForm key={project.id} projectId={project.id} requiredFiles={project.required_files} />
    </aside>
    <div ref={contentRef} role="region" aria-label="課題本文" tabIndex={0} className="min-w-0 space-y-5 bg-card p-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:p-8 md:overflow-y-auto">
      {workflow ?
        <article key={workflow.id} lang="ja" className="markdown-content min-w-0">
          <h1 className="!mb-6 !text-4xl sm:!text-5xl">{workflow.name}</h1>
          {description.trim() ?
            <MarkdownContent
              components={{
                h1: heading,
                h2: heading,
                h3: heading,
                h4: heading,
                h5: heading,
                h6: heading,
                img: () => null
              }}>
              {description}
            </MarkdownContent> :
            <p className="text-muted-foreground">
              課題説明はまだ登録されていません。
            </p>}
        </article> :
        <p role="alert">
          {workflowId ? '指定された問題が見つかりません。左の目次から選択してください。' : '問題はまだ登録されていません。'}
        </p>}
    </div>
  </main>
}
