"use client";

import { useState } from "react";

import { sendPaper } from "./send-paper";

type PaperSteps = Parameters<typeof sendPaper>;

/**
 * One slot's upload: whether it is sending, what to tell the person, and
 * `send` to start one. Runs `onSent` once a file is saved.
 */
export function usePaperUpload(steps: {
  start: PaperSteps[1];
  finish: PaperSteps[2];
  onSent: () => void;
}): { isSending: boolean; message: string | null; send: (file: File) => Promise<void> } {
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send(file: File): Promise<void> {
    setIsSending(true);
    setMessage(null);
    const problem = await sendPaper(file, steps.start, steps.finish);
    setIsSending(false);
    setMessage(problem);
    if (!problem) {
      steps.onSent();
    }
  }

  return { isSending, message, send };
}
