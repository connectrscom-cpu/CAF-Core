"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { MarketerSidebar } from "@/components/marketer/MarketerSidebar";
import { Sidebar } from "@/components/Sidebar";
import { ReviewBackgroundJobToasts } from "@/components/ReviewBackgroundJobToasts";
import { WelcomeOnboarding } from "@/components/marketer/WelcomeOnboarding";
import { ReviewProjectProvider } from "@/components/ReviewProjectContext";
import { ReviewChromeMessageSync } from "@/components/ReviewChromeMessageSync";
import { ReviewMobileChromeBar } from "@/components/ReviewMobileChromeBar";
import { ChromePanelToggle } from "@/components/ChromePanelToggle";
import { useReviewChromeLayout } from "@/lib/review-chrome-layout";
import { useMobileLayout } from "@/lib/use-mobile-layout";
import { isOperatorMode } from "@/lib/marketer/debug";
import { clientSearchParams, useClientSearchQuery } from "@/lib/use-client-search-query";

const MOBILE_NAV_INIT_KEY = "caf-review-mobile-nav-init";

function ShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchQuery = useClientSearchQuery();
  const searchParams = clientSearchParams(searchQuery);
  const embeddedInAdmin = searchParams.get("embed") === "admin";
  const operator = isOperatorMode(searchParams);
  const isMobile = useMobileLayout();
  const { layout, ready, toggleSidebar, openSidebar, closeSidebar } = useReviewChromeLayout();
  const hideSidebar = ready && layout.hideReviewSidebar && !embeddedInAdmin;
  const showMobileChrome = isMobile && !embeddedInAdmin && hideSidebar;
  const sidebarOpenOnMobile = isMobile && !hideSidebar;
  const renderSidebar = !embeddedInAdmin && (isMobile || !hideSidebar);
  const prevPathname = useRef(pathname);

  useEffect(() => {
    if (!isMobile || !ready || embeddedInAdmin) return;
    try {
      if (sessionStorage.getItem(MOBILE_NAV_INIT_KEY)) return;
      sessionStorage.setItem(MOBILE_NAV_INIT_KEY, "1");
      if (!layout.hideReviewSidebar) closeSidebar();
    } catch {
      /* ignore private mode */
    }
  }, [closeSidebar, embeddedInAdmin, isMobile, layout.hideReviewSidebar, ready]);

  useEffect(() => {
    if (!isMobile || !ready || embeddedInAdmin) return;
    if (prevPathname.current === pathname) return;
    prevPathname.current = pathname;
    if (!layout.hideReviewSidebar) closeSidebar();
  }, [closeSidebar, embeddedInAdmin, isMobile, layout.hideReviewSidebar, pathname, ready]);

  const shellClass = [
    embeddedInAdmin
      ? "app-shell app-shell--embedded"
      : operator
        ? "app-shell"
        : "app-shell app-shell--marketer",
    hideSidebar ? "app-shell--sidebar-hidden" : "",
    isMobile ? "app-shell--mobile" : "",
    sidebarOpenOnMobile ? "app-shell--sidebar-open-mobile" : "",
    showMobileChrome ? "app-shell--mobile-chrome-visible" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const mainClass = [
    operator || embeddedInAdmin ? "main-content" : "main-content main-content--marketer",
    showMobileChrome ? "main-content--mobile-chrome" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <ReviewProjectProvider>
      <ReviewChromeMessageSync />
      {showMobileChrome ? <ReviewMobileChromeBar onOpenNav={openSidebar} operator={operator} /> : null}
      {sidebarOpenOnMobile ? (
        <button
          type="button"
          className="review-nav-overlay"
          aria-label="Close navigation"
          onClick={closeSidebar}
        />
      ) : null}
      {hideSidebar && !isMobile ? (
        <ChromePanelToggle
          expanded={false}
          onClick={toggleSidebar}
          title="Show navigation"
          variant="strip"
          className="chrome-panel-expand--nav"
        />
      ) : null}
      <div className={shellClass} data-agent-id="app-shell">
        {renderSidebar ? (operator ? <Sidebar /> : <MarketerSidebar />) : null}
        <main className={mainClass} data-agent-id="main-content">
          <Suspense fallback={<p className="workspace-muted" style={{ padding: 28 }}>Loading page…</p>}>
            <div key={pathname} className="main-content-route">
              {children}
            </div>
          </Suspense>
        </main>
        <ReviewBackgroundJobToasts />
        {!embeddedInAdmin && !operator && <WelcomeOnboarding />}
      </div>
    </ReviewProjectProvider>
  );
}

export function ReviewAppShell({ children }: { children: React.ReactNode }) {
  return <ShellInner>{children}</ShellInner>;
}
