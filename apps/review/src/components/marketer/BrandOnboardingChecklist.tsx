"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  buildBrandOnboardingSteps,
  dismissBrandChecklist,
  onboardingProgress,
  readOnboardingState,
} from "@/lib/marketer/onboarding";
import type { BrandSummary } from "@/lib/marketer/types";

interface BrandOnboardingChecklistProps {
  brand: BrandSummary;
}

export function BrandOnboardingChecklist({ brand }: BrandOnboardingChecklistProps) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const state = readOnboardingState();
    setDismissed(!!state.brandChecklistDismissed[brand.slug]);
  }, [brand.slug]);

  const steps = buildBrandOnboardingSteps({
    slug: brand.slug,
    hasProfile: !brand.setupWarnings.some((w) => w.toLowerCase().includes("profile")),
    hasResearch: brand.researchStatus !== "not_started",
    hasIntelligence: brand.intelligenceStatus !== "not_started",
    hasIdeas: brand.ideasReady > 0,
    hasContentReview: brand.stats.activeContent > 0,
    hasPublishing: brand.stats.scheduledPosts > 0,
  });

  const progress = onboardingProgress(steps);
  const allDone = progress.complete >= progress.total;

  if (dismissed || allDone) return null;

  return (
    <section className="onboarding-checklist" aria-labelledby={`checklist-${brand.slug}`}>
      <div className="onboarding-checklist-header">
        <div>
          <h2 id={`checklist-${brand.slug}`}>Getting started with {brand.displayName}</h2>
          <p>Complete these steps to get the most from CAF. You can return anytime.</p>
        </div>
        <div className="onboarding-checklist-progress">
          <span className="onboarding-checklist-percent">{progress.percent}%</span>
          <div className="onboarding-progress-bar">
            <div className="onboarding-progress-fill" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
      </div>
      <ol className="onboarding-checklist-steps">
        {steps.map((step, index) => (
          <li key={step.id} className={step.complete ? "is-complete" : ""}>
            <span className="onboarding-checklist-marker" aria-hidden>
              {step.complete ? "✓" : index + 1}
            </span>
            <div className="onboarding-checklist-body">
              <strong>{step.title}</strong>
              <p>{step.description}</p>
              {!step.complete && (
                <Link href={step.href} className="onboarding-checklist-link">
                  {step.id === "profile" ? "Set up profile" : "Go to step"} →
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="btn-ghost btn-sm onboarding-checklist-dismiss"
        onClick={() => {
          dismissBrandChecklist(brand.slug);
          setDismissed(true);
        }}
      >
        Dismiss checklist
      </button>
    </section>
  );
}
