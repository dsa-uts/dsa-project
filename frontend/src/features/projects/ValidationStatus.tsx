import type { components } from '@/api/schema'

type Status = components['schemas']['Status']
const statusClass: Record<Status, string> = {
  AC: 'bg-status-ac', WA: 'bg-status-wa', TLE: 'bg-status-tle', MLE: 'bg-status-mle',
  RE: 'bg-status-re', OLE: 'bg-status-ole', IE: 'bg-status-ie', CE: 'bg-destructive', SKIP: 'bg-muted text-muted-foreground',
}

export function StatusBadge({ status }: { status: Status | null }) {
  return status ? <span className={`inline-block min-w-12 rounded-md px-2 py-1 text-center text-sm font-semibold text-primary-foreground ${statusClass[status]}`}>{status}</span> : <span className="text-muted-foreground">未記録</span>
}
