"use client";

import { FILE_PURPOSE_RULES, MAXIMUM_LINE_LENGTH, requiredLine } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FilePicker } from "@fleetapp/ui/file-picker";
import { useDialogClose } from "@fleetapp/ui/form-dialog";
import { FormField } from "@fleetapp/ui/form-field";
import { FormError } from "@fleetapp/ui/form-message";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { shrinkImage } from "@fleetapp/ui/shrink-image";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SEND_FAILED_MESSAGE, sendToStorage } from "../../../lib/files/send-to-storage";
import { finishCarDocumentUploadAction, startCarDocumentUploadAction } from "./file-actions";

const DOCUMENT_RULE = FILE_PURPOSE_RULES.vehicle_document;
const CHOOSE_FILE_MESSAGE = "Choose a file.";
const UNREADABLE_MESSAGE = "This image could not be opened here. Save it as a PDF and try again.";

/** Images are shrunk on the phone like photos (rule 21); PDFs go as they are. */
async function prepared(file: File): Promise<Blob | null> {
  return file.type.startsWith("image/") ? shrinkImage(file) : file;
}

async function sendDocument(vehicleId: string, label: string, file: File): Promise<string | null> {
  const upload = await prepared(file);
  if (!upload) {
    return UNREADABLE_MESSAGE;
  }
  const start = await startCarDocumentUploadAction(vehicleId, {
    label,
    contentType: upload.type,
    sizeBytes: upload.size,
  });
  if (start.status === "refused") {
    return start.message;
  }
  if (!(await sendToStorage(start.permission, upload))) {
    return SEND_FAILED_MESSAGE;
  }
  return finishCarDocumentUploadAction(vehicleId, start.fileId);
}

/** "Add a document": a name and a PDF or image. Saving closes the pop-up. */
export function DocumentUploadForm({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();
  const closeDialog = useDialogClose();
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isLabelChecked, setIsLabelChecked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const labelError = isLabelChecked
    ? requiredLine.safeParse(label).error?.issues[0]?.message
    : undefined;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsLabelChecked(true);
    if (!requiredLine.safeParse(label).success) {
      document.getElementById("documentLabel")?.focus();
      return;
    }
    if (!file) {
      setMessage(CHOOSE_FILE_MESSAGE);
      return;
    }
    setIsSending(true);
    setMessage(null);
    const problem = await sendDocument(vehicleId, label.trim(), file);
    setIsSending(false);
    if (problem) {
      setMessage(problem);
      return;
    }
    router.refresh();
    closeDialog?.();
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate className="flex flex-col gap-4">
      <RequiredFieldsNote />
      <FormField htmlFor="documentLabel" label="Name" isRequired error={labelError}>
        <Input
          id="documentLabel"
          value={label}
          maxLength={MAXIMUM_LINE_LENGTH}
          aria-required
          placeholder="e.g. Pre-purchase inspection"
          onChange={(event) => setLabel(event.target.value)}
          onBlur={() => setIsLabelChecked(true)}
        />
      </FormField>
      <div className="flex flex-col gap-2">
        <FilePicker
          label={file ? "Choose a different file" : "Choose file"}
          accept={DOCUMENT_RULE.contentTypes.join(",")}
          onFilesChosen={(chosen) => {
            setFile(chosen[0] ?? null);
            setMessage(null);
          }}
        />
        <p className="text-muted-foreground text-xs">
          {/* The name stays on this device: only what you type above is saved. */}
          {file ? `${file.name} chosen. ` : ""}Use {DOCUMENT_RULE.describedAs}.
        </p>
      </div>
      <FormError message={message} />
      <Button type="submit" disabled={isSending} className="sm:self-start">
        {isSending ? "Saving…" : "Save document"}
      </Button>
    </form>
  );
}
