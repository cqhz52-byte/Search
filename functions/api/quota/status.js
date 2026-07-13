import { requireSessionResponse } from "../../_lib/auth.js";
import { dailyUsage } from "../../_lib/resources.js";
import { getDailyLimit, json, requireDb } from "../../_lib/http.js";

export async function onRequestGet({ request, env }) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth.response;
  const db = requireDb(env);
  const usage = await dailyUsage(db);
  const usedUnits = Object.values(usage).reduce((sum, value) => sum + Number(value || 0), 0);
  const dailyLimit = getDailyLimit(env);
  return json({
    mode: env.APP_RESOURCE_MODE || "free",
    usage,
    usedUnits,
    dailyLimit,
    remainingUnits: Math.max(0, dailyLimit - usedUnits),
    paused: usedUnits >= dailyLimit
  });
}
