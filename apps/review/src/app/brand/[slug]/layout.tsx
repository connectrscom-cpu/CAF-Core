"use client";

import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { ContentCartProvider } from "@/components/marketer/ContentCartContext";
import { ContentCartDrawer } from "@/components/marketer/ContentCartDrawer";
import { ContentCartReviewModal } from "@/components/marketer/ContentCartReviewModal";

export default function BrandLayout({ children }: { children: ReactNode }) {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  if (!slug) return children;
  return (
    <ContentCartProvider slug={slug}>
      <div className="brand-layout" data-brand={slug}>
        {children}
        <ContentCartDrawer />
        <ContentCartReviewModal slug={slug} />
      </div>
    </ContentCartProvider>
  );
}
