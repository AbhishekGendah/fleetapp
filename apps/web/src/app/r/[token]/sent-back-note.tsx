/** What the Operator asked the Renter to change, in their words, above the form. */
export function SentBackNote(props: { operatorName: string; note: string }) {
  return (
    <section
      aria-label="What to change"
      className="border-attention/40 bg-attention-soft flex flex-col gap-2 rounded-lg border p-3 text-sm"
    >
      <p className="font-semibold">{props.operatorName} asked you to change something:</p>
      <p className="whitespace-pre-line">{props.note}</p>
      <p className="text-muted-foreground">
        Your details are filled in as you sent them. Make the change, then send again.
      </p>
    </section>
  );
}
