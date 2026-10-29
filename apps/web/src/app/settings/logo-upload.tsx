"use client";

import { FILE_PURPOSE_RULES } from "@fleetapp/core";
import { ImageUpload } from "@fleetapp/ui/image-upload";
import { useRouter } from "next/navigation";

import type { UploadPermission } from "../../lib/storage/file-storage";
import { finishLogoUploadAction, removeLogoAction, startLogoUploadAction } from "./logo-actions";

const LOGO_RULE = FILE_PURPOSE_RULES.operator_logo;
const SEND_FAILED_MESSAGE = "The upload did not finish. Check your connection and try again.";

/** Straight from the browser to storage, with the one-time permission the server gave. */
async function sendToStorage(permission: UploadPermission, image: Blob): Promise<boolean> {
  const form = new FormData();
  for (const [name, value] of Object.entries(permission.fields)) {
    form.append(name, value);
  }
  form.append("file", image);
  const response = await fetch(permission.url, { method: "POST", body: form }).catch(() => null);
  return response?.ok ?? false;
}

export function LogoUpload({ logoUrl }: { logoUrl: string | null }) {
  const router = useRouter();

  async function handleUpload(image: Blob): Promise<string | null> {
    const start = await startLogoUploadAction({ contentType: image.type, sizeBytes: image.size });
    if (start.status === "refused") {
      return start.message;
    }
    if (!(await sendToStorage(start.permission, image))) {
      return SEND_FAILED_MESSAGE;
    }
    const problem = await finishLogoUploadAction(start.fileId);
    if (!problem) {
      router.refresh();
    }
    return problem;
  }

  async function handleRemove(): Promise<void> {
    await removeLogoAction();
    router.refresh();
  }

  return (
    <ImageUpload
      id="logo"
      label="Logo"
      hint={`Shown in the app, and later on your contracts and invoices. Use ${LOGO_RULE.describedAs}.`}
      currentImageUrl={logoUrl}
      accept={LOGO_RULE.contentTypes.join(",")}
      onUpload={handleUpload}
      onRemove={handleRemove}
    />
  );
}
