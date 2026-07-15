import { requireSessionResponse } from "../../_lib/auth.js";
import { json, nowIso, requireDb } from "../../_lib/http.js";

export async function onRequestGet({ request, env, params }) {
  const auth = await requireSessionResponse(request, env);
  if (auth.response) return auth.response;
  const db = requireDb(env);
  if (!env.LIT_R2) return json({ error: "LIT_R2 is not bound. Cannot read stored files." }, 500);

  const document = await db
    .prepare("SELECT id, project_id, r2_key, kind, content_type, size_bytes FROM documents WHERE id = ? AND deleted_at IS NULL")
    .bind(params.id)
    .first();
  if (!document) return json({ error: "Document not found or already released." }, 404);

  const object = await env.LIT_R2.get(document.r2_key);
  if (!object) return json({ error: "Stored object not found. It may have been released." }, 404);

  await db.prepare("UPDATE documents SET last_accessed_at = ? WHERE id = ?").bind(nowIso(), params.id).run();

  const filename = document.r2_key.split("/").pop() || `${document.id}.dat`;
  const size = object.size || document.size_bytes;
  const headers = new Headers();
  headers.set("Content-Type", document.content_type || object.httpMetadata?.contentType || "application/octet-stream");
  if (size) headers.set("Content-Length", String(size));
  headers.set("Content-Disposition", `inline; filename="${filename.replace(/"/g, "")}"`);
  headers.set("Cache-Control", "private, max-age=60");

  return new Response(object.body, { headers });
}
