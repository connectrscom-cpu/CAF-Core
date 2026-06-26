"use client";

import { useEffect, useState } from "react";
import {
  dismissWelcome,
  readOnboardingState,
  WORKSPACE_FUNNEL_STEPS,
} from "@/lib/marketer/onboarding";

export function WelcomeOnboarding() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const state = readOnboardingState();
    if (!state.welcomeDismissed) setVisible(true);
  }, []);

  if (!visible) return null;

  const current = WORKSPACE_FUNNEL_STEPS[step];
  const isLast = step >= WORKSPACE_FUNNEL_STEPS.length - 1;

  function close() {
    dismissWelcome();
    setVisible(false);
  }

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="onboarding-modal">
        <div className="onboarding-modal-header">
          <span className="onboarding-kicker">Welcome to CAF</span>
          <h2 id="welcome-title">Your content workspace</h2>
          <p className="onboarding-lead">
            CAF helps you go from research to published content — without learning backend jargon. Here is how it works.
          </p>
        </div>

        <div className="onboarding-steps-preview">
          {WORKSPACE_FUNNEL_STEPS.map((s, i) => (
            <div key={s.step} className={`onboarding-step-pill ${i === step ? "is-active" : i < step ? "is-done" : ""}`}>
              <span className="onboarding-step-num">{s.step}</span>
              <span>{s.title}</span>
            </div>
          ))}
        </div>

        {current && (
          <div className="onboarding-step-card">
            <h3>{current.title}</h3>
            <p>{current.body}</p>
          </div>
        )}

        <div className="onboarding-modal-actions">
          <button type="button" className="btn-ghost" onClick={close}>
            Skip tour
          </button>
          <div className="onboarding-modal-actions-right">
            {step > 0 && (
              <button type="button" className="btn-ghost" onClick={() => setStep((s) => s - 1)}>
                Back
              </button>
            )}
            {isLast ? (
              <button type="button" className="btn-primary" onClick={close}>
                Get started
              </button>
            ) : (
              <button type="button" className="btn-primary" onClick={() => setStep((s) => s + 1)}>
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
