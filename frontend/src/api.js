// Shared helpers for talking to the backend.

export const API_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

const PRIMARY_SESSION_KEY = "sahayta_session";
const LEGACY_SESSION_KEY = "jagrutiSession";

// The logged-in user and their token, saved so a page refresh keeps you logged in.
export function loadSession() {
  try {
    let saved = localStorage.getItem(PRIMARY_SESSION_KEY);
    if (!saved) {
      saved = localStorage.getItem(LEGACY_SESSION_KEY);
      if (saved) {
        // Quietly migrate to sahayta_session
        localStorage.setItem(PRIMARY_SESSION_KEY, saved);
        localStorage.removeItem(LEGACY_SESSION_KEY);
      }
    }
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try {
    localStorage.setItem(PRIMARY_SESSION_KEY, JSON.stringify(session));
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch (err) {
    console.warn('Failed to save session:', err);
  }
}

export function clearSession() {
  localStorage.removeItem(PRIMARY_SESSION_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
}

export function getToken() {
  return loadSession()?.token || null;
}

// fetch() that adds the JSON header and the login token.
// Throws an Error with the backend's message if the request fails.
export async function apiFetch(path, options = {}) {
  const token = getToken();

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || data.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

// Two-letter initials for the profile avatar, e.g. "Dhanya Hegde" -> "DH"
export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
