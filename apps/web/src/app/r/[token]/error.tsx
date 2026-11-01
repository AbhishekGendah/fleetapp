"use client";

import { Button } from "@fleetapp/ui/button";
import { ProblemPanel } from "@fleetapp/ui/problem-panel";

/** For a Renter on their phone: usually poor signal. What they typed is kept on the phone. */
export default function RenterLinkErrorPage(props: { retry: () => void }) {
  return (
    <ProblemPanel
      title="That didn't go through"
      message="Check your signal and try again. What you typed is kept on this phone, so you won't lose it."
      actions={
        <Button onClick={() => props.retry()} className="w-full">
          Try again
        </Button>
      }
    />
  );
}
