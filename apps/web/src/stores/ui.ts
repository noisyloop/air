import { create } from 'zustand';

type Theme = 'dark' | 'light';

interface UiState {
  theme: Theme;
  sidebarOpen: boolean;
  fullscreenPlayer: boolean;
  toast: string | null;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setSidebarOpen: (open: boolean) => void;
  setFullscreenPlayer: (open: boolean) => void;
  showToast: (message: string) => void;
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('air.theme', theme);
}

const initialTheme: Theme = (localStorage.getItem('air.theme') as Theme | null) ?? 'dark';
applyTheme(initialTheme);

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useUi = create<UiState>((set, get) => ({
  theme: initialTheme,
  sidebarOpen: false,
  fullscreenPlayer: false,
  toast: null,
  setTheme(theme) {
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme() {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
  },
  setSidebarOpen(sidebarOpen) {
    set({ sidebarOpen });
  },
  setFullscreenPlayer(fullscreenPlayer) {
    set({ fullscreenPlayer });
  },
  showToast(message) {
    clearTimeout(toastTimer);
    set({ toast: message });
    toastTimer = setTimeout(() => set({ toast: null }), 2500);
  },
}));
