"use client";

import { Badge } from "@fleetapp/ui/badge";
import { Button } from "@fleetapp/ui/button";
import { FormError } from "@fleetapp/ui/form-message";
import { DatabaseZap } from "lucide-react";
import { useState } from "react";

import type { DemoStep } from "../../../lib/demo-data/demo-steps";
import { runDemoStepAction } from "./actions";

type StepState =
  { kind: "waiting" } | { kind: "running" } | { kind: "done"; added: number } | { kind: "failed" };

function StepBadge({ state }: { state: StepState }) {
  switch (state.kind) {
    case "running":
      return <Badge tone="attention">Adding…</Badge>;
    case "done":
      return (
        <Badge tone="good">{state.added === 0 ? "Already there" : `Added ${state.added}`}</Badge>
      );
    case "failed":
      return <Badge tone="danger">Stopped</Badge>;
    default:
      return <Badge>Waiting</Badge>;
  }
}

/**
 * Runs the demo steps one after another, each its own request so none hits
 * the time limit. If one stops, pressing the button again carries on: steps
 * already done add nothing the second time.
 */
export function DemoDataRunner({ steps }: { steps: readonly DemoStep[] }) {
  const [states, setStates] = useState<Record<string, StepState>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [isFinished, setIsFinished] = useState(false);

  function setStep(key: string, state: StepState): void {
    setStates((current) => ({ ...current, [key]: state }));
  }

  async function handleStart(): Promise<void> {
    setIsRunning(true);
    setProblem(null);
    setIsFinished(false);
    for (const step of steps) {
      setStep(step.key, { kind: "running" });
      const outcome = await runDemoStepAction(step.key).catch(() => ({
        status: "failed" as const,
        message: "The connection dropped. Press the button again to carry on.",
      }));
      if (outcome.status === "failed") {
        setStep(step.key, { kind: "failed" });
        setProblem(`${step.label}: ${outcome.message}`);
        setIsRunning(false);
        return;
      }
      setStep(step.key, { kind: "done", added: outcome.added });
    }
    setIsRunning(false);
    setIsFinished(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <Button
        type="button"
        onClick={() => void handleStart()}
        disabled={isRunning}
        className="sm:self-start"
      >
        <DatabaseZap aria-hidden />
        {isRunning ? "Adding demo data…" : "Add demo data"}
      </Button>
      <FormError message={problem} />
      <p role="status" className="text-sm font-medium">
        {isFinished ? "Done. Open Cars, Renters or Rentals to see it." : ""}
      </p>
      <ol aria-label="Steps" className="flex flex-col divide-y rounded-md border">
        {steps.map((step) => (
          <li key={step.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span>{step.label}</span>
            <StepBadge state={states[step.key] ?? { kind: "waiting" }} />
          </li>
        ))}
      </ol>
    </div>
  );
}
