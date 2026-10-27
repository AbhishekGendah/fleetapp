import type { SetupStep } from "@fleetapp/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { cn } from "@fleetapp/ui/cn";

import { SETUP_STEP_COPY } from "../lib/dashboard/setup-step-copy";

function StepMarker({ isDone }: { isDone: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
        isDone ? "bg-primary text-primary-foreground border-primary" : "border-input",
      )}
    >
      {isDone ? "✓" : null}
    </span>
  );
}

export function SetupChecklistCard({ steps }: { steps: SetupStep[] }) {
  const doneCount = steps.filter((step) => step.status === "done").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get set up</CardTitle>
        <CardDescription>
          {doneCount} of {steps.length} done
        </CardDescription>
        <div
          className="bg-muted mt-2 h-2 overflow-hidden rounded-full"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={doneCount}
          aria-label="Setup progress"
        >
          <div
            className="bg-primary h-full"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-4">
          {steps.map((step) => {
            const copy = SETUP_STEP_COPY[step.key];
            const isDone = step.status === "done";
            return (
              <li key={step.key} className="flex min-h-11 gap-3">
                <StepMarker isDone={isDone} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-col gap-x-2 sm:flex-row sm:items-center sm:justify-between">
                    <span
                      className={cn("font-medium", isDone && "text-muted-foreground line-through")}
                    >
                      {copy.title}
                    </span>
                    {isDone ? (
                      <span className="sr-only">Done</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">{copy.comingSoon}</span>
                    )}
                  </div>
                  <span className="text-muted-foreground text-sm">{copy.description}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
