import { useEffect, useRef, useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import { clsx } from "clsx";

interface Alert {
  id: number;
  package_name: string;
  vuln_id: string;
  severity: string;
  summary?: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "border-red-500 bg-red-950",
  HIGH: "border-orange-500 bg-orange-950",
  MEDIUM: "border-yellow-500 bg-yellow-950",
  LOW: "border-emerald-500 bg-emerald-950",
};

export function AlertToastContainer() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${window.location.host}/ws/alerts`;
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(url);
      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.type === "new_vulnerability") {
            const alert: Alert = {
              id: ++idRef.current,
              package_name: data.package_name,
              vuln_id: data.vuln_id,
              severity: data.severity ?? "UNKNOWN",
              summary: data.summary,
            };
            setAlerts((prev) => [alert, ...prev].slice(0, 5));
            setTimeout(() => dismiss(alert.id), 8000);
          }
        } catch {}
      };
      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 5000);
      };
    };

    connect();
    return () => {
      ws?.close();
      clearTimeout(reconnectTimer);
    };
  }, []);

  const dismiss = (id: number) =>
    setAlerts((prev) => prev.filter((a) => a.id !== id));

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={clsx(
            "flex items-start gap-3 rounded-lg border p-3 text-sm shadow-xl",
            SEVERITY_COLOR[alert.severity] ?? "border-gray-600 bg-gray-800"
          )}
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-white">
              New {alert.severity} vuln — {alert.package_name}
            </div>
            <div className="text-xs text-gray-300 truncate">{alert.vuln_id}</div>
            {alert.summary && (
              <div className="mt-0.5 text-xs text-gray-400 line-clamp-2">{alert.summary}</div>
            )}
          </div>
          <button onClick={() => dismiss(alert.id)} className="text-gray-500 hover:text-gray-200">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
