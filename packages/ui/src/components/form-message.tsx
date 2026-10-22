export function FormError({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <p className="text-destructive text-sm" role="alert">
      {message}
    </p>
  );
}
