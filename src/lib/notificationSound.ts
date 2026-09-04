/**
 * The notification chime.
 *
 * Synthesised with WebAudio rather than shipped as an audio file: it keeps the
 * bundle free of a binary asset, needs no network request (artifacts and the
 * proxied review page both run under a strict CSP), and rebrands with nothing,
 * which is the point — it should sound like a notification, not like a product.
 *
 * Browsers refuse to start an AudioContext until the page has had a real user
 * gesture, so every path here fails quietly. A silent notification is a much
 * smaller problem than an exception thrown from a realtime handler.
 */

const STORAGE_KEY = "phlash_notification_sound";

/** Two notes a fifth apart — short, quiet, and unlike a system alert. */
const NOTES = [
  { frequency: 880, at: 0, duration: 0.18 },
  { frequency: 1318.5, at: 0.12, duration: 0.26 },
];

const PEAK_GAIN = 0.12;

let context: AudioContext | null = null;

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    // Private mode, or site data blocked. Default to audible.
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Preference simply won't persist; the current session still honours it.
  }
}

function audioContext(): AudioContext | null {
  if (context) return context;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
    return context;
  } catch {
    return null;
  }
}

/** Play the chime, unless the user has muted it. Never throws. */
export async function playNotificationChime(): Promise<void> {
  if (!soundEnabled()) return;

  const ctx = audioContext();
  if (!ctx) return;

  try {
    // Suspended until the page has seen a gesture. Resuming may reject.
    if (ctx.state === "suspended") await ctx.resume();
    if (ctx.state !== "running") return;

    const start = ctx.currentTime;
    for (const note of NOTES) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = note.frequency;

      // A quick attack and an exponential tail, so it reads as a chime rather
      // than a beep. Ramping to zero is invalid, hence the small floor.
      const from = start + note.at;
      gain.gain.setValueAtTime(0.0001, from);
      gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, from + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, from + note.duration);

      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(from);
      oscillator.stop(from + note.duration + 0.02);
    }
  } catch {
    // Autoplay policy, a closed context, an unsupported node — all silent.
  }
}
