export function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

export async function readJson(request) {
  if (!request.body) return {};
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function randomId(prefix = "id") {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const value = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${value}`;
}

export function getDailyLimit(env) {
  const configured = Number(env.DAILY_JOB_UNIT_LIMIT || 800);
  return Number.isFinite(configured) && configured > 0 ? configured : 800;
}

export function getBatchLimit(env, requested) {
  const max = Number(env.DEFAULT_BATCH_LIMIT || 15) || 15;
  const value = Number(requested || max);
  return Math.max(1, Math.min(Number.isFinite(value) ? value : max, max));
}

export function requireDb(env) {
  if (!env.LIT_DB) throw new Error("LIT_DB is not bound. Create a D1 database and run migrations first.");
  return env.LIT_DB;
}

export function safeText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

export function daysFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString();
}
