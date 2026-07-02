"use client";

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  );
}

type ReviewMobileChromeBarProps = {
  onOpenNav: () => void;
  operator: boolean;
};

/** Fixed top bar on narrow viewports — opens the navigation drawer when the sidebar is minimized. */
export function ReviewMobileChromeBar({ onOpenNav, operator }: ReviewMobileChromeBarProps) {
  return (
    <header className="review-mobile-chrome" data-agent-id="mobile-chrome">
      <button
        type="button"
        className="review-mobile-chrome__menu"
        onClick={onOpenNav}
        aria-label="Open navigation"
        title="Open navigation"
      >
        <MenuIcon />
      </button>
      <span className="review-mobile-chrome__title">{operator ? "CAF Review" : "CAF"}</span>
    </header>
  );
}
