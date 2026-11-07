import type { SetupStep } from "@fleetapp/core";
import { Card, SectionLabel } from "@fleetapp/ui/card";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { SETUP_STEP_COPY } from "../lib/dashboard/setup-step-copy";

const HEADING_ID = "setup-heading";
const PERCENT = 100;

/** "Connect Stripe" read on after "Next:", as "connect Stripe". */
function midSentence(title: string): string {
  return `${title.charAt(0).toLowerCase()}${title.slice(1)}`;
}

/** While setup is unfinished: how far along it is, and the one step to do next. */
export function SetupChecklistCard({ steps }: { steps: SetupStep[] }) {
  const doneCount = steps.filter((step) => step.status === "done").length;
  const nextStep = steps.find((step) => step.status !== "done");
  const progress = `${doneCount} of ${steps.length} done`;

  return (
    <Card>
      <section aria-labelledby={HEADING_ID} className="flex flex-col gap-2.5 p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-2">
          <SectionLabel id={HEADING_ID}>Finish setting up</SectionLabel>
          <span className="text-primary text-sm font-bold">{progress}</span>
        </div>
        <div
          className="bg-muted h-2 overflow-hidden rounded-full"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={doneCount}
          aria-valuetext={progress}
        >
          <div
            className="bg-teal h-full"
            style={{ width: `${(doneCount / steps.length) * PERCENT}%` }}
          />
        </div>
        {nextStep ? (
          <Link
            href={SETUP_STEP_COPY[nextStep.key].href}
            className="text-primary hover:text-primary-dark flex min-h-11 items-center justify-between gap-2 font-bold"
          >
            Next: {midSentence(SETUP_STEP_COPY[nextStep.key].title)}
            <ChevronRight aria-hidden className="text-teal size-5 shrink-0" />
          </Link>
        ) : null}
      </section>
    </Card>
  );
}
