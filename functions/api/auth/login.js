import { createSessionCookie, login } from "../../_lib/auth.js";
import { json, readJson } from "../../_lib/http.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJson(request);
    const result = await login(body.phone, body.password, env);
    if (!result.ok) return json({ error: result.error }, 401);
    return json({ ok: true, user: result.user }, 200, {
      "Set-Cookie": await createSessionCookie(result.user, env)
    });
  } catch (error) {
    return json({ error: error.message || "登录失败。" }, 500);
  }
}
