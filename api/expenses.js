import { redis } from "./_redis.js";
import { verifyToken } from "./_auth.js";
import crypto from "crypto";

export default async function handler(req, res) {
  const userId = await verifyToken(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const key = `ks:expenses:${userId}`;

  if (req.method === "GET") {
    const raw = await redis.lrange(key, 0, -1);
    const items = raw.map(r => typeof r === "string" ? JSON.parse(r) : r);
    // 日付降順
    items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return res.status(200).json({ items });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const item = {
      ...body,
      id: crypto.randomUUID(),
      userId,
      createdAt: new Date().toISOString(),
    };
    delete item.userId; // listには不要
    await redis.lpush(key, JSON.stringify(item));
    return res.status(200).json(item);
  }

  return res.status(405).json({ error: "Method not allowed" });
}
