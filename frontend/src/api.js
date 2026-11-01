const cache = new Map();
export async function get(path, { fresh = false } = {}) {
  if (!fresh && cache.has(path)) return cache.get(path);
  const r = await fetch("/api" + path);
  if (!r.ok) {
    let msg = `Request failed (${r.status})`;
    try { const j = await r.json(); if (j.detail) msg = typeof j.detail === "string" ? j.detail : msg; } catch {}
    throw new Error(msg);
  }
  const j = await r.json();
  cache.set(path, j);
  return j;
}
export const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
