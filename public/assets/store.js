import { api } from './api.js';

const listeners = new Set();

export const state = {
  user: null,
  site: null,
  unread: 0,
  ready: false
};

export function setState(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function loadSession() {
  try {
    const data = await api.get('/api/auth/me');
    setState({ user: data.user, unread: data.unreadCount || 0, ready: true });
  } catch {
    setState({ user: null, unread: 0, ready: true });
  }
}

export async function loadSite() {
  try {
    const data = await api.get('/api/site');
    setState({ site: data });
  } catch {
    /* 站点信息不可用时静默降级 */
  }
}

export async function refreshUnread() {
  if (!state.user) return setState({ unread: 0 });
  try {
    const data = await api.get('/api/notifications/unread-count');
    setState({ unread: data.count || 0 });
  } catch {
    /* ignore */
  }
}

export function isStaff(user = state.user) {
  return !!user && (user.role === 'admin' || user.role === 'moderator');
}

export function isAdmin(user = state.user) {
  return !!user && user.role === 'admin';
}