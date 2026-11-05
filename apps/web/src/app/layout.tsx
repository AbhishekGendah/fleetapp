// jscpd:ignore-start -- each app needs its own root layout, and Next requires the font settings written out where the font is loaded
import { BRAND } from "@fleetapp/ui/brand";
import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";

// Side-effect import: validates env vars with Zod on load so a missing or
// invalid value fails the build/deploy instead of failing later at runtime.
import "../env";
import { APP_DESCRIPTION } from "../lib/app-metadata";
import "./globals.css";
import { AppDocument } from "@fleetapp/ui/app-document";

// Downloaded when the app is built and served from the app itself, so no
// Operator's browser makes a request to Google.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

// jscpd:ignore-end

export const metadata: Metadata = {
  // Each page names itself, so tabs can be told apart (review A10-2).
  title: { default: BRAND.productName, template: `%s · ${BRAND.productName}` },
  description: APP_DESCRIPTION,
  // iPhones ignore most of the manifest: these make a home-screen copy open full screen.
  appleWebApp: { capable: true, title: BRAND.productName, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: BRAND.colours.primary,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <AppDocument fontClassName={manrope.variable}>{children}</AppDocument>;
}
