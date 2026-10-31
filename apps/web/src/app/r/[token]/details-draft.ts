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

/** The draft's boxes that differ from the form as it opened, or nothing if it is gone or past the link's end. */
function readDraft(
  storage: Storage,
  linkId: string,
  openedWith: Readonly<Record<DetailsFormField, string>>,
): Partial<Record<DetailsFormField, string>> {
  const parsed = draftSchema.safeParse(JSON.parse(storage.getItem(draftKey(linkId)) ?? "null"));
  if (!parsed.success) {
    return {};
  }
  if (new Date(parsed.data.expiresAt).getTime() < Date.now()) {
    storage.removeItem(draftKey(linkId));
    return {};
  }
  const kept = parsed.data.values;
  return Object.fromEntries(
    DETAILS_FORM_FIELDS.flatMap((field) => {
      const value = kept[field];
      return value !== undefined && value !== openedWith[field] ? [[field, value]] : [];
    }),
  );
}

/**
 * Keeps what the Renter types on their own phone until they send it, so
 * lost signal or a closed page loses nothing (rule 25's spirit). It is
 * dropped once sent, and ignored after the link ends.
 */
export function useDetailsDraft(
  form: FormFields<DetailsFormField>,
  linkId: string,
  expiresAt: string,
): { clearDraft: () => void } {
  const isRestored = useRef(false);
  const { fillIn, values } = form;

  useEffect(() => {
    withStorage((storage) => {
      const kept = readDraft(storage, linkId, values);
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
    withStorage((storage) =>
      storage.setItem(draftKey(linkId), JSON.stringify({ expiresAt, values })),
    );
  }, [linkId, expiresAt, values]);

  return {
    clearDraft: () => withStorage((storage) => storage.removeItem(draftKey(linkId))),
  };
}
