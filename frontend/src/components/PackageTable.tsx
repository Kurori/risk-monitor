import { useState } from "react";
import { ArrowUpDown, ChevronUp, ChevronDown, Flame, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { clsx } from "clsx";
import { type Package } from "../api/client";
import { RiskBadge, ScoreBar } from "./RiskBadge";
import { PackageDetail } from "./PackageDetail";

// ---------------------------------------------------------------------------
// Activity level — derived from the last 4 weeks vs the prior 12 weeks
// ---------------------------------------------------------------------------

type Activity = "hot" | "warm" | "cool" | "cold" | "unknown";

function computeActivity(weeklyCommits: number[]): { level: Activity; recentAvg: number } {
  if (!weeklyCommits || weeklyCommits.length < 4) return { level: "unknown", recentAvg: 0 };

  const recent = weeklyCommits.slice(-4);
  const base = weeklyCommits.slice(-16, -4);

  const recentAvg = recent.reduce((s, n) => s + n, 0) / recent.length;
  const baseAvg = base.length ? base.reduce((s, n) => s + n, 0) / base.length : 0;
  const ratio = recentAvg / (baseAvg + 1); // +1 avoids div-by-zero

  let level: Activity;
  if (recentAvg >= 30 && ratio >= 0.8) level = "hot";
  else if (recentAvg >= 8) level = "warm";
  else if (recentAvg >= 2) level = "cool";
  else level = "cold";

  return { level, recentAvg };
}

const ACTIVITY_CONFIG: Record<Activity, {
  icon: React.ElementType;
  label: string;
  classes: string;
}> = {
  hot:     { icon: Flame,         label: "Hot",     classes: "text-orange-400 bg-orange-950 border-orange-800" },
  warm:    { icon: TrendingUp,    label: "Active",  classes: "text-yellow-400 bg-yellow-950 border-yellow-800" },
  cool:    { icon: TrendingDown,  label: "Quiet",   classes: "text-sky-400 bg-sky-950 border-sky-800" },
  cold:    { icon: Minus,         label: "Cold",    classes: "text-blue-400 bg-blue-950 border-blue-800" },
  unknown: { icon: Minus,         label: "—",       classes: "text-gray-600 bg-gray-900 border-gray-800" },
};

function ActivityBadge({ weeklyCommits }: { weeklyCommits: number[] }) {
  const { level, recentAvg } = computeActivity(weeklyCommits);
  const { icon: Icon, label, classes } = ACTIVITY_CONFIG[level];
  return (
    <div className="flex items-center gap-2">
      <span className={clsx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", classes)}>
        <Icon className="h-3 w-3" />
        {label}
      </span>
      {level !== "unknown" && (
        <span className="tabular-nums text-xs text-gray-500">
          {recentAvg.toFixed(0)}/wk
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

type SortKey = "composite_score" | "cve_count" | "stars" | "package_name" | "activity";

function activitySortValue(pkg: Package): number {
  return computeActivity(pkg.weekly_commits).recentAvg;
}

export function PackageTable({ packages }: { packages: Package[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("composite_score");
  const [sortAsc, setSortAsc] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const sorted = [...packages].sort((a, b) => {
    let av: string | number;
    let bv: string | number;
    if (sortKey === "activity") {
      av = activitySortValue(a);
      bv = activitySortValue(b);
    } else {
      av = a[sortKey] ?? 0;
      bv = b[sortKey] ?? 0;
    }
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortAsc ? cmp : -cmp;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k ? (
      sortAsc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
    ) : (
      <ArrowUpDown className="h-3 w-3 opacity-30" />
    );

  return (
    <>
      <div className="rounded-xl overflow-hidden border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-800/80 text-gray-400 text-xs uppercase tracking-wider">
            <tr>
              <th
                className="px-4 py-3 text-left cursor-pointer hover:text-white select-none"
                onClick={() => toggleSort("package_name")}
              >
                <span className="flex items-center gap-1">Package <SortIcon k="package_name" /></span>
              </th>
              <th
                className="px-4 py-3 text-left cursor-pointer hover:text-white select-none"
                onClick={() => toggleSort("composite_score")}
              >
                <span className="flex items-center gap-1">Risk Score <SortIcon k="composite_score" /></span>
              </th>
              <th className="px-4 py-3 text-left">Risk Level</th>
              <th
                className="px-4 py-3 text-left cursor-pointer hover:text-white select-none"
                onClick={() => toggleSort("activity")}
              >
                <span className="flex items-center gap-1">Activity <SortIcon k="activity" /></span>
              </th>
              <th
                className="px-4 py-3 text-left cursor-pointer hover:text-white select-none"
                onClick={() => toggleSort("cve_count")}
              >
                <span className="flex items-center gap-1">CVEs <SortIcon k="cve_count" /></span>
              </th>
              <th
                className="px-4 py-3 text-left cursor-pointer hover:text-white select-none"
                onClick={() => toggleSort("stars")}
              >
                <span className="flex items-center gap-1">Stars <SortIcon k="stars" /></span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((pkg) => (
              <tr
                key={pkg.package_name}
                className="border-t border-gray-800 hover:bg-gray-800/40 cursor-pointer transition-colors"
                onClick={() => setSelected(pkg.package_name)}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{pkg.package_name}</span>
                    {pkg.archived && (
                      <span className="rounded bg-gray-700 px-1.5 text-[10px] text-gray-400">archived</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <ScoreBar score={pkg.composite_score} />
                </td>
                <td className="px-4 py-3">
                  <RiskBadge level={pkg.risk_level} />
                </td>
                <td className="px-4 py-3">
                  <ActivityBadge weeklyCommits={pkg.weekly_commits} />
                </td>
                <td className="px-4 py-3 tabular-nums text-gray-300">{pkg.cve_count}</td>
                <td className="px-4 py-3 tabular-nums text-gray-400">
                  {pkg.stars.toLocaleString()}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                  No data yet — run the ingestion pipeline first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <PackageDetail packageName={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
