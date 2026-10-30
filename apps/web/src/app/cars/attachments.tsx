import { ActionButton } from "@fleetapp/ui/action-button";
import { ImageViewer } from "@fleetapp/ui/image-viewer";
import { Trash2 } from "lucide-react";

import type { Attachment, AttachmentTarget } from "../../lib/files/attachments";
import { attachmentPath } from "../../lib/paths";
import { AttachButton } from "./attach-button";
import { removeAttachmentAction } from "./attachment-actions";
import { FileLink, isPdf } from "./file-link";

/** The attachments for one record, from all those loaded for the page. */
export function attachmentsOf(
  attachments: readonly Attachment[],
  target: AttachmentTarget,
): Attachment[] {
  return attachments.filter(
    (attachment) => attachment.target.kind === target.kind && attachment.target.id === target.id,
  );
}

function RemoveAttachment(props: { pagePath: string; attachment: Attachment }) {
  return (
    <ActionButton
      action={removeAttachmentAction.bind(null, props.pagePath, props.attachment.id)}
      label={`Remove ${props.attachment.label}`}
      pendingLabel="Removing…"
      variant="danger"
      icon={<Trash2 aria-hidden />}
      isIconOnly
    />
  );
}

/**
 * A record's attached papers. Photos open full screen inside the app; PDFs
 * open in the phone's own viewer. Each goes through a short-lived link.
 * Remove and Attach show while the record can still be changed.
 */
export function Attachments(props: {
  target: AttachmentTarget;
  attachments: readonly Attachment[];
  isEditable: boolean;
  /** The page showing them, refreshed after a removal. */
  pagePath: string;
}) {
  const own = attachmentsOf(props.attachments, props.target);
  const images = own.filter((attachment) => !isPdf(attachment.contentType));
  return (
    <div className="flex flex-col gap-2">
      {own.length === 0 ? null : (
        <ImageViewer
          images={images.map((image) => ({ src: attachmentPath(image.id), label: image.label }))}
        >
          <ul className="flex flex-col gap-2">
            {own.map((attachment) => (
              <li key={attachment.id} className="flex items-center gap-2">
                <FileLink
                  href={attachmentPath(attachment.id)}
                  label={attachment.label}
                  contentType={attachment.contentType}
                  imageIndex={images.indexOf(attachment)}
                />
                {props.isEditable ? (
                  <RemoveAttachment pagePath={props.pagePath} attachment={attachment} />
                ) : null}
              </li>
            ))}
          </ul>
        </ImageViewer>
      )}
      {props.isEditable ? <AttachButton target={props.target} /> : null}
    </div>
  );
}
