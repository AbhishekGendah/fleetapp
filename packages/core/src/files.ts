/**
 * What files the product stores and the rules for each (rules 8, 21, 22).
 * Pure: the server checks every upload against these, and the browser uses
 * the same rules to refuse a wrong file before sending it.
 */

const BYTES_PER_MEGABYTE = 1024 * 1024;

/** The kinds of file the product keeps. Each later phase adds its own. */
export const FILE_PURPOSES = [
  "operator_logo",
  "vehicle_photo",
  "vehicle_photo_thumbnail",
  "vehicle_document",
  "vehicle_attachment",
  "vehicle_identity_attachment",
  "renter_licence_scan",
  "renter_submitted_scan",
] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

/** Identity documents live apart from everything else (rule 8). */
export const STORAGE_AREAS = ["general", "identity"] as const;
export type StorageArea = (typeof STORAGE_AREAS)[number];

/** Images and PDFs only (rule 22). */
export const FILE_CONTENT_TYPES = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
} as const;
export type FileContentType = (typeof FILE_CONTENT_TYPES)[keyof typeof FILE_CONTENT_TYPES];

export interface FilePurposeRule {
  area: StorageArea;
  contentTypes: readonly FileContentType[];
  maxBytes: number;
  /** In words, for the person choosing a file. */
  describedAs: string;
}

/** A paper as a PDF, or a photo of it. */
const DOCUMENT_CONTENT_TYPES: readonly FileContentType[] = [
  FILE_CONTENT_TYPES.pdf,
  FILE_CONTENT_TYPES.jpeg,
  FILE_CONTENT_TYPES.png,
  FILE_CONTENT_TYPES.webp,
];

export const FILE_PURPOSE_RULES: Readonly<Record<FilePurpose, FilePurposeRule>> = {
  // No SVG: it can carry code that would run wherever the logo is shown.
  operator_logo: {
    area: "general",
    contentTypes: [FILE_CONTENT_TYPES.png, FILE_CONTENT_TYPES.jpeg, FILE_CONTENT_TYPES.webp],
    maxBytes: 5 * BYTES_PER_MEGABYTE,
    describedAs: "a PNG, JPEG or WebP image up to 5 MB",
  },
  // Shrunk on the phone first, so a stored photo is about 400 KB.
  vehicle_photo: {
    area: "general",
    contentTypes: [FILE_CONTENT_TYPES.jpeg, FILE_CONTENT_TYPES.png, FILE_CONTENT_TYPES.webp],
    maxBytes: 5 * BYTES_PER_MEGABYTE,
    describedAs: "a photo (JPEG, PNG or WebP)",
  },
  vehicle_photo_thumbnail: {
    area: "general",
    contentTypes: [FILE_CONTENT_TYPES.jpeg, FILE_CONTENT_TYPES.png, FILE_CONTENT_TYPES.webp],
    maxBytes: 1 * BYTES_PER_MEGABYTE,
    describedAs: "a small copy of a photo",
  },
  vehicle_document: {
    area: "general",
    contentTypes: DOCUMENT_CONTENT_TYPES,
    maxBytes: 10 * BYTES_PER_MEGABYTE,
    describedAs: "a PDF or image up to 10 MB",
  },
  // Rego papers, insurance certificates, receipts.
  vehicle_attachment: {
    area: "general",
    contentTypes: DOCUMENT_CONTENT_TYPES,
    maxBytes: 10 * BYTES_PER_MEGABYTE,
    describedAs: "a PDF or image up to 10 MB",
  },
  // Purchase and sale papers: they usually show someone's licence and date
  // of birth, so they are kept with identity documents (rule 8).
  vehicle_identity_attachment: {
    area: "identity",
    contentTypes: DOCUMENT_CONTENT_TYPES,
    maxBytes: 10 * BYTES_PER_MEGABYTE,
    describedAs: "a PDF or image up to 10 MB",
  },
  // One side of a Renter's licence card: an identity document (rule 8).
  renter_licence_scan: {
    area: "identity",
    contentTypes: DOCUMENT_CONTENT_TYPES,
    maxBytes: 10 * BYTES_PER_MEGABYTE,
    describedAs: "a photo or PDF up to 10 MB",
  },
  // A licence photo a Renter sent through their link, waiting for the
  // Operator's review: an identity document too.
  renter_submitted_scan: {
    area: "identity",
    contentTypes: DOCUMENT_CONTENT_TYPES,
    maxBytes: 10 * BYTES_PER_MEGABYTE,
    describedAs: "a photo or PDF up to 10 MB",
  },
};

