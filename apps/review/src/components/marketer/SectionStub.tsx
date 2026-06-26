"use client";

import Link from "next/link";
import { useReviewProject } from "@/components/ReviewProjectContext";

interface SectionStubProps {
  title: string;
  description: string;
  slug: string;
  whatYouCanDo?: string[];
  backendNote?: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}

export function SectionStub({
  title,
  description,
  slug,
  whatYouCanDo = [],
  backendNote,
  primaryHref,
  primaryLabel = "Get started",
  secondaryHref,
  secondaryLabel,
}: SectionStubProps) {
  const { brandHref } = useReviewProject();

  return (
    <div className="section-stub">
      <h2>{title}</h2>
      <p className="section-stub-lead">{description}</p>
      {whatYouCanDo.length > 0 && (
        <div className="section-stub-card">
          <h3>What you can do here</h3>
          <ul>
            {whatYouCanDo.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {backendNote && (
        <p className="section-stub-note">
          <strong>Note:</strong> {backendNote}
        </p>
      )}
      <div className="section-stub-actions">
        {primaryHref && (
          <Link href={primaryHref.startsWith("/") ? primaryHref : brandHref(slug, primaryHref)} className="btn-primary">
            {primaryLabel}
          </Link>
        )}
        {secondaryHref && (
          <Link
            href={secondaryHref.startsWith("/") ? secondaryHref : brandHref(slug, secondaryHref)}
            className="btn-ghost"
          >
            {secondaryLabel}
          </Link>
        )}
        <Link href={brandHref(slug)} className="btn-ghost">
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}
