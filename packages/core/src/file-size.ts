const BYTES_PER_UNIT = 1024;
const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** A size as a person would say it: "0 B", "820 KB", "4.2 MB". */
export function formatFileSize(bytes: number): string {
  let value = Math.max(0, bytes);
  let unitIndex = 0;
  while (value >= BYTES_PER_UNIT && unitIndex < UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unitIndex += 1;
  }
  const rounded = unitIndex === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[unitIndex]}`;
}
