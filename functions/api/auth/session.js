import { getSession } from "../../_lib/auth.js";
import { json } from "../../_lib/http.js";

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session && String(env.AUTH_ALLOW_ALL || "").toLowerCase() !== "true") {
    return json({ authenticated: false }, 401);
  }
  return json({
    authenticated: true,
    user: session || { userId: "dev", phone: "dev", role: "super_admin", name: "Dev" }
  });
}
