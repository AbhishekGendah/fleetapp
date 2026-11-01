"use client";

import { Menu } from "@base-ui/react/menu";
import { Node, mergeAttributes, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Braces,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Minus,
  Redo2,
  Underline,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";
import { fieldLabelId } from "./form-field";

/** A field the Operator can drop into the text, e.g. the Renter's name. */
export interface EditorMergeField {
  key: string;
  label: string;
  /** The menu heading it is listed under, e.g. "Renter". */
  groupLabel: string;
}

const MERGE_FIELD_NODE = "mergeField";
const HEADING_LEVELS = [1, 2, 3] as const;

/**
 * A merge field in the text: shown as a labelled chip the Operator cannot
 * type inside, saved as `{ type: "mergeField", attrs: { key } }`, and filled
 * in with the rental's details when the contract is made.
 */
function mergeFieldNode(labels: ReadonlyMap<string, string>) {
  return Node.create({
    name: MERGE_FIELD_NODE,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
      return { key: { default: null } };
    },
    parseHTML() {
      return [{ tag: "span[data-merge-field]" }];
    },
    renderHTML({ node, HTMLAttributes }) {
      const key = String(node.attrs.key);
      return [
        "span",
        mergeAttributes(HTMLAttributes, {
          "data-merge-field": key,
          class:
            "bg-primary-soft text-teal mx-0.5 rounded px-1.5 py-0.5 text-sm font-medium whitespace-nowrap",
        }),
        labels.get(key) ?? key,
      ];
    },
    renderText({ node }) {
      return `[${labels.get(String(node.attrs.key)) ?? String(node.attrs.key)}]`;
    },
  });
}

interface ToolbarButtonProps {
  label: string;
  icon: LucideIcon;
  isActive?: boolean;
  isDisabled?: boolean;
  onPress: () => void;
}

function ToolbarButton({ label, icon: Icon, isActive, isDisabled, onPress }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={isActive === undefined ? undefined : isActive}
      disabled={isDisabled}
      // Keeps the text selected, so the format applies to it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
      className={cn(
        "text-foreground hover:bg-muted focus-visible:ring-ring flex h-11 w-11 items-center justify-center rounded-md outline-none focus-visible:ring-2 disabled:opacity-40",
        isActive && "bg-primary-soft text-teal",
      )}
    >
      <Icon aria-hidden="true" className="h-5 w-5" />
    </button>
  );
}

