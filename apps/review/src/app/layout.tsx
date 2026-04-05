import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "CAF Backend",
  description: "Content Automation Framework — Renderer, Template Playground, Review Console",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <nav className="sticky top-0 z-20 border-b bg-card px-3 py-2 sm:px-4 sm:py-3" aria-label="Main">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 sm:gap-6 md:gap-8">
            <Link href="/" className="text-sm font-semibold text-card-foreground hover:underline sm:text-base">
              CAF Backend
            </Link>
            <Link href="/" className="text-xs text-muted-foreground hover:text-foreground sm:text-sm">
              Review Console
            </Link>
            <Link href="/playground" className="text-xs text-muted-foreground hover:text-foreground sm:text-sm">
              Template Playground
            </Link>
            <Link href="/settings/renderer" className="text-xs text-muted-foreground hover:text-foreground sm:text-sm">
              Renderer Settings
            </Link>
            <Link href="/?status=approved" className="text-xs text-muted-foreground hover:text-foreground sm:text-sm">
              Approved
            </Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
