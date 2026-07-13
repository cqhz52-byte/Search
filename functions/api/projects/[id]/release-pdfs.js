import { requireSessionResponse } from "../../../_lib/auth.js";
import { deleteDocuments } from "../../../_lib/resources.js";
import { json, requireDb } from "../../../_lib/http.js";

export async function onRequestPost({ request, env, params }) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth.response;
  const result = await deleteDocuments(requireDb(env), env.LIT_R2, { projectId: params.id, purpose: "pdf" }, 200);
  return json({ ok: true, ...result });
}
