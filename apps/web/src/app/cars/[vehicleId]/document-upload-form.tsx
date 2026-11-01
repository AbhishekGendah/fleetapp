"use client";

import { fieldErrorsOf, FILE_PURPOSE_RULES, requiredLine } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FilePicker } from "@fleetapp/ui/file-picker";
import { useDialogClose } from "@fleetapp/ui/form-dialog";
import { FormField } from "@fleetapp/ui/form-field";
import { FormSection } from "@fleetapp/ui/form-section";
import { FormError } from "@fleetapp/ui/form-message";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import { sendPaper } from "../../../lib/files/send-paper";
import { finishCarDocumentUploadAction, startCarDocumentUploadAction } from "./file-actions";

const DOCUMENT_RULE = FILE_PURPOSE_RULES.vehicle_document;
const CHOOSE_FILE_MESSAGE = "Choose a file.";

function sendDocument(vehicleId: string, label: string, file: File): Promise<string | null> {
  return sendPaper(
    file,
    (planned) => startCarDocumentUploadAction(vehicleId, { label, ...planned }),
    (fileId) => finishCarDocumentUploadAction(vehicleId, fileId),
  );
}

const DOCUMENT_FIELDS = ["documentLabel"] as const;
const documentInputSchema = z.object({ documentLabel: requiredLine });

/** "Add a document": a name and a PDF or image. Saving closes the pop-up. */
export function DocumentUploadForm({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();
  const closeDialog = useDialogClose();
  const form = useFormFields({
    fields: DOCUMENT_FIELDS,
    initialValues: { documentLabel: "" },
    validate: (values) => fieldErrorsOf(documentInputSchema.safeParse(values)),
    isRequired: () => true,
  });
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  async function sendChosenFile(): Promise<void> {
    if (!file) {
      setMessage(CHOOSE_FILE_MESSAGE);
      return;
    }
    setIsSending(true);
    setMessage(null);
    const problem = await sendDocument(vehicleId, form.values.documentLabel.trim(), file);
    setIsSending(false);
    if (problem) {
      setMessage(problem);
      return;
    }
    router.refresh();
    closeDialog?.();
  }

  return (
    <form
      onSubmit={form.submitHandler(() => void sendChosenFile())}
      noValidate
      className="flex flex-col gap-4"
    >
      <RequiredFieldsNote />
      <FormField
        htmlFor={form.idFor("documentLabel")}
        label="Name"
        isRequired
        error={form.errorFor("documentLabel")}
      >
        <Input {...form.textBoxProps("documentLabel")} placeholder="e.g. Pre-purchase inspection" />
      </FormField>
      <FormSection title="File" isRequired>
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
      </FormSection>
      <FormError message={message} />
      <Button type="submit" disabled={isSending} className="sm:self-start">
        {isSending ? "Saving…" : "Save document"}
      </Button>
    </form>
  );
}
