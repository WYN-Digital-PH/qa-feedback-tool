import { useCallback, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface ConfirmOptions {
  title: React.ReactNode;
  /** Say plainly what happens, including anything that cascades. */
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * When set, this has to be typed before the button enables. Reserve it for
   * actions that take other records with them — an agency, a project — where a
   * mis-aimed click costs a client's whole review history.
   */
  confirmPhrase?: string;
  /** Red confirm button. On by default: this dialog exists for destructive work. */
  destructive?: boolean;
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
}

/**
 * The one confirmation dialog in the app, so every irreversible action asks
 * the same way and guards by the same amount. Use `useConfirm()` for one-off
 * imperative checks; render this directly when the target is already state.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmPhrase,
  destructive = true,
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const [working, setWorking] = useState(false);

  const locked = !!confirmPhrase && typed.trim() !== confirmPhrase;

  function handleOpenChange(next: boolean) {
    if (!next) setTyped("");
    onOpenChange(next);
  }

  async function confirm(e: React.MouseEvent) {
    // Radix closes on action click; hold it open until the write settles so a
    // failure surfaces against the dialog that caused it.
    e.preventDefault();
    if (locked || working) return;
    setWorking(true);
    try {
      await onConfirm();
      handleOpenChange(false);
    } finally {
      setWorking(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {confirmPhrase && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-phrase" className="font-normal">
              Type <span className="font-medium text-foreground">{confirmPhrase}</span> to confirm
            </Label>
            <Input id="confirm-phrase" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            disabled={locked || working}
            className={cn(destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
          >
            {working ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Promise-based confirmation, as a drop-in for `window.confirm`:
 *
 * ```tsx
 * const { confirm, confirmDialog } = useConfirm();
 * if (!(await confirm({ title: "Delete this?", description: "…" }))) return;
 * // …and render {confirmDialog} once, anywhere in the component.
 * ```
 *
 * The native dialog blocks the whole tab, cannot be styled or branded, and on
 * some platforms is suppressed entirely — which silently turns "are you sure?"
 * into "yes".
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmOptions) => {
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  }, []);

  const confirmDialog = options ? (
    <ConfirmDialog
      {...options}
      open
      // Covers Escape, the overlay and Cancel — all of them mean "no".
      onOpenChange={(next) => { if (!next) settle(false); }}
      onConfirm={() => settle(true)}
    />
  ) : null;

  return { confirm, confirmDialog };
}