/**
 * The largest photo accepted from the camera or gallery before it is shrunk
 * on the phone. Above this the phone may run out of memory shrinking it.
 */
export const PICKED_PHOTO_MAX_BYTES = 25 * BYTES_PER_MEGABYTE;

/** The kinds of file that belong to a car, and so must name it. */
export const VEHICLE_FILE_PURPOSES: readonly FilePurpose[] = [
  "vehicle_photo",
  "vehicle_photo_thumbnail",
  "vehicle_document",
];

export type UploadProblem = "type_not_allowed" | "empty" | "too_large";

export const UPLOAD_PROBLEM_MESSAGES: Readonly<Record<UploadProblem, string>> = {
  type_not_allowed: "That kind of file cannot be used here.",
  empty: "That file is empty.",
  too_large: "That file is too large.",
};

/** Whether a file of this type and size may be uploaded for this purpose. */
export function checkUpload(
  purpose: FilePurpose,
  contentType: string,
  sizeBytes: number,
): UploadProblem | null {
  const rule = FILE_PURPOSE_RULES[purpose];
  if (!(rule.contentTypes as readonly string[]).includes(contentType)) {
    return "type_not_allowed";
  }
  if (sizeBytes <= 0) {
    return "empty";
  }
  return sizeBytes > rule.maxBytes ? "too_large" : null;
}

/** Enough of a file's start to recognise every type we accept. */
export const FILE_SIGNATURE_LENGTH = 12;

const ASCII = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

function startsWith(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

/**
 * What a file really is, from its first bytes rather than its name or what
 * the browser claimed (rule 22). Null for anything we do not accept.
 */
export function detectFileType(firstBytes: Uint8Array): FileContentType | null {
  if (startsWith(firstBytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return FILE_CONTENT_TYPES.png;
  }
  if (startsWith(firstBytes, [0xff, 0xd8, 0xff])) {
    return FILE_CONTENT_TYPES.jpeg;
  }
  if (startsWith(firstBytes, ASCII("RIFF")) && startsWith(firstBytes, ASCII("WEBP"), 8)) {
    return FILE_CONTENT_TYPES.webp;
  }
  if (startsWith(firstBytes, ASCII("%PDF-"))) {
    return FILE_CONTENT_TYPES.pdf;
  }
  return null;
}

/**
 * Where a file lives in its bucket. Always built by the server, never taken
 * from the browser, and always under its Operator, so one Operator's files
 * can never land among another's.
 */
export function buildFileKey(operatorId: string, purpose: FilePurpose, fileId: string): string {
  return `${operatorId}/${purpose}/${fileId}`;
}

/** Photo numbers run 001, 002… per car per day. */
const PHOTO_NUMBER_DIGITS = 3;

/** The start every photo's name shares on a day: "1ABC234 2026-10-30 ". */
export function photoNamePrefix(rego: string, localDate: string): string {
  return `${rego} ${localDate} `;
}

/** "1ABC234 2026-10-30 001": a photo's name, from the car's rego, the day and its number that day. */
export function photoName(rego: string, localDate: string, number: number): string {
  return `${photoNamePrefix(rego, localDate)}${String(number).padStart(PHOTO_NUMBER_DIGITS, "0")}`;
}

const EXTENSIONS: Readonly<Record<FileContentType, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * The name a file is saved or shared under: its label with the right
 * extension, and nothing that could break the download header.
 */
export function downloadName(label: string, contentType: string): string {
  const safe = label.replace(/[^\p{L}\p{N} ._-]/gu, "").trim() || "file";
  const extension = EXTENSIONS[contentType as FileContentType];
  return extension ? `${safe}.${extension}` : safe;
}
