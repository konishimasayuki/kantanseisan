import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const ORANGE = [249, 115, 22];
const ORANGE_LIGHT = [255, 247, 237];
const GRAY = [100, 116, 139];
const DARK = [30, 41, 59];
const WHITE = [255, 255, 255];
const GREEN = [16, 185, 129];
const RED = [239, 68, 68];
const BORDER = [226, 232, 240];

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

// NotoSansJPフォントを動的ロード（CDN）
async function loadNotoFont(doc) {
  try {
    const url = "https://fonts.gstatic.com/s/notosansjp/v52/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.woff2";
    // woff2はjsPDFで直接使えないため、Google Fonts CSS経由でBase64取得を試みる
    // フォールバック: Helvetica（英数字のみ）で描画、日本語は別途処理
    // 実用的な方法: callAddFontでrobotoを使う
    return false;
  } catch {
    return false;
  }
}

export async function generatePDF({ monthExpenses, monthTotal, monthSettled, filterMonth, settlements, displayName }) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;

  const monthUnsettled = monthTotal - monthSettled;
  const monthLabel = filterMonth ? filterMonth.replace("-", "年") + "月" : "全期間";
  const monthSetts = settlements.filter((r) => r.date?.startsWith(filterMonth));

  // ── ヘッダー背景 ──
  doc.setFillColor(...ORANGE);
  doc.rect(0, 0, pageW, 28, "F");

  // タイトル
  doc.setTextColor(...WHITE);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Expense Report", margin, 12);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`${monthLabel}  /  ${displayName || ""}`, margin, 20);

  doc.setFontSize(9);
  doc.text(`${todayStr()} 出力`, pageW - margin, 20, { align: "right" });

  let y = 36;

  // ── サマリーカード 3つ ──
  const cardW = (contentW - 8) / 3;
  const cards = [
    { label: "経費合計", value: fmt(monthTotal),      color: ORANGE },
    { label: "精算済み", value: fmt(monthSettled),    color: GREEN  },
    { label: "未精算残", value: fmt(monthUnsettled),  color: RED    },
  ];
  cards.forEach((card, i) => {
    const x = margin + i * (cardW + 4);
    // カード背景
    doc.setFillColor(250, 250, 252);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cardW, 18, 2, 2, "FD");
    // 左のカラーライン
    doc.setFillColor(...card.color);
    doc.rect(x, y, 2.5, 18, "F");
    // ラベル
    doc.setTextColor(...GRAY);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.text(card.label, x + 6, y + 6);
    // 金額
    doc.setTextColor(...card.color);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text(card.value, x + 6, y + 14);
  });
  y += 24;

  // ── セクションヘッダー描画ヘルパー ──
  const sectionHeader = (title) => {
    if (y > pageH - 30) { doc.addPage(); y = 16; }
    doc.setFillColor(...ORANGE_LIGHT);
    doc.setDrawColor(...ORANGE);
    doc.setLineWidth(0.4);
    doc.rect(margin, y, contentW, 7, "FD");
    doc.setFillColor(...ORANGE);
    doc.rect(margin, y, 2.5, 7, "F");
    doc.setTextColor(...ORANGE);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(title, margin + 5, y + 5);
    y += 10;
  };

  // ── カテゴリ別集計 ──
  sectionHeader("Category Summary  /  カテゴリ別集計");

  const catTotals = {};
  monthExpenses.forEach((e) => {
    catTotals[e.category] = (catTotals[e.category] || 0) + e.amount;
  });
  const catRows = CATEGORIES
    .filter((cat) => catTotals[cat.id])
    .map((cat) => [
      cat.label,
      String(monthExpenses.filter((e) => e.category === cat.id).length) + " 件",
      fmt(catTotals[cat.id]),
    ]);
  catRows.push(["合計", String(monthExpenses.length) + " 件", fmt(monthTotal)]);

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["カテゴリ", "件数", "金額"]],
    body: catRows,
    styles: { fontSize: 9, cellPadding: 3, font: "helvetica", textColor: DARK },
    headStyles: { fillColor: ORANGE, textColor: WHITE, fontStyle: "bold", fontSize: 9 },
    alternateRowStyles: { fillColor: ORANGE_LIGHT },
    columnStyles: {
      0: { cellWidth: 45 },
      1: { cellWidth: 25, halign: "center" },
      2: { cellWidth: 40, halign: "right", fontStyle: "bold" },
    },
    didDrawCell: (data) => {
      // 合計行をオレンジに
      if (data.row.index === catRows.length - 1 && data.section === "body") {
        doc.setFillColor(...ORANGE_LIGHT);
      }
    },
    willDrawCell: (data) => {
      if (data.row.index === catRows.length - 1 && data.section === "body") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = ORANGE;
      }
    },
  });
  y = doc.lastAutoTable.finalY + 8;

  // ── ガソリン代明細 ──
  const fuelItems = monthExpenses.filter((e) => e.category === "fuel");
  if (fuelItems.length > 0) {
    if (y > pageH - 40) { doc.addPage(); y = 16; }
    sectionHeader("Fuel Expenses  /  ガソリン代明細");

    const fuelRows = fuelItems.map((e) => [
      fmtDate(e.date),
      e.description,
      e.from && e.to ? `${e.from} → ${e.to}` : "-",
      e.distance ? `${e.distance} km` : "-",
      fmt(e.amount),
    ]);

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [["日付", "内容", "区間", "距離", "金額"]],
      body: fuelRows,
      styles: { fontSize: 8.5, cellPadding: 2.5, font: "helvetica", textColor: DARK },
      headStyles: { fillColor: ORANGE, textColor: WHITE, fontStyle: "bold" },
      alternateRowStyles: { fillColor: ORANGE_LIGHT },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 52 },
        2: { cellWidth: 45 },
        3: { cellWidth: 18, halign: "right" },
        4: { cellWidth: 30, halign: "right", fontStyle: "bold" },
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── 経費明細（全件） ──
  if (y > pageH - 40) { doc.addPage(); y = 16; }
  sectionHeader("All Expenses  /  経費明細");

  const allRows = monthExpenses.map((e) => [
    fmtDate(e.date),
    getCatLabel(e.category),
    e.description + (e.memo ? `  (${e.memo})` : ""),
    fmt(e.amount),
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["日付", "カテゴリ", "内容", "金額"]],
    body: allRows,
    styles: { fontSize: 8.5, cellPadding: 2.5, font: "helvetica", textColor: DARK },
    headStyles: { fillColor: ORANGE, textColor: WHITE, fontStyle: "bold" },
    alternateRowStyles: { fillColor: ORANGE_LIGHT },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 28 },
      2: { cellWidth: "auto" },
      3: { cellWidth: 30, halign: "right", fontStyle: "bold" },
    },
  });
  y = doc.lastAutoTable.finalY + 8;

  // ── 精算記録 ──
  if (monthSetts.length > 0) {
    if (y > pageH - 40) { doc.addPage(); y = 16; }
    sectionHeader("Settlements  /  精算記録");

    const settRows = monthSetts.map((r) => [
      fmtDate(r.date),
      fmt(r.amount),
      r.memo || "-",
    ]);

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [["精算日", "金額", "備考"]],
      body: settRows,
      styles: { fontSize: 8.5, cellPadding: 2.5, font: "helvetica", textColor: DARK },
      headStyles: { fillColor: [16, 185, 129], textColor: WHITE, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [240, 253, 244] },
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 35, halign: "right", fontStyle: "bold", textColor: GREEN },
        2: { cellWidth: "auto" },
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ── フッター（全ページ） ──
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFillColor(...ORANGE);
    doc.rect(0, pageH - 8, pageW, 8, "F");
    doc.setTextColor(...WHITE);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.text("簡単精算くん  /  Kantan Seisan", margin, pageH - 2.5);
    doc.text(`${i} / ${totalPages}`, pageW - margin, pageH - 2.5, { align: "right" });
  }

  // ── ダウンロード ──
  const fileName = filterMonth
    ? `経費精算書_${filterMonth}.pdf`
    : `経費精算書_全期間.pdf`;
  doc.save(fileName);
}
