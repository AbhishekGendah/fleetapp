import {
  CONTRACT_TEMPLATE_KINDS,
  REQUIRED_MESSAGE,
  requiredLine,
  templateDocumentSchema,
  type TemplateDocument,
} from "@fleetapp/core";
import { z } from "zod";

const UNREADABLE_CONTENT_MESSAGE =
  "The contract text could not be read. Reload the page and try again.";

/** The editor sends its document as JSON text in a hidden box. */
const templateContent = z.string().transform((json, context): TemplateDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    context.addIssue({ code: "custom", message: UNREADABLE_CONTENT_MESSAGE });
    return z.NEVER;
  }
  const result = templateDocumentSchema.safeParse(parsed);
  if (!result.success) {
    context.addIssue({
      code: "custom",
      message: result.error.issues[0]?.message ?? UNREADABLE_CONTENT_MESSAGE,
    });
    return z.NEVER;
  }
  return result.data;
});

/** A new template: what kind, and what to call it. It starts from the starter layout. */
export const newTemplateInputSchema = z.object({
  kind: z.enum(CONTRACT_TEMPLATE_KINDS, REQUIRED_MESSAGE),
  name: requiredLine,
});
export type NewTemplateInput = z.infer<typeof newTemplateInputSchema>;
export const NEW_TEMPLATE_FIELDS = ["kind", "name"] as const;

/** Saving the editor: the name and the text. */
export const templateEditInputSchema = z.object({
  name: requiredLine,
  content: templateContent,
});
export type TemplateEditInput = z.infer<typeof templateEditInputSchema>;
export const TEMPLATE_EDIT_FIELDS = ["name", "content"] as const;
