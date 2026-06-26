import Link from "next/link";
import { notFound } from "next/navigation";
import { isAgentInspectionEnabled } from "@/lib/agent-inspection/config";
import { MAIN_ROUTE_DESCRIPTIONS } from "@/lib/agent-inspection/route-map";
import { fetchBrandsForInspection } from "@/lib/agent-inspection/snapshot";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "CAF Review Agent Map",
  robots: { index: false, follow: false },
};

export default async function AgentMapPage() {
  if (!isAgentInspectionEnabled()) {
    notFound();
  }

  const { brands, data_source, error } = await fetchBrandsForInspection();
  const generatedAt = new Date().toISOString();

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 720,
        margin: "0 auto",
        padding: "2rem 1.5rem",
        lineHeight: 1.5,
        color: "#111",
      }}
      data-agent-id="agent-map-page"
    >
      <h1>CAF Review Agent Map</h1>
      <p>
        <strong>Inspection page for AI agents.</strong> Not part of the marketer product UI. Use this page to
        discover routes, labels, and links without relying on client-rendered navigation.
      </p>

      <p>
        Inspection mode: <strong>{isAgentInspectionEnabled() ? "enabled" : "disabled"}</strong>
        <br />
        Data source: <strong>{data_source}</strong>
        <br />
        Generated: <code>{generatedAt}</code>
      </p>

      {error && (
        <p style={{ color: "#b45309" }}>
          Brand list warning: {error}. Links below may use static examples only.
        </p>
      )}

      <h2>API endpoints (when inspection is enabled)</h2>
      <ul>
        <li>
          <a href="/api/agent/snapshot">/api/agent/snapshot</a> — full app structure JSON
        </li>
        <li>
          <a href="/api/agent/page?path=/brand/SNS">/api/agent/page?path=…</a> — per-page summary
        </li>
        <li>
          <a href="/api/agent/copy-inventory">/api/agent/copy-inventory</a> — visible label inventory
        </li>
        <li>
          <a href="/api/agent/technical-terms">/api/agent/technical-terms</a> — technical term leakage audit
        </li>
      </ul>

      <h2>Current known brands</h2>
      {brands.length === 0 ? (
        <p>No brands loaded. Set <code>AGENT_INSPECTION_ENABLED=true</code> and ensure Core is reachable.</p>
      ) : (
        <ul>
          {brands.map((b) => {
            const base = `/brand/${encodeURIComponent(b.slug)}`;
            return (
              <li key={b.slug} style={{ marginBottom: "1rem" }}>
                <strong>{b.displayName}</strong> — slug: <code>{b.slug}</code>
                <ul>
                  <li>
                    <Link href={base}>Dashboard</Link>
                  </li>
                  <li>
                    <Link href={`${base}/profile`}>Brand profile</Link>
                  </li>
                  <li>
                    <Link href={`${base}/research`}>Research</Link>
                  </li>
                  <li>
                    <Link href={`${base}/intelligence`}>Market intelligence</Link>
                  </li>
                  <li>
                    <Link href={`${base}/ideas`}>Ideas</Link>
                  </li>
                  <li>
                    <Link href={`${base}/content`}>Content</Link>
                  </li>
                  <li>
                    <Link href={`${base}/publishing`}>Publishing</Link>
                  </li>
                  <li>
                    <Link href={`${base}/performance`}>Performance &amp; learning</Link>
                  </li>
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      <h2>Main route descriptions</h2>
      <ul>
        {MAIN_ROUTE_DESCRIPTIONS.map((r) => (
          <li key={r.path}>
            <strong>{r.path}</strong> — {r.description}
          </li>
        ))}
      </ul>

      <p style={{ marginTop: "2rem", fontSize: "0.875rem", color: "#666" }}>
        Return to <Link href="/workspace">workspace</Link>.
      </p>
    </div>
  );
}
