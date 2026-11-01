"use client";

import "./globals.css";

import { Button } from "@fleetapp/ui/button";
import { ProblemPanel } from "@fleetapp/ui/problem-panel";

/** When even the page frame fails: it has to bring its own html and body. */
export default function GlobalErrorPage(props: { retry: () => void }) {
  return (
    <html lang="en-AU">
      <body>
        <ProblemPanel
          title="That didn't work"
          message="Something went wrong. Check your connection and try again."
          actions={<Button onClick={() => props.retry()}>Try again</Button>}
        />
      </body>
    </html>
  );
}
