import { requireSessionResponse } from "../../_lib/auth.js";
import { deleteDocuments, recordUsage } from "../../_lib/resources.js";
import { json, nowIso, requireDb } from "../../_lib/http.js";

export async function onRequestPost({ request, env }) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth.response;
  const db = requireDb(env);
  const now = nowIso();
  const expired = await deleteDocuments(db, env.LIT_R2, { expiredBefore: now }, 100);
  const failed = await deleteDocuments(db, env.LIT_R2, { status: "failed" }, 100);
  await recordUsage(db, "cleanup:temp", 1, null);
  return json({
    ok: true,
    deletedCount: expired.deletedCount + failed.deletedCount,
    releasedBytes: expired.releasedBytes + failed.releasedBytes
  });
}
