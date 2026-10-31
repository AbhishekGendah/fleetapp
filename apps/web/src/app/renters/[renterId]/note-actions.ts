"use server";

import { formTextValues, isRecordId } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { appDb } from "../../../lib/app-db";
import { renterPath } from "../../../lib/paths";
import { NOTE_FIELDS, noteInputSchema } from "../../../lib/renters/note-input";
import { addNote, removeNote } from "../../../lib/renters/notes";
import { runUserChange } from "../../../lib/run-change";
import { RENTER_NOT_FOUND_MESSAGE } from "../renter-form-state";

export async function addNoteAction(
  renterId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = noteInputSchema.safeParse(formTextValues(formData, NOTE_FIELDS));
  if (!isRecordId(renterId)) {
    return failedState(RENTER_NOT_FOUND_MESSAGE);
  }
  if (!parsed.success) {
    return failedState("Write the note first.");
  }
  return runUserChange({
    description: "Adding a Renter note",
    pagesToRefresh: [renterPath(renterId)],
    change: async (actor) =>
      (await addNote(appDb, actor, renterId, parsed.data.body)) === "added"
        ? savedState("Note added.")
        : failedState(RENTER_NOT_FOUND_MESSAGE),
  });
}

export async function removeNoteAction(
  renterId: string,
  noteId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(renterId) || !isRecordId(noteId)) {
    return failedState(RENTER_NOT_FOUND_MESSAGE);
  }
  return runUserChange({
    description: "Removing a Renter note",
    pagesToRefresh: [renterPath(renterId)],
    change: async (actor) =>
      (await removeNote(appDb, actor, renterId, noteId)) === "removed"
        ? savedState("Note removed.")
        : failedState("That note was already removed."),
  });
}
