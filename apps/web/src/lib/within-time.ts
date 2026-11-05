/** What `withinTime` gives when the step took too long. */
export const TIMED_OUT = Symbol("timed out");

/**
 * The step's result, or TIMED_OUT once `milliseconds` pass first: so a call
 * that hangs on weak signal never leaves a button stuck (review A10-5). The
 * step itself is not stopped; its late result is ignored.
 */
export async function withinTime<Result>(
  step: Promise<Result>,
  milliseconds: number,
): Promise<Result | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), milliseconds);
  });
  try {
    return await Promise.race([step, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
