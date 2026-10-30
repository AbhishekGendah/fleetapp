import type { UploadPermission } from "../storage/file-storage";

/** Straight from the browser to storage, with the one-time permission the server gave. */
export async function sendToStorage(permission: UploadPermission, file: Blob): Promise<boolean> {
  const form = new FormData();
  for (const [name, value] of Object.entries(permission.fields)) {
    form.append(name, value);
  }
  form.append("file", file);
  const response = await fetch(permission.url, { method: "POST", body: form }).catch(() => null);
  return response?.ok ?? false;
}

export const SEND_FAILED_MESSAGE =
  "The upload did not finish. Check your connection and try again.";
