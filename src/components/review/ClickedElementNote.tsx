/**
 * The text of the element a pin was dropped on, quoted back in the composer.
 *
 * Shared so the internal "Add pin" dialog and the guest "Leave feedback" dialog
 * carry the same context — an internal note used to lose it, which made team
 * pins thinner than the client ones sitting beside them.
 */
export function ClickedElementNote({ text }: { text?: string | null }) {
  const quoted = text?.trim();
  if (!quoted) return null;
  return (
    <div className="text-xs bg-secondary/50 p-2 rounded">
      <div className="text-muted-foreground mb-1">You clicked on:</div>
      <div className="line-clamp-2">"{quoted}"</div>
    </div>
  );
}

export default ClickedElementNote;
