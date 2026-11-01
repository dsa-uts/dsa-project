import type { components } from "@/api/schema";
import { Tooltip } from "@/components/ui/tooltip";

type Status = components["schemas"]["Status"];
const statusClass: Record<Status, string> = {
  AC: "bg-status-ac",
  WA: "bg-status-wa",
  TLE: "bg-status-tle",
  MLE: "bg-status-mle",
  RE: "bg-status-re",
  OLE: "bg-status-ole",
  IE: "bg-status-ie",
  CE: "bg-destructive",
  SKIP: "bg-muted text-muted-foreground",
};

const statusLabel: Record<Status, string> = {
  AC: "Accepted",
  WA: "Wrong Answer",
  TLE: "Time Limit Exceeded",
  MLE: "Memory Limit Exceeded",
  RE: "Runtime Error",
  OLE: "Output Limit Exceeded",
  IE: "Internal Error",
  CE: "Compilation Error",
  SKIP: "Skipped",
};

export function StatusBadge({ status }: { status: Status | null }) {
  return status ? (
    <Tooltip content={statusLabel[status]}>
      <span
        tabIndex={0}
        className={`inline-block min-w-12 rounded-md px-2 py-1 text-center text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${statusClass[status]}`}
      >
        {status}
      </span>
    </Tooltip>
  ) : (
    <span className="text-muted-foreground">未記録</span>
  );
}
