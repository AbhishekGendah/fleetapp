import { fileTypeFromBuffer } from "file-type";

import { FILE_CONTENT_TYPES, type FileContentType } from "./files";

/** How much of a file's start the check reads: file-type documents 4100 bytes as enough to be sure. */
export const FILE_SIGNATURE_LENGTH = 4100;

const ACCEPTED_TYPES: readonly string[] = Object.values(FILE_CONTENT_TYPES);

function isAcceptedType(mime: string): mime is FileContentType {
  return ACCEPTED_TYPES.includes(mime);
}

/**
 * What a file really is, from its content rather than its name or what the
 * browser claimed (rule 22), by file-type, which knows hundreds of formats.
 * Null for anything we do not accept.
 */
export async function detectFileType(firstBytes: Uint8Array): Promise<FileContentType | null> {
  const detected = await fileTypeFromBuffer(firstBytes);
  return detected && isAcceptedType(detected.mime) ? detected.mime : null;
}
