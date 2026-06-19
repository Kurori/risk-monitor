import axios from "axios";

export const api = axios.create({ baseURL: "/api" });

export interface Package {
  package_name: string;
  ecosystem: string;
  stars: number;
  archived: boolean;
  commit_trend_score: number;
  cve_score: number;
  composite_score: number;
  risk_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
  cve_count: number;
  weekly_commits: number[];
  cves: Cve[];
  computed_at: string;
}

export interface Cve {
  vuln_id: string;
  cve_id: string | null;
  url: string;
  severity: string;
  cvss_score: number;
  summary: string;
  published: string;
}

export interface Stats {
  total_packages: number;
  critical: number;
  high: number;
  total_cves: number;
}

export interface PipelineStatus {
  ingestion: string;
  processing: string;
  pipeline: string;
}

export const fetchPackages = () => api.get<Package[]>("/packages").then((r) => r.data);
export const fetchPackage = (name: string) =>
  api.get<Package>(`/packages/${name}`).then((r) => r.data);
export const fetchStats = () => api.get<Stats>("/stats").then((r) => r.data);
export const fetchPipelineStatus = () =>
  api.get<PipelineStatus>("/pipeline/status").then((r) => r.data);
export const triggerPipeline = () => api.post("/pipeline/run");
export const triggerIngest = () => api.post("/pipeline/ingest");
export const triggerProcess = () => api.post("/pipeline/process");
