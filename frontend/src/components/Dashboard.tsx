import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, AlertTriangle, Bug, RefreshCw, Play } from "lucide-react";
import {
  fetchPackages,
  fetchStats,
  fetchPipelineStatus,
  triggerPipeline,
} from "../api/client";
import { PackageTable } from "./PackageTable";
import { clsx } from "clsx";

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-5 flex items-center gap-4">
      <div className={clsx("rounded-lg p-2.5", color)}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div>
        <div className="text-2xl font-bold text-white tabular-nums">{value}</div>
        <div className="text-xs text-gray-400">{label}</div>
      </div>
    </div>
  );
}

function PipelineButton({ status, onRun }: { status: string; onRun: () => void }) {
  const running = status === "running";
  return (
    <button
      onClick={onRun}
      disabled={running}
      className={clsx(
        "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
        running
          ? "bg-gray-700 text-gray-400 cursor-not-allowed"
          : "bg-blue-600 hover:bg-blue-500 text-white"
      )}
    >
      <Play className={clsx("h-4 w-4", running && "animate-spin")} />
      {running ? "Running…" : "Run Pipeline"}
    </button>
  );
}

function StepBadge({ label, status }: { label: string; status: string }) {
  const color =
    status === "running" ? "text-blue-400" :
    status === "done"    ? "text-emerald-400" :
    status.startsWith("error") ? "text-red-400" :
    "text-gray-500";
  return (
    <span className="flex items-center gap-1 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={clsx("font-medium", color)}>{status}</span>
    </span>
  );
}

export function Dashboard() {
  const qc = useQueryClient();

  const { data: packages = [], isLoading: pkgLoading } = useQuery({
    queryKey: ["packages"],
    queryFn: fetchPackages,
    refetchInterval: 15_000,
  });

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: fetchStats,
    refetchInterval: 15_000,
  });

  const { data: pipelineStatus } = useQuery({
    queryKey: ["pipeline-status"],
    queryFn: fetchPipelineStatus,
    refetchInterval: 3_000,
  });

  const pipelineMutation = useMutation({
    mutationFn: triggerPipeline,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipeline-status"] }),
  });

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Shield className="h-7 w-7 text-blue-400" />
            <div>
              <h1 className="text-xl font-bold text-white">Tech Stack Risk Monitor</h1>
              <p className="text-xs text-gray-500">
                OSS dependency health · GitHub activity · CVE scoring
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {(pipelineStatus?.ingestion !== "idle" || pipelineStatus?.processing !== "idle") && (
              <div className="flex items-center gap-3 rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5">
                <StepBadge label="1 · Ingest" status={pipelineStatus?.ingestion ?? "idle"} />
                <span className="text-gray-700">→</span>
                <StepBadge label="2 · Spark" status={pipelineStatus?.processing ?? "idle"} />
              </div>
            )}
            <PipelineButton
              status={pipelineStatus?.pipeline ?? "idle"}
              onRun={() => pipelineMutation.mutate()}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={Shield}
            label="Packages monitored"
            value={stats?.total_packages ?? "—"}
            color="bg-blue-600"
          />
          <StatCard
            icon={AlertTriangle}
            label="Critical risk"
            value={stats?.critical ?? "—"}
            color="bg-red-600"
          />
          <StatCard
            icon={AlertTriangle}
            label="High risk"
            value={stats?.high ?? "—"}
            color="bg-orange-600"
          />
          <StatCard
            icon={Bug}
            label="Total CVEs tracked"
            value={stats?.total_cves ?? "—"}
            color="bg-purple-600"
          />
        </div>

        {/* Table */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-300">
              Packages — sorted by risk score
            </h2>
            <button
              onClick={() => qc.invalidateQueries()}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
          </div>
          {pkgLoading ? (
            <div className="rounded-xl border border-gray-800 p-16 text-center text-gray-500">
              Loading…
            </div>
          ) : (
            <PackageTable packages={packages} />
          )}
        </div>
      </div>
    </div>
  );
}
