import { useState } from 'react'
import { Tabs, Tooltip } from 'radix-ui'
import { Link } from 'react-router-dom'
import { SubmissionSummary } from './SubmissionSummary'
import { $api } from '@/api/client'
import { Button } from '@/components/ui/button'

export function ProblemListPage() {
  const [selected, setSelected] = useState('all')
  const projects = $api.useQuery('get', '/api/projects', {}, {
    retry: false,
    // Request詳細APIの実装までは、一覧のサマリーを再取得する。
    refetchInterval: (query) => !query.state.error && query.state.data?.projects.some((project) => project.my_result && project.my_result.request.state !== 'completed') ? 5000 : false,
  })
  const rows = projects.data?.projects ?? []
  const active = rows.some((project) => project.id === selected) ? selected : 'all'
  return <main className="mx-auto w-full max-w-screen-2xl flex-1 space-y-8 px-4 py-8 sm:px-12 sm:py-10">
    <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Problem List</h1>
    {projects.isPending && <p role="status" className="text-muted-foreground">読み込み中…</p>}
    {projects.isError && <div role="alert" className="flex flex-wrap items-center gap-4"><p className="text-destructive">課題一覧を取得できませんでした。</p><Button variant="outline" onClick={() => void projects.refetch()}>再読み込み</Button></div>}
    {projects.data && <Tabs.Root value={active} onValueChange={setSelected}>
      <Tabs.List aria-label="課題の絞り込み" className="flex overflow-x-auto border-b">
        {[{ id: 'all', name: 'All' }, ...rows].map((project) => <Tabs.Trigger key={project.id} value={project.id} className="shrink-0 border-b-2 border-transparent px-8 py-4 font-semibold outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=active]:border-link data-[state=active]:text-link">{project.name}</Tabs.Trigger>)}
      </Tabs.List>
      <Tabs.Content value={active} className="space-y-12 pt-10 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {rows.length === 0 && <p className="text-muted-foreground">表示できる課題はありません。</p>}
        <Tooltip.Provider>{rows.filter((project) => active === 'all' || project.id === active).map((project) => <section key={project.id} aria-labelledby={`project-${project.id}`} className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2"><h2 id={`project-${project.id}`} className="text-3xl font-bold">{project.name}</h2><SubmissionSummary project={project} /></div>
          {project.workflows.length > 0 ? <ul className="divide-y rounded-md border bg-card">{project.workflows.map((workflow) => <li key={workflow.id}><Link to={`/projects/${project.id}/${workflow.id}`} className="block px-6 py-5 font-semibold hover:bg-accent hover:text-link focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">{workflow.name}</Link></li>)}</ul> : <p className="text-muted-foreground">問題はまだ登録されていません。</p>}
        </section>)}</Tooltip.Provider>
      </Tabs.Content>
    </Tabs.Root>}
  </main>
}
