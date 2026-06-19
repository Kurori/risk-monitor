import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Props {
  weeklyCommits: number[];
}

export function CommitChart({ weeklyCommits }: Props) {
  const data = weeklyCommits.map((count, i) => ({
    week: `W${i + 1}`,
    commits: count,
  }));

  if (data.length === 0) {
    return <div className="flex h-40 items-center justify-center text-gray-500 text-sm">No commit data</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="commitGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="week"
          tick={{ fill: "#6b7280", fontSize: 10 }}
          interval={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 6 }}
          labelStyle={{ color: "#9ca3af" }}
          itemStyle={{ color: "#93c5fd" }}
        />
        <Area
          type="monotone"
          dataKey="commits"
          stroke="#3b82f6"
          strokeWidth={2}
          fill="url(#commitGrad)"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
