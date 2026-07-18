import { create } from 'zustand';
import { api, bootstrapSession, setAccessToken, setSessionExpiredHandler } from '../lib/api';
import type { User } from '../lib/types';

interface AuthState {
  user: User | null;
  ready: boolean; // initial bootstrap finished
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  hasPermission: (perm: string) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  ready: false,

  async bootstrap() {
    setSessionExpiredHandler(() => set({ user: null }));
    const session = await bootstrapSession();
    if (session) {
      try {
        const user = await api<User>('/me');
        set({ user, ready: true });
        return;
      } catch {
        /* fall through */
      }
    }
    set({ ready: true });
  },

  async login(email, password) {
    const res = await api<{ accessToken: string; user: User }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setAccessToken(res.accessToken);
    set({ user: res.user });
  },

  async register(email, password, displayName) {
    const res = await api<{ accessToken: string; user: User }>('/auth/register', {
      method: 'POST',
      body: { email, password, displayName },
    });
    setAccessToken(res.accessToken);
    set({ user: res.user });
  },

  async logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAccessToken(null);
    set({ user: null });
  },

  hasPermission(perm) {
    return get().user?.permissions.includes(perm) ?? false;
  },
}));
