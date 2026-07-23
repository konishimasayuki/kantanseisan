import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

/* ═══ カラー定義 ═══ */
const C = {
  orange:      rgb(0.976, 0.451, 0.086),  // #F97316
  orangeLight: rgb(1,     0.969, 0.929),  // #FFF7ED
  orangeBorder:rgb(0.992, 0.847, 0.667),  // #FED7AA
  green:       rgb(0.063, 0.725, 0.506),  // #10B981
  greenLight:  rgb(0.941, 0.992, 0.961),  // #F0FDF4
  red:         rgb(0.937, 0.267, 0.267),  // #EF4444
  dark:        rgb(0.118, 0.161, 0.231),  // #1E293B
  gray:        rgb(0.392, 0.455, 0.545),  // #64748B
  lightGray:   rgb(0.945, 0.953, 0.961),  // #F1F5F9
  border:      rgb(0.886, 0.906, 0.941),  // #E2E8F0
  white:       rgb(1, 1, 1),
};

const CATEGORIES = [
  { id: "transport",     label: "交通費"    },
  { id: "fuel",          label: "ガソリン代" },
  { id: "meal",          label: "食費・接待" },
  { id: "accommodation", label: "宿泊費"    },
  { id: "supplies",      label: "消耗品"    },
  { id: "communication", label: "通信費"    },
  { id: "other",         label: "その他"    },
];
const getCatLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || "その他";
const fmt = (n) => `¥${Number(n || 0).toLocaleString("ja-JP")}`;
const fmtDate = (d) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${y}/${m}/${day}`;
};
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
};

// フォント取得（publicフォルダからfetch）
async function loadFont(pdfDoc) {
  const res = await fetch("/fonts/NotoSansJP-Regular.otf");
  const buf = await res.arrayBuffer();
  return pdfDoc.embedFont(buf);
}

export async function generatePDF({ monthExpenses, monthTotal, monthSettled, filterMonth, settlements, allExpenses, displayName }) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const font     = await loadFont(pdfDoc);
  const fontBold = font; // OTFにboldが別ファイルないのでRegularで代用

  const monthLabel = filterMonth ? filterMonth.replace("-", "年") + "月" : "全期間";
  const monthSetts = settlements.filter((r) => r.date?.startsWith(filterMonth));
  const fuelItems  = monthExpenses.filter((e) => e.category === "fuel");

  // ── 累計ベースの残高計算 ──
  // その月末まで（filterMonthが空＝全期間なら全部）を対象に、
  // 立替累計・精算累計から未精算残と当月実質精算を算出
  const exps = allExpenses || monthExpenses;
  let cumExpenseThruMonth = 0;   // 当月末までの立替累計
  let cumSettledThruMonth = 0;   // 当月末までの精算累計
  let cumExpenseBeforeMonth = 0; // 前月末までの立替累計
  let cumSettledBeforeMonth = 0; // 前月末までの精算累計

  if (filterMonth) {
    exps.forEach((e) => {
      const m = (e.date || "").slice(0, 7);
      if (m && m <= filterMonth) cumExpenseThruMonth += (e.amount || 0);
      if (m && m <  filterMonth) cumExpenseBeforeMonth += (e.amount || 0);
    });
    settlements.forEach((r) => {
      const m = (r.date || "").slice(0, 7);
      if (m && m <= filterMonth) cumSettledThruMonth += (r.amount || 0);
      if (m && m <  filterMonth) cumSettledBeforeMonth += (r.amount || 0);
    });
  } else {
    // 全期間：単純累計
    cumExpenseThruMonth = exps.reduce((s, e) => s + (e.amount || 0), 0);
    cumSettledThruMonth = settlements.reduce((s, r) => s + (r.amount || 0), 0);
  }

  // 前月末時点の未精算（繰越）
  const carryOver = cumExpenseBeforeMonth - cumSettledBeforeMonth;
  // 未精算残（当月末時点の累計）
  const monthUnsettled = cumExpenseThruMonth - cumSettledThruMonth;
  // 当月に実質充当された精算額（繰越＋当月経費のうち精算された分）
  //   = 当月末精算累計 − 前月末精算累計 … だが繰越も含めた「当月動いた精算」を表示
  const settledThisPeriod = cumSettledThruMonth - cumSettledBeforeMonth;

  // ── ページ管理 ──
  const PAGE_W = 595;   // A4
  const PAGE_H = 842;
  const MARGIN  = 40;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  // 新ページが必要なら追加
  const ensurePage = (need = 40) => {
    if (y - need < MARGIN + 20) {
      drawFooter(page, font, pdfDoc.getPageCount());
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  // ── ヘッダー背景 ──
  page.drawRectangle({ x: 0, y: PAGE_H - 64, width: PAGE_W, height: 64, color: C.orange });

  // タイトル
  page.drawText("経費精算書", { x: MARGIN, y: PAGE_H - 28, size: 20, font, color: C.white });
  page.drawText(`${monthLabel}  ／  ${displayName || ""}`, { x: MARGIN, y: PAGE_H - 48, size: 10, font, color: C.white });

  // 右側：出力日＋振込先（右揃え）
  const rightText = (text, yy, size) => {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: PAGE_W - MARGIN - w, y: yy, size, font, color: C.white });
  };
  rightText(`出力日: ${todayStr()}`, PAGE_H - 22, 9);
  rightText("【振込先】三菱UFJ銀行 久留米支店", PAGE_H - 40, 9);
  rightText("普通 0016202 コニシマサユキ", PAGE_H - 54, 9);

  y = PAGE_H - 78;

  // ── サマリーカード ──
  const cardW = (CONTENT_W - 16) / 3;
  const cards = [
    { label: "当月経費", value: fmt(monthTotal),         color: C.orange, bg: C.orangeLight },
    { label: "精算（当月）", value: fmt(settledThisPeriod), color: C.green,  bg: C.greenLight  },
    { label: "未精算残（累計）", value: fmt(monthUnsettled), color: C.red,   bg: rgb(1, 0.941, 0.941) },
  ];
  cards.forEach((card, i) => {
    const x = MARGIN + i * (cardW + 8);
    // 背景
    page.drawRectangle({ x, y: y - 44, width: cardW, height: 44, color: card.bg, borderColor: C.orangeBorder, borderWidth: 0.5 });
    // 左のカラーバー
    page.drawRectangle({ x, y: y - 44, width: 3, height: 44, color: card.color });
    // ラベル
    page.drawText(card.label, { x: x + 8, y: y - 16, size: 8.5, font, color: card.color });
    // 金額
    page.drawText(card.value, { x: x + 8, y: y - 34, size: 14, font, color: card.color });
  });
  y -= 48;

  // 繰越がある場合は注記（前月末の未精算を当月に繰り越している）
  if (filterMonth && carryOver !== 0) {
    const note = `※ 前月末からの繰越（未精算）: ${fmt(carryOver)} を含む累計残高です`;
    page.drawText(note, { x: MARGIN, y: y, size: 8, font, color: C.gray });
    y -= 12;
  }
  y -= 8;

  // ── テーブル描画ヘルパー ──
  const drawTable = (headers, rows, colWidths, options = {}) => {
    const ROW_H = 18;
    const HEAD_H = 20;
    const tableW = colWidths.reduce((s, w) => s + w, 0);
    const totalRows = rows.length;
    const X0 = options.startX ?? MARGIN;
    const startY = y;

    if (!options.noEnsure) ensurePage(HEAD_H + ROW_H * Math.min(3, totalRows) + 10);

    // ヘッダー
    page.drawRectangle({ x: X0, y: y - HEAD_H, width: tableW, height: HEAD_H, color: options.headColor || C.orange });
    let hx = X0;
    headers.forEach((h, i) => {
      page.drawText(h, {
        x: hx + 5,
        y: y - HEAD_H + 6,
        size: 9,
        font,
        color: C.white,
      });
      hx += colWidths[i];
    });
    y -= HEAD_H;

    // 行
    rows.forEach((row, ri) => {
      if (!options.noEnsure) ensurePage(ROW_H + 4);
      const isLast = ri === rows.length - 1;
      const isEmph = options.emphasizeLastRow && isLast;
      const isEven = ri % 2 === 1;
      let rowBg = options.altColor
        ? (isEven ? options.altColor : C.white)
        : (isEven ? C.orangeLight : C.white);
      if (isEmph) rowBg = C.orangeBorder; // 合計行は濃いめ背景

      page.drawRectangle({ x: X0, y: y - ROW_H, width: tableW, height: ROW_H, color: rowBg });
      // 下線
      page.drawLine({ start: { x: X0, y: y - ROW_H }, end: { x: X0 + tableW, y: y - ROW_H }, thickness: 0.3, color: C.border });

      let rx = X0;
      row.forEach((cell, ci) => {
        const isRight = options.rightCols?.includes(ci);
        const isBold  = options.boldCols?.includes(ci);
        let textColor = C.dark;
        if (isEmph) textColor = rgb(0.78, 0.29, 0.03);          // 合計行は濃いオレンジ
        else if (options.boldColor && isBold) textColor = options.boldColor;
        else if (isLast && options.lastRowColor) textColor = options.lastRowColor;
        const textSize = isEmph ? 9 : 8.5;                       // 合計は少し大きく
        const text = String(cell ?? "");

        // 右揃え
        const textW = font.widthOfTextAtSize(text, textSize);
        const tx = isRight
          ? rx + colWidths[ci] - textW - 5
          : rx + 5;

        // 合計行は擬似太字（わずかにずらして二重描画）
        page.drawText(text, { x: tx, y: y - ROW_H + 5, size: textSize, font, color: textColor });
        if (isEmph) {
          page.drawText(text, { x: tx + 0.3, y: y - ROW_H + 5, size: textSize, font, color: textColor });
        }
        rx += colWidths[ci];
      });
      y -= ROW_H;
    });
    // 外枠
    page.drawRectangle({ x: X0, y, width: tableW, height: HEAD_H + ROW_H * rows.length, borderColor: C.border, borderWidth: 0.5 });
    const endY = y;
    if (options.noAdvanceY) y = startY; // Y位置を戻す（横並び用）
    else y -= 12;
    return endY;
  };

  // ── セクションタイトル描画 ──
  const drawSection = (title) => {
    ensurePage(30);
    page.drawRectangle({ x: MARGIN, y: y - 18, width: CONTENT_W, height: 18, color: C.orangeLight, borderColor: C.orangeBorder, borderWidth: 0.5 });
    page.drawRectangle({ x: MARGIN, y: y - 18, width: 3, height: 18, color: C.orange });
    page.drawText(title, { x: MARGIN + 8, y: y - 13, size: 10, font, color: C.orange });
    y -= 26;
  };

  // ── カテゴリ別集計（横2列） ──
  drawSection("カテゴリ別集計");
  const catTotals = {};
  monthExpenses.forEach((e) => { catTotals[e.category] = (catTotals[e.category] || 0) + e.amount; });
  const catRowsAll = CATEGORIES
    .filter((cat) => catTotals[cat.id])
    .map((cat) => [
      cat.label,
      `${monthExpenses.filter((e) => e.category === cat.id).length} 件`,
      fmt(catTotals[cat.id]),
    ]);

  // 合計行を分離
  const totalRow = ["合計", `${monthExpenses.length} 件`, fmt(monthTotal)];

  // 合計以外を左右に振り分け（左に多め）、合計は右末尾に必ず追加
  const half = Math.ceil(catRowsAll.length / 2);
  const leftRows  = catRowsAll.slice(0, half);
  const rightRows = [...catRowsAll.slice(half), totalRow];
  const catCols = [100, 50, 75];
  const catTableW = catCols.reduce((s, w) => s + w, 0);
  const gap2 = 20;

  // 改ページ確保（最大行数ぶん）
  ensurePage(20 + 18 * Math.max(leftRows.length, rightRows.length) + 10);

  const leftEnd = drawTable(
    ["カテゴリ", "件数", "金額"], leftRows, catCols,
    { rightCols: [1, 2], noAdvanceY: true, noEnsure: true }
  );
  let rightEnd = y;
  if (rightRows.length > 0) {
    rightEnd = drawTable(
      ["カテゴリ", "件数", "金額"], rightRows, catCols,
      { startX: MARGIN + catTableW + gap2, rightCols: [1, 2], emphasizeLastRow: true, noAdvanceY: true, noEnsure: true }
    );
  }
  // 低い方に合わせてY送り
  y = Math.min(leftEnd, rightEnd) - 12;

  // ── ガソリン代明細 ──
  if (fuelItems.length > 0) {
    drawSection("ガソリン代明細");
    const fuelRows = fuelItems.map((e) => [
      fmtDate(e.date),
      e.description,
      e.from && e.to ? `${e.from} → ${e.to}` : "-",
      e.distance ? `${e.distance}km` : "-",
      fmt(e.amount),
      `¥${e.fuelPrice || 165}/L・${e.fuelEff || 15}km/L`,
    ]);
    drawTable(
      ["日付", "内容", "区間", "距離", "金額", "単価・燃費"],
      fuelRows,
      [50, 95, 95, 40, 60, 113],
      { rightCols: [3, 4], boldCols: [4], boldColor: C.orange }
    );
  }

  // ── 経費明細（ガソリン代を除く） ──
  drawSection("経費明細");
  const allRows = monthExpenses
    .filter((e) => e.category !== "fuel")
    .map((e) => [
      fmtDate(e.date),
      getCatLabel(e.category),
      e.description,
      fmt(e.amount),
      e.memo || "-",
    ]);
  drawTable(
    ["日付", "カテゴリ", "内容", "金額", "備考"],
    allRows,
    [50, 60, 165, 60, 95],
    { rightCols: [3], boldCols: [3], boldColor: C.orange }
  );

  // ── 添付写真サムネイル（経費明細の下） ──
  const photos = [];
  monthExpenses
    .filter((e) => e.category !== "fuel")
    .forEach((e) => {
      (e.files || []).forEach((f) => {
        if (f.type?.startsWith("image/")) {
          photos.push({ data: f.data, date: e.date, desc: e.description });
        }
      });
    });

  if (photos.length > 0) {
    drawSection("添付写真");
    const thumbW = 72;
    const thumbH = 72;
    const gap = 10;
    const perRow = Math.floor((CONTENT_W + gap) / (thumbW + gap));
    let col = 0;
    let rowMaxBottom = y;

    for (const photo of photos) {
      // 改ページ判定（サムネイル＋ラベル分）
      if (y - (thumbH + 14) < MARGIN + 20) {
        drawFooter(page, font, pdfDoc.getPageCount());
        page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
        col = 0;
      }
      const x = MARGIN + col * (thumbW + gap);
      try {
        let img;
        if (photo.data.startsWith("data:image/png")) {
          img = await pdfDoc.embedPng(photo.data);
        } else {
          img = await pdfDoc.embedJpg(photo.data);
        }
        // アスペクト比維持してthumb枠に収める
        const scale = Math.min(thumbW / img.width, thumbH / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        // 枠
        page.drawRectangle({ x, y: y - thumbH, width: thumbW, height: thumbH, borderColor: C.border, borderWidth: 0.5, color: C.lightGray });
        // 画像（中央寄せ）
        page.drawImage(img, { x: x + (thumbW - w) / 2, y: y - thumbH + (thumbH - h) / 2, width: w, height: h });
        // 日付ラベル
        page.drawText(fmtDate(photo.date), { x, y: y - thumbH - 9, size: 6.5, font, color: C.gray });
      } catch {
        // 埋め込み失敗時はスキップ
      }
      col++;
      if (col >= perRow) {
        col = 0;
        y -= thumbH + 18;
      }
    }
    if (col !== 0) y -= thumbH + 18;
    y -= 4;
  }

  // ── 精算記録 ──
  if (monthSetts.length > 0) {
    drawSection("精算記録");
    const settRows = monthSetts.map((r) => [
      fmtDate(r.date),
      fmt(r.amount),
      r.memo || "-",
    ]);
    drawTable(
      ["精算日", "金額", "備考"],
      settRows,
      [70, 90, 180],
      { headColor: C.green, altColor: C.greenLight, rightCols: [1], boldCols: [1], boldColor: C.green }
    );
  }

  // ── 最終ページのフッター ──
  drawFooter(page, font, pdfDoc.getPageCount());

  // ── 全ページフッターにページ番号 ──
  function drawFooter(pg, ft, total) {
    pg.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 18, color: C.orange });
    pg.drawText("簡単精算くん", { x: MARGIN, y: 5, size: 8, font: ft, color: C.white });
    const pageNum = pdfDoc.getPageCount();
    pg.drawText(`${pageNum} / ${total}`, { x: PAGE_W - MARGIN - 30, y: 5, size: 8, font: ft, color: C.white });
  }

  // ── 保存・ダウンロード ──
  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filterMonth ? `経費精算書_${filterMonth}.pdf` : "経費精算書_全期間.pdf";
  a.click();
  URL.revokeObjectURL(url);
}
