import { ConfirmDialog } from "@/components/ConfirmDialog";

interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description: React.ReactNode;
  confirmPhrase?: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
}

/**
 * A delete confirmation. Thin wrapper over `ConfirmDialog` so the destructive
 * default and the "Delete" wording live in one place.
 */
export function ConfirmDeleteDialog({ confirmLabel = "Delete", ...rest }: ConfirmDeleteDialogProps) {
  return <ConfirmDialog {...rest} confirmLabel={confirmLabel} destructive />;
}
