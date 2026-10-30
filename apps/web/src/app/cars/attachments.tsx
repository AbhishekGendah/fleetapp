import { ActionButton } from "@fleetapp/ui/action-button";

import type { Attachment, AttachmentTarget } from "../../lib/files/attachments";
import { attachmentPath } from "../../lib/paths";
import { AttachButton } from "./attach-button";
import { removeAttachmentAction } from "./attachment-actions";

/** The attachments for one record, from all those loaded for the page. */
export function attachmentsOf(
  attachments: readonly Attachment[],
  target: AttachmentTarget,
): Attachment[] {
  return attachments.filter(
    (attachment) => attachment.target.kind === target.kind && attachment.target.id === target.id,
  );
}

/**
 * A record's attached papers, each opening through a short-lived link, with
 * Remove and an Attach button when the record can still be changed.
 */
export function Attachments(props: {
  target: AttachmentTarget;
  attachments: readonly Attachment[];
  isEditable: boolean;
  /** The page showing them, refreshed after a removal. */
  pagePath: string;
}) {
  const own = attachmentsOf(props.attachments, props.target);
  return (
    <div className="flex flex-col gap-1">
      {own.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {own.map((attachment) => (
            <li key={attachment.id} className="flex flex-wrap items-center gap-2 text-xs">
              <a
                href={attachmentPath(attachment.id)}
                target="_blank"
                rel="noopener"
                className="text-teal font-medium hover:underline"
              >
                📎 {attachment.label}
              </a>
              {props.isEditable ? (
                <ActionButton
                  action={removeAttachmentAction.bind(null, props.pagePath, attachment.id)}
                  label="Remove"
                  pendingLabel="Removing…"
                  variant="ghost"
                  size="sm"
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {props.isEditable ? <AttachButton target={props.target} /> : null}
    </div>
  );
}
