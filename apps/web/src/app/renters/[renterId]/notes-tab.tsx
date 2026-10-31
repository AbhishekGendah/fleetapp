import { formatDateTimeInTimeZone } from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { Trash2 } from "lucide-react";

import { appDb } from "../../../lib/app-db";
import type { SignedInUser } from "../../../lib/require-user";
import { listNotes } from "../../../lib/renters/notes";
import type { RenterDetail } from "../../../lib/renters/renter-queries";
import { addNoteAction, removeNoteAction } from "./note-actions";
import { NoteForm } from "./note-form";

/** Dated notes about the Renter, newest first. Never edited; one written by mistake can be removed. */
export async function NotesTab({ renter, user }: { renter: RenterDetail; user: SignedInUser }) {
  const notes = await listNotes(appDb, user.operatorId, renter.id);
  const isEditable = renter.archivedAt === null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
        <CardDescription>
          Private to your business, but the Renter can ask to see them. Write facts only.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {isEditable ? <NoteForm action={addNoteAction.bind(null, renter.id)} /> : null}
        {notes.length === 0 ? (
          <p className="text-muted-foreground text-sm">No notes yet.</p>
        ) : (
          <RecordList label="Notes">
            {notes.map((note) => (
              <RecordItem
                key={note.id}
                title={formatDateTimeInTimeZone(note.writtenAt, user.operatorTimezone)}
                details={<p>By {note.writtenBy}</p>}
                actions={
                  isEditable ? (
                    <ActionButton
                      action={removeNoteAction.bind(null, renter.id, note.id)}
                      label="Remove note"
                      pendingLabel="Removing…"
                      variant="danger"
                      icon={<Trash2 aria-hidden />}
                    />
                  ) : undefined
                }
              >
                <p className="text-sm break-words whitespace-pre-wrap">{note.body}</p>
              </RecordItem>
            ))}
          </RecordList>
        )}
      </CardContent>
    </Card>
  );
}
