import { create } from 'zustand';
import type { UserDto } from '@mm/shared-types';

/**
 * Session state, held in memory ONLY.
 *
 * design.md §7: the access token lives for 15 minutes and never touches
 * localStorage or sessionStorage — anything written there is readable by any
 * script that gets injected into the page. Refresh survives a reload through
 * the httpOnly cookie, which JavaScript cannot read at all.
 */
interface AuthState {
  accessToken: string | null;
  user: UserDto | null;
  /** True until the initial silent refresh settles, so the guard can wait. */
  bootstrapping: boolean;
  setSession: (accessToken: string, user: UserDto) => void;
  clear: () => void;
  finishBootstrap: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  bootstrapping: true,
  setSession: (accessToken, user) => set({ accessToken, user, bootstrapping: false }),
  clear: () => set({ accessToken: null, user: null, bootstrapping: false }),
  finishBootstrap: () => set({ bootstrapping: false }),
}));

/** Non-reactive read, for the API client which lives outside React. */
export const authSnapshot = () => useAuthStore.getState();
