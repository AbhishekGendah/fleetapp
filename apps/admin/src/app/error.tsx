"use client";

import { Button } from "@fleetapp/ui/button";
import { ProblemPanel } from "@fleetapp/ui/problem-panel";
import { useEffect } from "react";

/** Instead of a blank screen when an admin page or action fails. */
export default function AdminErrorPage(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("An admin page failed", props.error.digest ?? props.error.name);
  }, [props.error]);
  return (
    <ProblemPanel
      title="Something went wrong"
      message="The page or action failed. Try again; if it keeps failing, check the Vercel logs."
      actions={<Button onClick={() => props.retry()}>Try again</Button>}
    />
  );
}
