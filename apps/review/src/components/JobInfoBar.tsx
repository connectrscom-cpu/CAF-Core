"use client";

import { useCallback, useState, type ReactNode } from "react";

/**
 * Compact job-info strip for the review console. Collapses the previously stacked
 * "Task Info" / lineage / validation / mimic-package cards into one card of chips:
 * every field has a one-click copy button, and heavier payloads (lineage JSON,
 * validation JSON, mimic package) are one-click expandable sections.
 *
 * Note: UI labels say "Job" but the underlying execution key remains `task_id`.
 */

interface JobInfoField {
  label: string;
  value: string;
  mono?: boolean;
}

export interface JobInfoBarProps {
  jobId: string;
  projectSlug?: string;
  platform?: string;
  flowType?: string;
  route?: string;
  runId?: string;
  risk?: string;
  qc?: string;
  textReprint?: string | null;
  storedOverrides?: string;
  lastIssueTags?: string;
  lineage: Record<string, unknown> | null;
  /** Validation JSON inspector (existing component). */
  validationNode?: ReactNode;
  /** Advanced mimic package inspector (existing component). */
  mimicInspectNode?: ReactNode;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyChip({ field }: { field: JobInfoField }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    const ok = await copyText(field.value);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  }, [field.value]);

  return (
    <button
      type="button"
      className="job-info-chip"
      onClick={onCopy}
      title={`Copy ${field.label}: ${field.value}`}
    >
      <span className="job-info-chip__label">{field.label}</span>
      <span className={`job-info-chip__value${field.mono ? " font-mono" : ""}`}>{field.value || "—"}</span>
      <span className="job-info-chip__copy">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function Section({
  id,
  label,
  open,
  onToggle,
  copyValue,
  children,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: (id: string) => void;
  copyValue?: string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    if (!copyValue) return;
    const ok = await copyText(copyValue);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  }, [copyValue]);

  return (
    <div className="job-info-section">
      <div className="job-info-section__head">
        <button
          type="button"
          className={`job-info-section__toggle${open ? " job-info-section__toggle--open" : ""}`}
          onClick={() => onToggle(id)}
          aria-expanded={open}
        >
          <span aria-hidden>{open ? "▾" : "▸"}</span> {label}
        </button>
        {copyValue ? (
          <button type="button" className="job-info-chip__copy job-info-section__copy" onClick={onCopy}>
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
      {open ? <div className="job-info-section__body">{children}</div> : null}
    </div>
  );
}

export function JobInfoBar({
  jobId,
  projectSlug,
  platform,
  flowType,
  route,
  runId,
  risk,
  qc,
  textReprint,
  storedOverrides,
  lastIssueTags,
  lineage,
  validationNode,
  mimicInspectNode,
}: JobInfoBarProps) {
  const [openSection, setOpenSection] = useState<string | null>(null);
  const toggle = useCallback((id: string) => setOpenSection((cur) => (cur === id ? null : id)), []);

  const fields: JobInfoField[] = [
    { label: "Job ID", value: jobId, mono: true },
    ...(projectSlug ? [{ label: "Project", value: projectSlug }] : []),
    { label: "Platform", value: platform || "—" },
    { label: "Flow", value: flowType || "—" },
    { label: "Route", value: route || "—" },
    ...(runId ? [{ label: "Run", value: runId, mono: true }] : []),
    { label: "Risk", value: risk || "—" },
    { label: "QC", value: qc || "—" },
    ...(textReprint ? [{ label: "Text reprint", value: textReprint }] : []),
    ...(storedOverrides ? [{ label: "Stored overrides", value: storedOverrides }] : []),
    ...(lastIssueTags ? [{ label: "Last issue tags", value: lastIssueTags, mono: true }] : []),
  ];

  const allText = fields.map((f) => `${f.label}: ${f.value}`).join("\n");
  const lineageJson = lineage ? JSON.stringify(lineage, null, 2) : "";

  return (
    <div className="card job-info-bar">
      <div className="job-info-bar__head">
        <span className="card-header" style={{ margin: 0, border: "none", padding: 0 }}>
          Job info
        </span>
        <CopyChip field={{ label: "all", value: allText }} />
      </div>

      <div className="job-info-bar__chips">
        {fields.map((f) => (
          <CopyChip key={f.label} field={f} />
        ))}
      </div>

      <div className="job-info-bar__sections">
        <Section
          id="lineage"
          label={lineage ? "Lineage" : "Lineage (none)"}
          open={openSection === "lineage"}
          onToggle={toggle}
          copyValue={lineageJson || undefined}
        >
          <pre className="slides-json" style={{ marginTop: 8 }}>
            {lineageJson || "No lineage loaded"}
          </pre>
        </Section>

        {validationNode ? (
          <Section id="validation" label="Validation" open={openSection === "validation"} onToggle={toggle}>
            {validationNode}
          </Section>
        ) : null}

        {mimicInspectNode ? (
          <Section
            id="mimic"
            label="Mimic package (advanced)"
            open={openSection === "mimic"}
            onToggle={toggle}
          >
            {mimicInspectNode}
          </Section>
        ) : null}
      </div>
    </div>
  );
}
