"use client";

import { useEffect, useState } from "react";

interface HealthData {
  base_url: string;
  reachable: boolean;
  ok?: boolean;
  version?: string;
  uptime_seconds?: number;
  error?: string;
}

export default function RendererSettingsPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/renderer/health")
      .then((r) => r.json())
      .then((data: HealthData) => { if (!cancelled) setHealth(data); })
      .catch(() => { if (!cancelled) setHealth({ base_url: "", reachable: false, error: "Request failed" }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Renderer Settings / Health</h2>
          <span className="page-header-sub">CAF Renderer connectivity and status</span>
        </div>
      </div>

      <div style={{ padding: "20px 28px 28px", maxWidth: 600 }}>
        {loading && <p style={{ color: "var(--muted)" }}>Loading…</p>}
        {!loading && health && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card">
              <div className="card-header">RENDERER_BASE_URL</div>
              <p className="font-mono" style={{ fontSize: 13, wordBreak: "break-all" }}>{health.base_url || "(not set)"}</p>
            </div>
            <div className="card">
              <div className="card-header">Status</div>
              <p>
                {health.reachable
                  ? <span style={{ color: "var(--green)", fontWeight: 600 }}>Reachable</span>
                  : <span style={{ color: "var(--red)", fontWeight: 600 }}>Not reachable</span>
                }
              </p>
              {health.version != null && <p style={{ marginTop: 8, fontSize: 13, color: "var(--fg-secondary)" }}>Version: {health.version}</p>}
              {health.uptime_seconds != null && <p style={{ fontSize: 13, color: "var(--fg-secondary)" }}>Uptime: {health.uptime_seconds}s</p>}
              {health.error && <p style={{ marginTop: 8, fontSize: 13, color: "var(--red)" }}>{health.error}</p>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
