import { BRAND } from "@fleetapp/ui/brand";
import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";

// Side-effect import: validates env vars with Zod on load so a missing or
// invalid value fails the build/deploy instead of failing later at runtime.
import "../env";
import "./globals.css";

// Downloaded when the app is built and served from the app itself.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: BRAND.adminName,
  description: "Altus Global Solutions platform admin.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" className={manrope.variable}>
      <body>{children}</body>
    </html>
  );
}
