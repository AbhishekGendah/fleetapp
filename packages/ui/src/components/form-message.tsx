export function FormError({ id, message }: { id?: string; message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <p id={id} className="text-destructive text-sm" role="alert">
      {message}
    </p>
  );
}
