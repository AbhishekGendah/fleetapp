"use client";

import { describeErrorForLog } from "@fleetapp/core";
import type { FormFields } from "@fleetapp/ui/use-form-fields";
import { useEffect, useRef } from "react";
import { z } from "zod";

import {
  DETAILS_FORM_FIELDS,
  type DetailsFormField,
} from "../../../lib/renter-links/details-form-input";

const DRAFT_KEY_PREFIX = "renter-details-draft:";
/** Never kept on the phone: the licence number is typed again if the page is lost. */
const NEVER_KEPT: readonly DetailsFormField[] = ["licenceNumber"];

const draftSchema = z.object({
  expiresAt: z.iso.datetime(),
  values: z.record(z.string(), z.string()),
});

function draftKey(linkId: string): string {
  return `${DRAFT_KEY_PREFIX}${linkId}`;
}

/** Storage can be blocked (private browsing, full): the form then just is not kept. */
function withStorage(step: (storage: Storage) => void): void {
  try {
    step(window.localStorage);
  } catch (error) {
    console.warn("The form could not be kept on this phone", describeErrorForLog(error));
  }
}

function readKept(storage: Storage, key: string): z.infer<typeof draftSchema> | null {
  try {
    const parsed = draftSchema.safeParse(JSON.parse(storage.getItem(key) ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    // Not ours, or damaged: treated as nothing kept, and swept away.
    return null;
  }
}

/** Removes every kept form past its link's end, or unreadable, whichever link it was for. */
function sweepOldDrafts(storage: Storage, now: number): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (key?.startsWith(DRAFT_KEY_PREFIX)) {
      const kept = readKept(storage, key);
      if (!kept || new Date(kept.expiresAt).getTime() < now) {
        storage.removeItem(key);
      }
    }
  }
}

/** The kept boxes that differ from the form as it opened, or nothing. */
function readDraft(
  storage: Storage,
  linkId: string,
  openedWith: Readonly<Record<DetailsFormField, string>>,
): Partial<Record<DetailsFormField, string>> {
  const kept = readKept(storage, draftKey(linkId))?.values ?? {};
  return Object.fromEntries(
    DETAILS_FORM_FIELDS.flatMap((field) => {
      const value = kept[field];
      return value !== undefined && value !== openedWith[field] && !NEVER_KEPT.includes(field)
        ? [[field, value]]
        : [];
    }),
  );
}

/** Only the boxes the Renter changed, never the licence number. */
function changedValues(
  values: Readonly<Record<DetailsFormField, string>>,
  openedWith: Readonly<Record<DetailsFormField, string>>,
): Partial<Record<DetailsFormField, string>> {
  return Object.fromEntries(
    DETAILS_FORM_FIELDS.flatMap((field) =>
      values[field] !== openedWith[field] && !NEVER_KEPT.includes(field)
        ? [[field, values[field]]]
        : [],
    ),
  );
}

/** Drops this link's kept form and any old ones: on sending, and whenever the link shows "Thanks". */
export function forgetDraft(linkId: string): void {
  withStorage((storage) => {
    storage.removeItem(draftKey(linkId));
    sweepOldDrafts(storage, Date.now());
  });
}

/**
 * Keeps what the Renter types on their own phone until they send it, so
 * lost signal or a closed page loses nothing (rule 25's spirit). Only boxes
 * they changed are kept, never the licence number; it is dropped once sent,
 * and old drafts on the phone are swept away on every visit (APP 11).
 */
export function useDetailsDraft(
  form: FormFields<DetailsFormField>,
  linkId: string,
  expiresAt: string,
): { clearDraft: () => void } {
  const isRestored = useRef(false);
  const { fillIn, values } = form;
  const openedWith = useRef(values);

  useEffect(() => {
    withStorage((storage) => {
      sweepOldDrafts(storage, Date.now());
      const kept = readDraft(storage, linkId, openedWith.current);
      if (Object.keys(kept).length > 0) {
        fillIn(kept);
      }
    });
    isRestored.current = true;
    // Once, when the page opens: later changes are saved, not restored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isRestored.current) {
      return;
    }
    const changed = changedValues(values, openedWith.current);
    withStorage((storage) => {
      if (Object.keys(changed).length === 0) {
        storage.removeItem(draftKey(linkId));
        return;
      }
      storage.setItem(draftKey(linkId), JSON.stringify({ expiresAt, values: changed }));
    });
  }, [linkId, expiresAt, values]);

  return { clearDraft: () => forgetDraft(linkId) };
}
