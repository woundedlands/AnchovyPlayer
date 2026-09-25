import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

/**
 * What the app remembers between runs, in session.json (preferences are in settings.json).
 * The last folder has to be a path to be reopened; resume positions are keyed by a content
 * fingerprint only, so no file names or paths of what was listened to are kept.
 */
interface ResumePoint {
  seconds: number;
  /** Track length, so a later, higher resume threshold still applies to positions saved earlier. */
  duration: number;
  /** Epoch ms of the last play; the oldest go first when the list is pruned. */
  usedAt: number;
}

interface SessionState {
  lastFolder: string | null;
  lastFocus: string | null;
  positions: Record<string, ResumePoint>;
}

/** Bump when a key changes meaning; an older file is then read as empty. */
const sessionVersion = 1;
const saveDelayMs = 1000;
const maxPositions = 1000;
const maxPositionAgeMs = 180 * 24 * 60 * 60 * 1000;

export const useSession = create<SessionState>()(() => ({
  lastFolder: null,
  lastFocus: null,
  positions: {},
}));

export async function loadSession(): Promise<void> {
  try {
    const raw = await invoke<string | null>("load_session");
    if (raw !== null) {
      useSession.setState(parseSession(JSON.parse(raw)));
    }
  } catch (error) {
    // A broken file only loses the remembered folder and positions; it is rewritten on the next change.
    console.error(`session.json ignored: ${error}`);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  useSession.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void saveSession(), saveDelayMs);
  });
}

export function rememberFolder(folder: string | null, focus: string | null) {
  useSession.setState({ lastFolder: folder, lastFocus: focus });
}

export function positionFor(key: string, minDuration: number): number | null {
  const point = useSession.getState().positions[key];

  return point && point.duration >= minDuration ? point.seconds : null;
}

export function rememberPosition(key: string, seconds: number, duration: number) {
  const positions = { ...useSession.getState().positions, [key]: { seconds, duration, usedAt: Date.now() } };
  useSession.setState({ positions });
}

export function forgetPosition(key: string) {
  const { [key]: _removed, ...positions } = useSession.getState().positions;
  useSession.setState({ positions });
}

export function forgetAllPositions() {
  useSession.setState({ positions: {} });
}

export function hasPositions(): boolean {
  return Object.keys(useSession.getState().positions).length > 0;
}

async function saveSession(): Promise<void> {
  const { lastFolder, lastFocus, positions } = useSession.getState();
  const file = { version: sessionVersion, lastFolder, lastFocus, positions: prune(positions) };
  try {
    await invoke("save_session", { contents: JSON.stringify(file) });
  } catch (error) {
    console.error(`Saving session failed: ${error}`);
  }
}

function parseSession(raw: unknown): SessionState {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  if (source.version !== sessionVersion) {
    return { lastFolder: null, lastFocus: null, positions: {} };
  }
  const positions: Record<string, ResumePoint> = {};
  if (typeof source.positions === "object" && source.positions !== null) {
    for (const [key, value] of Object.entries(source.positions as Record<string, unknown>)) {
      const point = value as Partial<ResumePoint> | null;
      if (
        typeof point?.seconds === "number" &&
        point.seconds > 0 &&
        typeof point.duration === "number" &&
        typeof point.usedAt === "number"
      ) {
        positions[key] = { seconds: point.seconds, duration: point.duration, usedAt: point.usedAt };
      }
    }
  }

  return {
    lastFolder: typeof source.lastFolder === "string" ? source.lastFolder : null,
    lastFocus: typeof source.lastFocus === "string" ? source.lastFocus : null,
    positions: prune(positions),
  };
}

/** Drops positions unused for 180 days, then keeps the 1000 most recently played. */
function prune(positions: Record<string, ResumePoint>): Record<string, ResumePoint> {
  const cutoff = Date.now() - maxPositionAgeMs;
  const kept = Object.entries(positions)
    .filter(([, point]) => point.usedAt >= cutoff)
    .sort((a, b) => b[1].usedAt - a[1].usedAt)
    .slice(0, maxPositions);

  return Object.fromEntries(kept);
}

// Holds a session-wide subscription: edits reload the page instead of hot-swapping (see dev.md).
import.meta.hot?.accept(() => window.location.reload());
