import type { Metadata } from "next";
import "./globals.css";
import { ReviewAppShell } from "@/components/ReviewAppShell";

export const metadata: Metadata = {
  title: "CAF — Content workspace",
  description: "Manage brands, review content, and publish with CAF",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ReviewAppShell>{children}</ReviewAppShell>
      </body>
    </html>
  );
}
