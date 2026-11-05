// jscpd:ignore-start -- each app needs its own root layout, and Next requires the font settings written out where the font is loaded
import { BRAND } from "@fleetapp/ui/brand";
import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";

// Side-effect import: validates env vars with Zod on load so a missing or
// invalid value fails the build/deploy instead of failing later at runtime.
import "../env";
import "./globals.css";
import { AppDocument } from "@fleetapp/ui/app-document";

// Downloaded when the app is built and served from the app itself.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

// jscpd:ignore-end

export const metadata: Metadata = {
  // Each page names itself, so tabs can be told apart (review A10-2).
  title: { default: BRAND.adminName, template: `%s · ${BRAND.adminName}` },
  description: "Altus Global Solutions platform admin.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <AppDocument fontClassName={manrope.variable}>{children}</AppDocument>;
}
