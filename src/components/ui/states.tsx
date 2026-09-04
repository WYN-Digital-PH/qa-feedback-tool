import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared empty / loading / error states, so every list, page and panel uses the
 * same icon size, copy placement and spacing.
 */

interface EmptyStateProps {
  icon?: LucideIcon;
  /** Short sentence explaining what's missing and what to do about it. */
  message: React.ReactNode;
  /** Optional call to action, e.g. a "New project" button. */
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, message, action, className }: EmptyStateProps) {
  return (
    <div className={cn("surface-card p-12 text-center", className)}>
      {Icon && <Icon className="w-10 h-10 mx-auto text-muted-foreground mb-3" />}
      <p className="text-sm text-muted-foreground">{message}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Empty state for a panel that already has its own frame (sidebar, card body). */
export function InlineEmptyState({ message, className }: { message: React.ReactNode; className?: string }) {
  return <div className={cn("p-8 text-center text-sm text-muted-foreground", className)}>{message}</div>;
}

interface LoadingStateProps {
  label?: string;
  /** Centre in the viewport — for a route that hasn't loaded yet. */
  fullScreen?: boolean;
  className?: string;
}

export function LoadingState({ label = "Loading…", fullScreen = false, className }: LoadingStateProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center text-sm text-muted-foreground",
        fullScreen ? "min-h-screen" : "p-8",
        className,
      )}
    >
      <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

interface ErrorStateProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Optional recovery link or button. */
  action?: React.ReactNode;
  className?: string;
}

/** Full-page error card, used when a canvas or review link can't be opened. */
export function ErrorState({ title, description, action, className }: ErrorStateProps) {
  return (
    <div className={cn("min-h-screen flex items-center justify-center px-4", className)}>
      <div className="surface-elevated p-8 max-w-md w-full text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-2">{description}</p>}
        {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
      </div>
    </div>
  );
}
