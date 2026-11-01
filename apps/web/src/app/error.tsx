"use client";

import { Button } from "@fleetapp/ui/button";
import { ProblemPanel } from "@fleetapp/ui/problem-panel";
import Link from "next/link";
import { useEffect } from "react";

import { HOME_PATH } from "../lib/paths";

/** Instead of a blank screen when a page or a save fails, e.g. the connection dropped. */
export default function ErrorPage(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // The digest only: the message could hold what was being saved.
    console.error("A page failed", props.error.digest ?? props.error.name);
  }, [props.error]);
  return (
    <ProblemPanel
      title="That didn't work"
      message="Something went wrong, often a dropped connection. Check your signal and try again. If it keeps happening, come back in a few minutes."
      actions={
        <>
          <Button onClick={() => props.retry()} className="w-full sm:w-auto">
            Try again
          </Button>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href={HOME_PATH}>Go to the start</Link>
          </Button>
        </>
      }
    />
  );
}
