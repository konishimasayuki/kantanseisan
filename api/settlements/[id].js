import { redis } from "../_redis.js";
import { verifyToken } from "../_auth.js";

export default async function handler(req, res) {
  const userId = await verifyToken(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "id required" });

  if (req.method === "DELETE") {
    const key = `ks:settlements:${userId}`;
    const raw = await redis.lrange(key, 0, -1);
    const items = raw.map((r) => (typeof r === "string" ? JSON.parse(r) : r));
    const idx = items.findIndex((r) => r.id === id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });
    await redis.lrem(key, 1, raw[idx]);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
