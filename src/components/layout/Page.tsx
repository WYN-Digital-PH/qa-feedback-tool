import { cn } from "@/lib/utils";

/**
 * Page shell primitives. Dashboard pages compose `Page` + `PageHeader` so
 * padding, max width, title size and header spacing stay identical everywhere.
 */

type Width = "default" | "narrow";

const WIDTH: Record<Width, string> = {
  default: "max-w-7xl",
  narrow: "max-w-3xl",
};

interface PageProps {
  children: React.ReactNode;
  /** "narrow" for single-column settings-style pages. */
  width?: Width;
  className?: string;
}

export function Page({ children, width = "default", className }: PageProps) {
  return <div className={cn("p-8", WIDTH[width], className)}>{children}</div>;
}

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Rendered above the title, e.g. a back link or parent record name. */
  eyebrow?: React.ReactNode;
  /** Primary action(s) for the page, right-aligned. */
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("mb-6", className)}>
      {eyebrow}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

interface SectionHeadingProps {
  children: React.ReactNode;
  className?: string;
}

/** Heading for a section inside a page (a card header, a list group). */
export function SectionHeading({ children, className }: SectionHeadingProps) {
  return <h2 className={cn("font-semibold", className)}>{children}</h2>;
}
