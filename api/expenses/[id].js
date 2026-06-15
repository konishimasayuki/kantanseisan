import { redis } from "../_redis.js";
import { verifyToken } from "../_auth.js";

export default async function handler(req, res) {
  const userId = await verifyToken(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  // クエリから id のみ取得（userId は不要）
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "id required" });

  const key = `ks:expenses:${userId}`;
  const raw = await redis.lrange(key, 0, -1);
  const items = raw.map((r) => (typeof r === "string" ? JSON.parse(r) : r));
  const idx = items.findIndex((e) => e.id === id);

  if (idx === -1) return res.status(404).json({ error: "Not found" });

  if (req.method === "DELETE") {
    await redis.lrem(key, 1, raw[idx]);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "PUT") {
    const body = req.body || {};
    const updated = {
      ...items[idx],
      ...body,
      id,
      updatedAt: new Date().toISOString(),
    };
    await redis.lset(key, idx, JSON.stringify(updated));
    return res.status(200).json(updated);
  }

  return res.status(405).json({ error: "Method not allowed" });
}
