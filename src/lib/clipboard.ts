/**
 * Copy text to the clipboard, reporting success instead of throwing.
 *
 * `navigator.clipboard` only exists in a secure context (HTTPS or localhost).
 * The dev server binds to every interface, so reaching the app on a LAN address
 * leaves it undefined — and `navigator.clipboard.writeText(…)` then throws
 * synchronously, before there is a promise to attach `.catch()` to. Callers get
 * a boolean so they can offer the link another way when copying isn't possible.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or the document isn't focused — try the fallback.
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
