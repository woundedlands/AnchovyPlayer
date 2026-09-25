import { create } from "zustand";

/** Which part of the window the arrow keys drive. */
export type Zone = "browser" | "player";

interface UiState {
  zone: Zone;
  setZone: (zone: Zone) => void;
}

export const useUi = create<UiState>()((set) => ({
  zone: "browser",
  setZone: (zone) => set({ zone }),
}));

/** The search field, so keyboard shortcuts can focus and blur it. */
export const searchInput: { current: HTMLInputElement | null } = { current: null };
