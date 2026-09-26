/**
 * The visualizer: the music's pulse, 0..1, from the engine's level. Elements attach to get it as a
 * CSS variable written outside React (the playing row: CSS animates only transform and opacity, so
 * nothing re-renders); a canvas that redraws anyway subscribes instead (the waveform). Each
 * consumer attaches or subscribes only while its own setting is on.
 */

/** Loudness range mapped to 0..1, in dBFS RMS: quiet passages sit near 0, mastered music near 1. */
const floorDb = -40;
const ceilingDb = -6;
/** How fast the "usual loudness" follows the music; the pulse is loudness above it, i.e. the beats. */
const averageSeconds = 1.2;
const decaySeconds = 0.18;
/** Absolute loudness keeps quiet-but-steady music alive; the rest is the beat above the average. */
const loudnessShare = 0.4;
const beatGain = 3;
const maxStepSeconds = 0.1;

const targets = new Set<HTMLElement>();
const listeners = new Set<() => void>();
let average = 0;
let envelope = 0;
/** What the targets show: the envelope rounded, so near-equal values do not restyle them. */
let shown = 0;
let lastAt = 0;

/** Makes `element` follow the pulse through its `--pulse` variable (0..1); returns the detach. */
export function attachPulse(element: HTMLElement): () => void {
  targets.add(element);
  element.style.setProperty("--pulse", String(shown));

  return () => {
    element.style.removeProperty("--pulse");
    targets.delete(element);
  };
}

/** For `useSyncExternalStore`: `listener` runs whenever the shown pulse changes. */
export function subscribePulse(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export const currentPulse = () => shown;

/** `level` is the engine's RMS since the previous status, while playing. */
export function feedPulse(level: number) {
  const now = performance.now();
  const dt = Math.min((now - lastAt) / 1000, maxStepSeconds);
  lastAt = now;
  const db = 20 * Math.log10(Math.max(level, 1e-5));
  const loudness = Math.min(Math.max((db - floorDb) / (ceilingDb - floorDb), 0), 1);
  average += (loudness - average) * (1 - Math.exp(-dt / averageSeconds));
  const beat = Math.min(Math.max((loudness - average) * beatGain, 0), 1);
  const target = loudnessShare * loudness + (1 - loudnessShare) * beat;
  // Instant attack, smooth release: hits land on time, the tail does not flicker.
  envelope = Math.max(target, envelope * Math.exp(-dt / decaySeconds));
  show(Math.round(envelope * 100) / 100);
}

/**
 * Paused or stopped. Statuses become rare then, so the release cannot ride on them:
 * the row drops to rest at once and its CSS transition fades it.
 */
export function stopPulse() {
  envelope = 0;
  average = 0;
  show(0);
}

function show(value: number) {
  if (value !== shown) {
    shown = value;
    writePulse();
    listeners.forEach((listener) => listener());
  }
}

function writePulse() {
  for (const target of targets) {
    target.style.setProperty("--pulse", String(shown));
  }
}
