import { redis } from "../_redis.js";
import crypto from "crypto";

// パスワードをSHA256ハッシュ化
function hashPassword(pass) {
  return crypto.createHash("sha256").update(pass).digest("hex");
}

// デモデータ50件を生成
function generateDemoData(userId) {
  const categories = ["transport","fuel","meal","accommodation","supplies","communication","other"];
  const items = [];
  const now = new Date();

  const templates = [
    { category:"fuel",    desc:"現場往復ガソリン代",   from:"博多駅",  to:"春日市現場", dist:18 },
    { category:"fuel",    desc:"資材調達ガソリン代",   from:"天神",    to:"糸島市",     dist:35 },
    { category:"fuel",    desc:"客先訪問ガソリン代",   from:"博多",    to:"宗像市",     dist:32 },
    { category:"transport", desc:"電車代（博多→天神）",  amount:260  },
    { category:"transport", desc:"高速代（都市高速）",    amount:510  },
    { category:"meal",    desc:"取引先との会食",         amount:8500 },
    { category:"meal",    desc:"出張中の昼食",           amount:980  },
    { category:"meal",    desc:"打ち合わせ喫茶代",       amount:650  },
    { category:"supplies", desc:"事務用品（コピー用紙）", amount:1320 },
    { category:"supplies", desc:"プリンターインク",       amount:2480 },
    { category:"communication", desc:"携帯電話代（業務分）",  amount:3000 },
    { category:"accommodation",  desc:"出張宿泊費（福岡市内）",amount:8800 },
    { category:"other",   desc:"駐車場代",              amount:500  },
    { category:"other",   desc:"コンビニ（業務用購入）", amount:450  },
  ];

  for (let i = 0; i < 50; i++) {
    const t = templates[i % templates.length];
    const daysAgo = Math.floor(i * 1.8);
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    const dateStr = d.toISOString().split("T")[0];

    let amount = t.amount || 0;
    let from = t.from || "";
    let to   = t.to   || "";
    let dist = t.dist || 0;

    if (t.category === "fuel" && t.dist) {
      amount = Math.round((t.dist / 15) * 165);
    }

    items.push({
      id: `demo_${userId}_${i}`,
      date: dateStr,
      category: t.category,
      description: t.desc,
      amount,
      from,
      to,
      distance: dist,
      fuelEff: "15",
      fuelPrice: "165",
      memo: "",
      files: [],
      createdAt: d.toISOString(),
    });
  }
  return items;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { userId, password } = req.body || {};
  if (!userId || !password) return res.status(400).json({ error: "IDとパスワードを入力してください" });

  // ── ユーザーが存在しなければ個別にseed ──
  const existsMain = await redis.exists("ks:user:ninjin.konishi@gmail.com");
  if (!existsMain) {
    await redis.set("ks:user:ninjin.konishi@gmail.com", JSON.stringify({
      userId: "ninjin.konishi@gmail.com",
      displayName: "Konishi",
      passwordHash: hashPassword("masa0524"),
    }));
  }

  const existsDemo = await redis.exists("ks:user:a");
  if (!existsDemo) {
    await redis.set("ks:user:a", JSON.stringify({
      userId: "a",
      displayName: "デモユーザー",
      passwordHash: hashPassword("a"),
    }));
    // デモデータ投入（初回のみ）
    const demoItems = generateDemoData("a");
    for (const item of demoItems) {
      await redis.lpush("ks:expenses:a", JSON.stringify(item));
    }
  }

  // ── 認証 ──
  const userRaw = await redis.get(`ks:user:${userId}`);
  if (!userRaw) return res.status(401).json({ error: "IDまたはパスワードが違います" });

  const user = typeof userRaw === "string" ? JSON.parse(userRaw) : userRaw;
  if (user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: "IDまたはパスワードが違います" });
  }

  // ── セッション発行 ──
  const token = crypto.randomBytes(32).toString("hex");
  await redis.set(`ks:session:${token}`, userId, { ex: 60 * 60 * 24 * 30 }); // 30日

  return res.status(200).json({ userId, displayName: user.displayName, token });
}
