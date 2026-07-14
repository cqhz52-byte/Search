import { requireAdminResponse } from "../../_lib/auth.js";
import { json, nowIso, readJson, requireDb, safeText } from "../../_lib/http.js";

const DEEPSEEK_KEY = "provider:deepseek_api_key";

export async function onRequestGet({ request, env }) {
  const auth = await requireAdminResponse(request, env);
  if (auth.response) return auth.response;
  const row = await requireDb(env)
    .prepare("SELECT value, updated_at FROM app_settings WHERE key = ?")
    .bind(DEEPSEEK_KEY)
    .first();
  return json({ settings: { deepseek: publicDeepseekSetting(row) } });
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAdminResponse(request, env);
  if (auth.response) return auth.response;
  const db = requireDb(env);
  const body = await readJson(request);
  const now = nowIso();

  if (body.clearDeepseek === true) {
    await db.prepare("DELETE FROM app_settings WHERE key = ?").bind(DEEPSEEK_KEY).run();
    return json({ ok: true, settings: { deepseek: publicDeepseekSetting(null) } });
  }

  const apiKey = safeText(body.deepseekApiKey);
  if (!apiKey) return json({ error: "请输入 DeepSeek API Key。" }, 400);
  if (apiKey.length < 8 || apiKey.length > 300) return json({ error: "DeepSeek API Key 长度不正确。" }, 400);

  const existing = await db.prepare("SELECT key FROM app_settings WHERE key = ?").bind(DEEPSEEK_KEY).first();
  if (existing) {
    await db.prepare("UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?").bind(apiKey, now, DEEPSEEK_KEY).run();
  } else {
    await db.prepare("INSERT INTO app_settings (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(DEEPSEEK_KEY, apiKey, now, now).run();
  }
  return json({ ok: true, settings: { deepseek: publicDeepseekSetting({ value: apiKey, updated_at: now }) } });
}

function publicDeepseekSetting(row) {
  const value = safeText(row?.value);
  return {
    configured: Boolean(value),
    last4: value ? value.slice(-4) : "",
    updatedAt: row?.updated_at || ""
  };
}
