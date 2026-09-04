import { brand, brandByline, brandLogoAlt } from "@/config/brand";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

const LOGO_SIZE: Record<Size, string> = {
  sm: "w-8 h-8",
  md: "w-9 h-9",
  lg: "w-10 h-10",
};

const NAME_SIZE: Record<Size, string> = {
  sm: "text-sm",
  md: "text-sm",
  lg: "text-base",
};

interface BrandMarkProps {
  size?: Size;
  /** Hide the wordmark and show the logo only (collapsed sidebar). */
  logoOnly?: boolean;
  /** Use light text — for placing the mark on a dark surface such as the sidebar. */
  onDark?: boolean;
  className?: string;
}

/**
 * The product logo plus wordmark. Every surface that identifies the product —
 * sidebar, landing header, sign-in and sign-up — renders this, so a rebrand is
 * a change to `src/config/brand.ts` rather than an edit in four files.
 */
export default function BrandMark({ size = "md", logoOnly = false, onDark = false, className }: BrandMarkProps) {
  return (
    <div className={cn("flex items-center", logoOnly ? "justify-center" : "gap-2.5", className)}>
      <img
        src={brand.logoSrc}
        alt={brandLogoAlt}
        className={cn(LOGO_SIZE[size], "rounded-lg object-cover shrink-0")}
      />
      {!logoOnly && (
        <div className="min-w-0">
          <div className={cn("font-semibold tracking-tight truncate", NAME_SIZE[size])}>{brand.productName}</div>
          <div className={cn("text-xs truncate", onDark ? "text-sidebar-foreground/70" : "text-muted-foreground")}>
            {brandByline}
          </div>
        </div>
      )}
    </div>
  );
}