function InsertFieldMenu({
  editor,
  fields,
}: {
  editor: Editor;
  fields: readonly EditorMergeField[];
}) {
  const groups = [...new Set(fields.map((field) => field.groupLabel))];
  return (
    <Menu.Root>
      <Menu.Trigger className="border-input hover:bg-muted focus-visible:ring-ring flex h-11 items-center gap-2 rounded-md border px-3 text-sm font-medium outline-none focus-visible:ring-2">
        <Braces aria-hidden="true" className="h-4 w-4" />
        Insert field
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="z-50 outline-none" sideOffset={4} align="start">
          <Menu.Popup className="bg-card max-h-[min(24rem,var(--available-height))] overflow-y-auto rounded-md border py-1 shadow-lg outline-none">
            {groups.map((group) => (
              <Menu.Group key={group}>
                <Menu.GroupLabel className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-semibold uppercase">
                  {group}
                </Menu.GroupLabel>
                {fields
                  .filter((field) => field.groupLabel === group)
                  .map((field) => (
                    <Menu.Item
                      key={field.key}
                      className="data-[highlighted]:bg-muted flex min-h-11 cursor-default items-center px-3 text-sm outline-none select-none"
                      onClick={() =>
                        editor
                          .chain()
                          .focus()
                          .insertContent({ type: MERGE_FIELD_NODE, attrs: { key: field.key } })
                          .run()
                      }
                    >
                      {field.label}
                    </Menu.Item>
                  ))}
              </Menu.Group>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Toolbar({ editor, fields }: { editor: Editor; fields: readonly EditorMergeField[] }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      isBold: current.isActive("bold"),
      isItalic: current.isActive("italic"),
      isUnderline: current.isActive("underline"),
      headingLevel: HEADING_LEVELS.find((level) => current.isActive("heading", { level })) ?? null,
      isBulletList: current.isActive("bulletList"),
      isOrderedList: current.isActive("orderedList"),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });
  const run =
    (command: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => () =>
      command(editor.chain().focus()).run();
  const headingIcons = { 1: Heading1, 2: Heading2, 3: Heading3 } as const;
  const headingNames = { 1: "Title", 2: "Section heading", 3: "Sub-heading" } as const;

  return (
    <div
      role="group"
      aria-label="Formatting"
      className="bg-muted/40 flex flex-wrap items-center gap-1 border-b p-1"
    >
      <ToolbarButton
        label="Bold"
        icon={Bold}
        isActive={state.isBold}
        onPress={run((c) => c.toggleBold())}
      />
      <ToolbarButton
        label="Italic"
        icon={Italic}
        isActive={state.isItalic}
        onPress={run((c) => c.toggleItalic())}
      />
      <ToolbarButton
        label="Underline"
        icon={Underline}
        isActive={state.isUnderline}
        onPress={run((c) => c.toggleUnderline())}
      />
      {HEADING_LEVELS.map((level) => (
        <ToolbarButton
          key={level}
          label={headingNames[level]}
          icon={headingIcons[level]}
          isActive={state.headingLevel === level}
          onPress={run((c) => c.toggleHeading({ level }))}
        />
      ))}
      <ToolbarButton
        label="Bulleted list"
        icon={List}
        isActive={state.isBulletList}
        onPress={run((c) => c.toggleBulletList())}
      />
      <ToolbarButton
        label="Numbered list"
        icon={ListOrdered}
        isActive={state.isOrderedList}
        onPress={run((c) => c.toggleOrderedList())}
      />
      <ToolbarButton
        label="Dividing line"
        icon={Minus}
        onPress={run((c) => c.setHorizontalRule())}
      />
      <ToolbarButton
        label="Undo"
        icon={Undo2}
        isDisabled={!state.canUndo}
        onPress={run((c) => c.undo())}
      />
      <ToolbarButton
        label="Redo"
        icon={Redo2}
        isDisabled={!state.canRedo}
        onPress={run((c) => c.redo())}
      />
      <InsertFieldMenu editor={editor} fields={fields} />
    </div>
  );
}

export interface ContractEditorProps {
  /** The text box's id: its FormField label names it, and a problem moves the cursor to it. */
  id: string;
  /** Sent with the form: the document as JSON text. */
  name: string;
  /** The document as the editor first shows it (TipTap's JSON). */
  initialContent: JSONContent;
  onValueChange: (json: string) => void;
  fields: readonly EditorMergeField[];
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

/**
 * The contract editor on TipTap (MIT core): headings, paragraphs, lists,
 * a dividing line, bold, italic and underline, and "Insert field" for the
 * rental's details. Nothing else (links, pictures, code) can be added, so
 * whatever is written prints as a plain, tidy document. The form gets the
 * document as JSON text in a hidden box.
 */
export function ContractEditor({
  id,
  name,
  initialContent,
  onValueChange,
  fields,
  ...aria
}: ContractEditorProps): React.JSX.Element {
  const labels = React.useMemo(
    () => new Map(fields.map((field) => [field.key, field.label])),
    [fields],
  );
  const [json, setJson] = React.useState(() => JSON.stringify(initialContent));
  const editor = useEditor({
    // Rendered in the browser only: Next renders pages on the server first.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        code: false,
        codeBlock: false,
        strike: false,
        link: false,
        heading: { levels: [...HEADING_LEVELS] },
      }),
      mergeFieldNode(labels),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        id,
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": fieldLabelId(id),
        ...(aria["aria-describedby"] ? { "aria-describedby": aria["aria-describedby"] } : {}),
        ...(aria["aria-invalid"] ? { "aria-invalid": "true" } : {}),
        class: cn(
          "min-h-80 px-4 py-3 text-base outline-none",
          "[&_h1]:text-primary [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-bold",
          "[&_h2]:text-primary [&_h2]:mt-4 [&_h2]:mb-1 [&_h2]:text-lg [&_h2]:font-bold",
          "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold",
          "[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6",
          "[&_hr]:my-4 [&_hr]:border-t",
        ),
      },
    },
    onUpdate: ({ editor: current }) => {
      const next = JSON.stringify(current.getJSON());
      setJson(next);
      onValueChange(next);
    },
  });

  return (
    <div
      className={cn(
        "border-input bg-card focus-within:ring-ring overflow-hidden rounded-md border shadow-sm focus-within:ring-2 focus-within:ring-offset-2",
        aria["aria-invalid"] && "border-destructive",
      )}
    >
      {editor ? <Toolbar editor={editor} fields={fields} /> : null}
      <EditorContent editor={editor} />
      <input type="hidden" name={name} value={json} />
    </div>
  );
}
