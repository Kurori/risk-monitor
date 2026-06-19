import { X, Star, GitFork, Bug, TrendingDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchPackage, type Cve } from "../api/client";
import { RiskBadge, ScoreBar } from "./RiskBadge";
import { CommitChart } from "./CommitChart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH: "#f97316",
  MEDIUM: "#eab308",
  LOW: "#10b981",
  UNKNOWN: "#6b7280",
};

interface Props {
  packageName: string;
  onClose: () => void;
}

export function PackageDetail({ packageName, onClose }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["package", packageName],
    queryFn: () => fetchPackage(packageName),
  });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-gray-900 border border-gray-700 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        {isLoading && <div className="p-10 text-center text-gray-400">Loading…</div>}
        {isError && <div className="p-10 text-center text-red-400">Failed to load package details.</div>}

        {data && (
          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-2xl font-bold text-white">{data.package_name}</h2>
                  <span className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
                    {data.ecosystem}
                  </span>
                  <RiskBadge level={data.risk_level} />
                  {data.archived && (
                    <span className="rounded bg-red-950 border border-red-800 px-2 py-0.5 text-xs text-red-400">
                      ARCHIVED
                    </span>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-4 text-sm text-gray-400">
                  <span className="flex items-center gap-1">
                    <Star className="h-3.5 w-3.5" /> {data.stars.toLocaleString()}
                  </span>
                  <span className="flex items-center gap-1">
                    <Bug className="h-3.5 w-3.5" /> {data.cve_count} CVEs
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-white">
                  {data.composite_score.toFixed(0)}
                </div>
                <div className="text-xs text-gray-400">Risk Score</div>
              </div>
            </div>

            {/* Score breakdown */}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-gray-800 p-4">
                <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
                  <TrendingDown className="h-4 w-4" /> Commit Trend
                </div>
                <ScoreBar score={data.commit_trend_score} />
              </div>
              <div className="rounded-lg bg-gray-800 p-4">
                <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
                  <Bug className="h-4 w-4" /> CVE Risk
                </div>
                <ScoreBar score={data.cve_score} />
              </div>
            </div>

            {/* Commit history chart */}
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-3">
                Weekly Commits (last 52 weeks)
              </h3>
              <div className="rounded-lg bg-gray-800 p-4">
                <CommitChart weeklyCommits={data.weekly_commits} />
              </div>
            </div>

            {/* CVE severity chart + list */}
            {data.cves && data.cves.length > 0 && (
              <>
                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-3">
                    CVE Severity Breakdown
                  </h3>
                  <SeverityChart cves={data.cves} />
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-3">
                    Known Vulnerabilities ({data.cves.length})
                  </h3>
                  <CveTable cves={data.cves} />
                </div>
              </>
            )}

            <div className="text-xs text-gray-600 text-right">
              Computed: {new Date(data.computed_at).toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SeverityChart({ cves }: { cves: Cve[] }) {
  const counts: Record<string, number> = {};
  for (const cve of cves) {
    counts[cve.severity] = (counts[cve.severity] ?? 0) + 1;
  }
  const data = Object.entries(counts).map(([severity, count]) => ({ severity, count }));

  return (
    <div className="rounded-lg bg-gray-800 p-4">
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <XAxis dataKey="severity" tick={{ fill: "#9ca3af", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#9ca3af", fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 6 }}
            labelStyle={{ color: "#9ca3af" }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {data.map((entry) => (
              <Cell
                key={entry.severity}
                fill={SEVERITY_COLOR[entry.severity] ?? "#6b7280"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CveTable({ cves }: { cves: Cve[] }) {
  const sorted = [...cves].sort((a, b) => (b.cvss_score ?? 0) - (a.cvss_score ?? 0));
  return (
    <div className="rounded-lg overflow-hidden border border-gray-700">
      <table className="w-full text-xs">
        <thead className="bg-gray-800 text-gray-400">
          <tr>
            <th className="px-3 py-2 text-left">ID</th>
            <th className="px-3 py-2 text-left">Severity</th>
            <th className="px-3 py-2 text-left">CVSS</th>
            <th className="px-3 py-2 text-left">Summary</th>
            <th className="px-3 py-2 text-left">Published</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((cve) => (
            <tr key={cve.vuln_id} className="border-t border-gray-800 hover:bg-gray-800/50">
              <td className="px-3 py-2 font-mono whitespace-nowrap">
                <a
                  href={
                    cve.url ||
                    (cve.cve_id
                      ? `https://nvd.nist.gov/vuln/detail/${cve.cve_id}`
                      : `https://osv.dev/vulnerability/${cve.vuln_id}`)
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 hover:underline"
                >
                  {cve.cve_id ?? cve.vuln_id}
                </a>
              </td>
              <td className="px-3 py-2">
                <span
                  className="rounded px-1.5 py-0.5 text-xs font-semibold"
                  style={{
                    background: `${SEVERITY_COLOR[cve.severity] ?? "#6b7280"}22`,
                    color: SEVERITY_COLOR[cve.severity] ?? "#9ca3af",
                  }}
                >
                  {cve.severity}
                </span>
              </td>
              <td className="px-3 py-2 tabular-nums text-gray-300">
                {cve.cvss_score > 0 ? cve.cvss_score.toFixed(1) : "—"}
              </td>
              <td className="px-3 py-2 text-gray-400 max-w-xs truncate">{cve.summary || "—"}</td>
              <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                {cve.published ? new Date(cve.published).toLocaleDateString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
