import type { Metadata } from "next";
import type { ReactNode } from "react";

// The page itself runs in the browser, so its tab title is set here (review).
export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordLayout({ children }: { children: ReactNode }): ReactNode {
  return children;
}
