import { BRAND } from "@fleetapp/ui/brand";
import type { Metadata, Viewport } from "next";
import { Manrope, Michroma } from "next/font/google";

// Side-effect import: validates env vars with Zod on load so a missing or
// invalid value fails the build/deploy instead of failing later at runtime.
import "../env";
import "./globals.css";

// Downloaded when the app is built and served from the app itself, so no
// Operator's browser makes a request to Google.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
// The wordmark font: used for the product name only.
const michroma = Michroma({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-michroma",
  display: "swap",
});

export const metadata: Metadata = {
  title: BRAND.productName,
  description: "Vehicle rental management for Australian rental businesses.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: BRAND.colours.primary,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" className={`${manrope.variable} ${michroma.variable}`}>
      <body>{children}</body>
    </html>
  );
}
