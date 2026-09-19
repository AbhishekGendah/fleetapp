import type { Metadata, Viewport } from "next";

// Side-effect import: validates env vars with Zod on load so a missing or
// invalid value fails the build/deploy instead of failing later at runtime.
import "../env";
import "./globals.css";

export const metadata: Metadata = {
  title: "AGS Admin",
  description: "Altus Global Solutions platform admin.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
