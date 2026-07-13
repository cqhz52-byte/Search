import { hashSecret, publicUser, requireAdminResponse } from "../../_lib/auth.js";
import { json, nowIso, randomId, readJson, requireDb, safeText } from "../../_lib/http.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireAdminResponse(request, env);
  if (auth.response) return auth.response;
  const rows = await requireDb(env)
    .prepare("SELECT id, phone, name, role, enabled, created_at, updated_at FROM users ORDER BY updated_at DESC LIMIT 100")
    .all();
  return json({ users: rows.results || [] });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAdminResponse(request, env);
  if (auth.response) return auth.response;
  const db = requireDb(env);
  const body = await readJson(request);
  const phone = safeText(body.phone).toLowerCase();
  if (!phone) return json({ error: "请输入账号或手机号。" }, 400);
  const role = safeText(body.role, "researcher");
  if (!["super_admin", "project_admin", "researcher", "viewer"].includes(role)) {
    return json({ error: "角色不合法。" }, 400);
  }
  const existing = await db.prepare("SELECT * FROM users WHERE phone = ?").bind(phone).first();
  const now = nowIso();
  const password = safeText(body.password);
  if (!existing && password.length < 4) return json({ error: "新增用户需要至少 4 位密码。" }, 400);
  const id = existing?.id || randomId("usr");
  const passwordHash = password ? await hashSecret(password) : existing.password_hash;
  if (existing) {
    await db
      .prepare("UPDATE users SET name = ?, role = ?, password_hash = ?, enabled = ?, updated_at = ? WHERE id = ?")
      .bind(safeText(body.name), role, passwordHash, body.enabled === false ? 0 : 1, now, id)
      .run();
  } else {
    await db
      .prepare("INSERT INTO users (id, phone, name, role, password_hash, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, phone, safeText(body.name), role, passwordHash, body.enabled === false ? 0 : 1, now, now)
      .run();
  }
  const saved = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  return json({ ok: true, user: publicUser(saved) });
}

export async function onRequestDelete({ request, env }) {
  const auth = await requireAdminResponse(request, env);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const phone = safeText(url.searchParams.get("phone")).toLowerCase();
  if (!phone) return json({ error: "缺少账号。" }, 400);
  if (phone === auth.session.phone) return json({ error: "不能删除当前登录账号。" }, 400);
  await requireDb(env).prepare("DELETE FROM users WHERE phone = ?").bind(phone).run();
  return json({ ok: true });
}
