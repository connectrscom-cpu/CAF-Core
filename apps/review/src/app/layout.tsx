import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ReviewAppShell } from "@/components/ReviewAppShell";

export const metadata: Metadata = {
  title: "CAF — Content workspace",
  description: "Manage brands, review content, and publish with CAF",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
  ],
};

// Applies the stored theme before first paint to avoid a dark→light flash.
// Key must match THEME_STORAGE_KEY in src/lib/theme.ts (shared with the Core admin shell).
const THEME_INIT_SCRIPT = `(function(){try{if(localStorage.getItem("caf-theme")==="light")document.documentElement.setAttribute("data-theme","light");}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ReviewAppShell>{children}</ReviewAppShell>
      </body>
    </html>
  );
}
