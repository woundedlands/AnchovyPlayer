import { create } from "zustand";

/** Which part of the window the arrow keys drive. */
export type Zone = "browser" | "player";

export interface ContextMenuRequest {
  x: number;
  y: number;
  /** Row under the cursor, or null for the empty space of the folder. */
  index: number | null;
}

export interface Notice {
  text: string;
  error: boolean;
  id: number;
}

const noticeMs = 3500;
const errorNoticeMs = 6000;

interface UiState {
  zone: Zone;
  menu: ContextMenuRequest | null;
  /** `pathKey` of the row being renamed in place. */
  renaming: string | null;
  notice: Notice | null;
  setZone: (zone: Zone) => void;
  openMenu: (menu: ContextMenuRequest) => void;
  closeMenu: () => void;
  setRenaming: (key: string | null) => void;
  notify: (text: string, error?: boolean) => void;
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let noticeId = 0;

export const useUi = create<UiState>()((set, get) => ({
  zone: "browser",
  menu: null,
  renaming: null,
  notice: null,
  setZone: (zone) => set({ zone }),
  openMenu: (menu) => set({ menu }),
  closeMenu: () => set({ menu: null }),
  setRenaming: (renaming) => set({ renaming }),
  notify: (text, error = false) => {
    const id = ++noticeId;
    set({ notice: { text, error, id } });
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      if (get().notice?.id === id) {
        set({ notice: null });
      }
    }, error ? errorNoticeMs : noticeMs);
  },
}));

/** The search field, so keyboard shortcuts can focus and blur it. */
export const searchInput: { current: HTMLInputElement | null } = { current: null };
