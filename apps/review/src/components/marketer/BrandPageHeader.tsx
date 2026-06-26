"use client";

import Link from "next/link";
import { useReviewProject } from "@/components/ReviewProjectContext";
import { brandAvatarStylePlain, brandInitials } from "@/lib/marketer/brand-adapters";

interface BrandPageHeaderProps {
  displayName: string;
  slug: string;
  accentColor?: string | null;
  subtitle?: string;
  children?: React.ReactNode;
}

export function BrandPageHeader({
  displayName,
  slug,
  accentColor = null,
  subtitle,
  children,
}: BrandPageHeaderProps) {
  const { brandHref } = useReviewProject();

  return (
    <div className="brand-page-header" data-agent-id="brand-header">
      <div className="brand-page-header-main">
        <Link href={brandHref(slug)} className="brand-page-header-avatar" style={brandAvatarStylePlain(accentColor)}>
          {brandInitials(displayName)}
        </Link>
        <div>
          <nav className="brand-breadcrumb" aria-label="Breadcrumb">
            <Link href="/workspace">Workspace</Link>
            <span aria-hidden>/</span>
            <span>{displayName}</span>
          </nav>
          <h1>{displayName}</h1>
          {subtitle && <p className="brand-page-subtitle">{subtitle}</p>}
        </div>
      </div>
      {children ? <div className="brand-page-header-actions">{children}</div> : null}
    </div>
  );
}
