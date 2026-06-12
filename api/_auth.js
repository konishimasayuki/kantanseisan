import { redis } from "./_redis.js";

export async function verifyToken(req) {
  const auth = req.headers.authorization || "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return null;
  const userId = await redis.get(`ks:session:${token}`);
  return userId || null;
}
