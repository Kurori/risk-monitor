import { clsx } from "clsx";

const COLORS: Record<string, string> = {
  LOW: "bg-emerald-900 text-emerald-300 border border-emerald-700",
  MEDIUM: "bg-yellow-900 text-yellow-300 border border-yellow-700",
  HIGH: "bg-orange-900 text-orange-300 border border-orange-700",
  CRITICAL: "bg-red-900 text-red-300 border border-red-700",
  UNKNOWN: "bg-gray-800 text-gray-400 border border-gray-600",
};

export function RiskBadge({ level }: { level: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide",
        COLORS[level] ?? COLORS.UNKNOWN
      )}
    >
      {level}
    </span>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color =
    pct >= 75 ? "bg-red-500" : pct >= 50 ? "bg-orange-500" : pct >= 25 ? "bg-yellow-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-gray-700">
        <div className={clsx("h-1.5 rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-xs text-gray-400">{pct.toFixed(0)}</span>
    </div>
  );
}
