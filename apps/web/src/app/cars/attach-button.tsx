"use client";

import { FILE_PURPOSE_RULES } from "@fleetapp/core";
import { FilePicker } from "@fleetapp/ui/file-picker";
import { FormError } from "@fleetapp/ui/form-message";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AttachmentTarget } from "../../lib/files/attachments";
import { sendPaper } from "../../lib/files/send-paper";
import { finishAttachmentUploadAction, startAttachmentUploadAction } from "./attachment-actions";

const ATTACHMENT_RULE = FILE_PURPOSE_RULES.vehicle_attachment;

/** "Attach": a PDF or a photo of a paper, added to this record straight away. */
export function AttachButton({ target }: { target: AttachmentTarget }) {
  const router = useRouter();
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleFilesChosen(chosen: File[]): Promise<void> {
    setIsSending(true);
    setMessage(null);
    for (const file of chosen) {
      const problem = await sendPaper(
        file,
        (planned) => startAttachmentUploadAction({ target, ...planned }),
        finishAttachmentUploadAction,
      );
      if (problem) {
        setMessage(problem);
        break;
      }
    }
    setIsSending(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1">
      <FilePicker
        label={isSending ? "Attaching…" : "Attach"}
        accept={ATTACHMENT_RULE.contentTypes.join(",")}
        isMultiple
        isDisabled={isSending}
        variant="ghost"
        onFilesChosen={(chosen) => void handleFilesChosen(chosen)}
      />
      <FormError message={message} />
    </div>
  );
}
