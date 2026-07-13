import { json, nowIso, randomId, requireDb, safeText } from "./http.js";

const COOKIE_NAME = "lit_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 14;

export async function requireSession(request, env) {
  if (String(env.AUTH_ALLOW_ALL || "").toLowerCase() === "true") {
    return { userId: "dev", phone: "dev", role: "super_admin" };
  }
  const session = await getSession(request, env);
  if (session) return session;
  return null;
}

export async function requireSessionResponse(request, env) {
  const session = await requireSession(request, env);
  if (!session) return { response: json({ error: "请先登录。" }, 401), session: null };
  return { response: null, session };
}

export async function requireAdminResponse(request, env) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth;
  if (auth.session.role !== "super_admin") {
    return { response: json({ error: "需要超级管理员权限。" }, 403), session: auth.session };
  }
  return auth;
}

export async function login(phone, password, env) {
  const db = requireDb(env);
  const normalized = normalizePhone(phone);
  if (!normalized) return { ok: false, error: "请输入有效手机号或账号。" };
  if (safeText(password).length < 4) return { ok: false, error: "密码至少 4 位。" };

  const count = await db.prepare("SELECT COUNT(*) AS count FROM users").first();
  if (!count?.count) {
    const user = {
      id: randomId("usr"),
      phone: normalized,
      name: "超级管理员",
      role: "super_admin",
      passwordHash: await hashSecret(password),
      now: nowIso()
    };
    await db
      .prepare("INSERT INTO users (id, phone, name, role, password_hash, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
      .bind(user.id, user.phone, user.name, user.role, user.passwordHash, user.now, user.now)
      .run();
    return { ok: true, user: { id: user.id, phone: user.phone, name: user.name, role: user.role } };
  }

  const record = await db.prepare("SELECT * FROM users WHERE phone = ? AND enabled = 1").bind(normalized).first();
  if (!record) return { ok: false, error: "账号不存在或已停用。" };
  if (!(await verifyStoredSecret(password, record.password_hash))) return { ok: false, error: "密码不正确。" };
  return { ok: true, user: publicUser(record) };
}

export async function getSession(request, env) {
  const cookie = getCookie(request, COOKIE_NAME);
  if (!cookie) return null;
  const [payload, signature] = cookie.split(".");
  if (!payload || !signature) return null;
  const expected = await sign(payload, await getSessionSecret(env));
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    const data = JSON.parse(base64UrlDecode(payload));
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export async function createSessionCookie(user, env) {
  const payload = {
    userId: user.id,
    phone: user.phone,
    name: user.name || "",
    role: user.role,
    exp: Date.now() + SESSION_MAX_AGE * 1000
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = await sign(encoded, await getSessionSecret(env));
  return [
    `${COOKIE_NAME}=${encoded}.${signature}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax"
  ].join("; ");
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function publicUser(record) {
  return {
    id: record.id,
    phone: record.phone,
    name: record.name || "",
    role: record.role || "researcher",
    enabled: record.enabled !== 0
  };
}

export function normalizePhone(value) {
  const text = safeText(value);
  if (!text) return "";
  if (text.includes("@")) return text.toLowerCase();
  const hasPlus = text.startsWith("+");
  const digits = text.replace(/\D/g, "");
  if (digits.length < 4 || digits.length > 15) return "";
  return hasPlus ? `+${digits}` : digits;
}

async function getSessionSecret(env) {
  const configured = safeText(env.AUTH_SESSION_SECRET);
  if (configured) return configured;

  const key = "app:session_secret";
  if (env.RESEARCH_AUTH_KV) {
    const stored = await env.RESEARCH_AUTH_KV.get(key);
    if (stored) return stored;
    const generated = randomId("secret");
    await env.RESEARCH_AUTH_KV.put(key, generated);
    return generated;
  }

  if (!env.LIT_DB) return "local-development-secret";
  const stored = await env.LIT_DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first();
  if (stored?.value) return stored.value;
  const generated = randomId("secret");
  const now = nowIso();
  await env.LIT_DB
    .prepare("INSERT INTO app_settings (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .bind(key, generated, now, now)
    .run();
  return generated;
}

export async function hashSecret(secret) {
  const salt = randomId("salt");
  const digest = await sha256(`${salt}:${String(secret || "")}`);
  return `sha256:${salt}:${digest}`;
}

async function verifyStoredSecret(input, stored) {
  const secret = safeText(stored);
  if (!secret.startsWith("sha256:")) return String(input || "") === secret;
  const [, salt, digest] = secret.split(":");
  if (!salt || !digest) return false;
  return timingSafeEqual(await sha256(`${salt}:${String(input || "")}`), digest);
}

async function sign(payload, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64UrlEncodeBytes(new Uint8Array(digest));
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  return cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

function base64UrlEncode(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
