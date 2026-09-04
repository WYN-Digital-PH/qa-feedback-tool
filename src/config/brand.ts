/**
 * Brand configuration — the single place to rebrand this app.
 *
 * Everything user-visible that identifies the agency (name, logo, wording,
 * links) is read from here. Nothing else in `src/` should hardcode a brand
 * name or import the logo asset directly.
 *
 * To rebrand for another agency:
 *   1. Replace `src/assets/logo.jpg` (or set VITE_BRAND_LOGO_URL to a hosted file).
 *   2. Set the VITE_BRAND_* variables in `.env` — see `.env.example`.
 *   3. Change the brand colour tokens in `src/index.css` (the BRAND block at the top).
 *
 * Colours, fonts and radii deliberately live in CSS custom properties rather
 * than here, so they can be themed per-deployment without a rebuild and stay
 * available to Tailwind utilities. See `src/index.css`.
 */
import defaultLogo from "@/assets/logo.jpg";

const env = import.meta.env;

/** Reads a VITE_BRAND_* override, falling back when unset or blank. */
function fromEnv(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export const brand = {
  /** Product name, e.g. shown in the sidebar and on auth screens. */
  productName: fromEnv(env.VITE_BRAND_PRODUCT_NAME, "WYN Review"),
  /** The agency operating the tool. */
  companyName: fromEnv(env.VITE_BRAND_COMPANY_NAME, "WYN Digital"),
  /** One-line product description, used for meta tags and the landing page. */
  description: fromEnv(
    env.VITE_BRAND_DESCRIPTION,
    "A no-login website feedback and approval tool for agency clients.",
  ),
  /** Logo shown in the sidebar, on auth screens and in the landing header. */
  logoSrc: fromEnv(env.VITE_BRAND_LOGO_URL, defaultLogo),
  /** Where the "powered by" / footer link points, if any. */
  websiteUrl: fromEnv(env.VITE_BRAND_WEBSITE_URL, ""),
} as const;

/** "by <Agency>" — the byline that sits under the product name. */
export const brandByline = `by ${brand.companyName}`;

/** Accessible name for the logo image. */
export const brandLogoAlt = `${brand.productName} logo`;

/** Document title for a page, e.g. "Projects · WYN Review". */
export function pageTitle(section?: string): string {
  return section ? `${section} · ${brand.productName}` : brand.productName;
}
