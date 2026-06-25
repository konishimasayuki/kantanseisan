import { useState, useRef, useCallback, useEffect } from "react";
import { generatePDF } from "../generatePDF.js";

/* ═══ 定数 ═══ */
const FUEL_EFF_DEFAULT   = 15;
const FUEL_PRICE_DEFAULT = 165;

const CATEGORIES = [
  { id: "transport",     label: "交通費",   icon: "🚃", color: "#F97316" },
  { id: "fuel",          label: "ガソリン代", icon: "⛽", color: "#EF4444" },
  { id: "meal",          label: "食費・接待", icon: "🍽️", color: "#8B5CF6" },
  { id: "accommodation", label: "宿泊費",   icon: "🏨", color: "#06B6D4" },
  { id: "supplies",      label: "消耗品",   icon: "📦", color: "#10B981" },
  { id: "communication", label: "通信費",   icon: "📱", color: "#3B82F6" },
  { id: "other",         label: "その他",   icon: "📋", color: "#94A3B8" },
];

const getCat   = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[6];
const fmt      = (n)  => `¥${Number(n || 0).toLocaleString("ja-JP")}`;
const fmtDate  = (d)  => { if (!d) return ""; const [y,m,day]=d.split("-"); return `${y}/${m}/${day}`; };
const calcFuel = (km,eff,price) => km>0 ? Math.round((km/eff)*price) : 0;
const todayStr = () => new Date().toISOString().split("T")[0];
const thisMonth= () => new Date().toISOString().slice(0,7);

const blankExpense = () => ({
  date: todayStr(), category: "other", description: "",
  amount: "", from: "", to: "", distance: "",
  fuelEff: String(FUEL_EFF_DEFAULT), fuelPrice: String(FUEL_PRICE_DEFAULT),
  memo: "", files: [],
});

/* ═══ ファイル処理（画像は圧縮リサイズ、PDFはサイズ制限） ═══ */
const MAX_IMAGE_DIM = 1280;      // 長辺最大px
const JPEG_QUALITY  = 0.7;       // JPEG品質
const MAX_PDF_BYTES = 2 * 1024 * 1024; // PDF上限2MB

function processFile(file) {
  return new Promise((resolve) => {
    // 画像 → canvasでリサイズ＆JPEG圧縮
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > MAX_IMAGE_DIM) {
            height = Math.round((height * MAX_IMAGE_DIM) / width);
            width = MAX_IMAGE_DIM;
          } else if (height > MAX_IMAGE_DIM) {
            width = Math.round((width * MAX_IMAGE_DIM) / height);
            height = MAX_IMAGE_DIM;
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          const data = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
          resolve({ name: file.name.replace(/\.[^.]+$/, ".jpg"), type: "image/jpeg", data });
        };
        img.onerror = () => resolve(null);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
      return;
    }
    // PDF → サイズチェックのみ
    if (file.type === "application/pdf") {
      if (file.size > MAX_PDF_BYTES) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = (e) => resolve({ name: file.name, type: file.type, data: e.target.result });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
      return;
    }
    // その他は拒否
    resolve(null);
  });
}



/* ═══ ペイロードサイズチェック ═══ */
const MAX_PAYLOAD_BYTES = 900 * 1024; // Upstash 1MB制限に余裕を持たせる
const checkPayloadSize = (form) => {
  const size = new Blob([JSON.stringify(form)]).size;
  return size <= MAX_PAYLOAD_BYTES;
};

/* ═══ API helper ═══ */
const api = async (path, method="GET", body, token) => {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "API error");
  }
  return res.json();
};

/* ═══ MAIN ═══ */
export default function ExpenseApp({ session, onLogout }) {
  const [expenses,    setExpenses]    = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [view,        setView]        = useState("list");
  const [selectedId,  setSelectedId]  = useState(null);
  const [form,        setForm]        = useState(blankExpense());
  const [settleForm,  setSettleForm]  = useState({ date: todayStr(), amount: "", memo: "" });
  const [filterMonth, setFilterMonth] = useState(thisMonth());
  const [menuOpen,    setMenuOpen]    = useState(false);
  const [dragOver,    setDragOver]    = useState(false);
  const [saving,      setSaving]      = useState(false);
  const fileRef = useRef(null);

  /* 初期データ取得 */
  useEffect(() => {
    const load = async () => {
      try {
        const [exps, setts] = await Promise.all([
          api(`/api/expenses?userId=${session.userId}`, "GET", null, session.token),
          api(`/api/settlements?userId=${session.userId}`, "GET", null, session.token),
        ]);
        setExpenses(exps.items || []);
        setSettlements(setts.items || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [session]);

  /* ── 集計 ── */
  const totalExpenses  = expenses.reduce((s,e) => s + (e.amount||0), 0);
  const totalSettled   = settlements.reduce((s,r) => s + (r.amount||0), 0);
  const totalUnsettled = totalExpenses - totalSettled;

  const monthExpenses  = expenses.filter(e => !filterMonth || e.date?.startsWith(filterMonth));
  const monthTotal     = monthExpenses.reduce((s,e) => s + (e.amount||0), 0);
  const monthSettled   = settlements.filter(r => r.date?.startsWith(filterMonth)).reduce((s,r) => s + (r.amount||0), 0);

  /* ── フォーム ── */
  const fuelCalc = form.category === "fuel"
    ? calcFuel(Number(form.distance), Number(form.fuelEff), Number(form.fuelPrice)) : 0;

  const handleChange = useCallback((k,v) => {
    setForm(prev => {
      const next = { ...prev, [k]: v };
      if (next.category==="fuel" && ["distance","fuelEff","fuelPrice"].includes(k)) {
        const c = calcFuel(Number(next.distance),Number(next.fuelEff),Number(next.fuelPrice));
        if (c>0) next.amount = String(c);
      }
      return next;
    });
  }, []);

  const handleFiles = useCallback((files) => {
    Promise.all(Array.from(files).map(f => processFile(f)))
      .then(arr => {
        const valid = arr.filter(Boolean);
        const tooBig = arr.length - valid.length;
        if (tooBig > 0) alert(`${tooBig}件のファイルが大きすぎるため追加できませんでした（PDFは2MBまで）`);
        setForm(p => ({ ...p, files: [...p.files, ...valid] }));
      });
  }, []);

  /* ── API operations ── */
  const saveExpense = async () => {
    if (!form.date || !form.description || !form.amount) return;
    if (!checkPayloadSize(form)) { alert("添付ファイルの合計サイズが大きすぎます。写真を減らすか、PDFを小さくしてください。"); return; }
    setSaving(true);
    try {
      const item = await api("/api/expenses", "POST", {
        userId: session.userId,
        ...form,
        amount: Number(form.amount),
        distance: Number(form.distance) || 0,
      }, session.token);
      setExpenses(p => [item, ...p]);
      setForm(blankExpense());
      navigate("list");
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const updateExpense = async () => {
    if (!form.date || !form.description || !form.amount) return;
    if (!checkPayloadSize(form)) { alert("添付ファイルの合計サイズが大きすぎます。写真を減らすか、PDFを小さくしてください。"); return; }
    setSaving(true);
    try {
      const updated = await api(
        `/api/expenses/${selectedId}`,
        "PUT",
        { ...form, amount: Number(form.amount), distance: Number(form.distance) || 0 },
        session.token
      );
      setExpenses(p => p.map(e => e.id === selectedId ? updated : e));
      setForm(blankExpense());
      navigate("detail", selectedId);
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const deleteExpense = async (id) => {
    try {
      await api(`/api/expenses/${id}`, "DELETE", null, session.token);
      setExpenses(p => p.filter(e => e.id !== id));
      navigate("list");
    } catch(e) { alert(e.message); }
  };

  const saveSettle = async () => {
    if (!settleForm.date || !settleForm.amount) return;
    setSaving(true);
    try {
      const item = await api("/api/settlements", "POST", {
        userId: session.userId,
        ...settleForm,
        amount: Number(settleForm.amount),
      }, session.token);
      setSettlements(p => [item, ...p]);
      setSettleForm({ date: todayStr(), amount: "", memo: "" });
      navigate("list");
    } catch(e) { alert(e.message); }
    finally { setSaving(false); }
  };

  const deleteSettle = async (id) => {
    try {
      await api(`/api/settlements/${id}`, "DELETE", null, session.token);
      setSettlements(p => p.filter(r => r.id !== id));
    } catch(e) { alert(e.message); }
  };

  const navigate = (v, id) => {
    setView(v);
    if (id !== undefined) setSelectedId(id);
    setMenuOpen(false);
  };

  /* ── PDF ── */
  const printPDF = () => {
    generatePDF({
      monthExpenses,
      monthTotal,
      monthSettled,
      filterMonth,
      settlements,
      displayName: session.displayName || session.userId,
    });
  };

  const selectedExp = expenses.find(e => e.id === selectedId);

  if (loading) {
    return (
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#FFFAF7", flexDirection:"column", gap:12 }}>
        <div style={{ fontSize:32 }}>💴</div>
        <div style={{ color:"#94A3B8", fontSize:14 }}>読み込み中...</div>
      </div>
    );
  }

  return (
    <div style={S.root}>

      {/* Header */}
      <header style={S.header}>
        <div style={S.headerLeft}>
          <button style={S.menuBtn} onClick={() => setMenuOpen(p=>!p)}>{menuOpen?"✕":"☰"}</button>
          <span style={S.headerTitle}>💴 簡単精算くん</span>
        </div>
        <div style={S.headerBadge}>
          未精算<span style={S.badgeAmt}>{fmt(totalUnsettled)}</span>
        </div>
      </header>

      {/* Drawer */}
      {menuOpen && (
        <div style={S.overlay} onClick={() => setMenuOpen(false)}>
          <div style={S.drawer} onClick={e => e.stopPropagation()}>
            <div style={S.drawerUser}>
              <div style={S.drawerUserIcon}>👤</div>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:"#1E293B" }}>{session.displayName || session.userId}</div>
                <div style={{ fontSize:11, color:"#94A3B8" }}>{session.userId}</div>
              </div>
            </div>
            <div style={S.drawerDivider} />
            {[
              { icon:"📋", label:"一覧",     action:() => navigate("list") },
              { icon:"＋", label:"経費を登録", action:() => { setForm(blankExpense()); navigate("newExp"); } },
              { icon:"✅", label:"精算を記録", action:() => navigate("newSettle") },
              { icon:"📄", label:"PDF出力",   action:() => navigate("pdf") },
            ].map(item => (
              <button key={item.label} style={S.drawerItem} onClick={item.action}>
                <span style={{ fontSize:16 }}>{item.icon}</span> {item.label}
              </button>
            ))}
            <div style={S.drawerDivider} />
            {[
              { label:"経費合計", val:fmt(totalExpenses),  color:"#F97316" },
              { label:"精算済み", val:fmt(totalSettled),   color:"#10B981" },
              { label:"未精算残", val:fmt(totalUnsettled), color:"#EF4444" },
            ].map(r => (
              <div key={r.label} style={S.drawerStat}>
                <span>{r.label}</span><span style={{ fontWeight:700, color:r.color }}>{r.val}</span>
              </div>
            ))}
            <div style={S.drawerDivider} />
            <div style={S.drawerMonthLabel}>月別集計</div>
            {(() => {
              const ms={};
              expenses.forEach(e => { const m=e.date?.slice(0,7); if(m) ms[m]=(ms[m]||0)+e.amount; });
              return Object.entries(ms).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,6).map(([m,t]) => (
                <div key={m} style={S.drawerStat}>
                  <span style={{fontSize:12}}>{m.replace("-","年")}月</span>
                  <span style={{fontSize:12,fontWeight:600}}>{fmt(t)}</span>
                </div>
              ));
            })()}
            <div style={S.drawerDivider} />
            <button style={S.logoutBtn} onClick={onLogout}>ログアウト</button>
          </div>
        </div>
      )}

      {/* Main */}
      <main style={S.main}>
        {view==="list" && (
          <ListView
            expenses={monthExpenses}
            settlements={settlements.filter(r=>r.date?.startsWith(filterMonth))}
            filterMonth={filterMonth}
            setFilterMonth={setFilterMonth}
            monthTotal={monthTotal}
            monthSettled={monthSettled}
            onSelectExp={id=>navigate("detail",id)}
            onDeleteSettle={deleteSettle}
            onNewExp={() => { setForm(blankExpense()); navigate("newExp"); }}
            onNewSettle={() => navigate("newSettle")}
          />
        )}
        {view==="newExp" && (
          <ExpenseForm
            form={form} onChange={handleChange} fuelCalc={fuelCalc}
            onSave={saveExpense} onCancel={() => navigate("list")}
            saving={saving}
            dragOver={dragOver} setDragOver={setDragOver}
            onDrop={e=>{ e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            onFiles={handleFiles} fileRef={fileRef}
            removeFile={i => setForm(p=>({ ...p, files:p.files.filter((_,j)=>j!==i) }))}
          />
        )}
        {view==="newSettle" && (
          <SettleForm
            form={settleForm}
            onChange={(k,v) => setSettleForm(p=>({...p,[k]:v}))}
            onSave={saveSettle} onCancel={() => navigate("list")}
            saving={saving} unsettled={totalUnsettled}
          />
        )}
        {view==="editExp" && selectedExp && (
          <ExpenseForm
            form={form} onChange={handleChange} fuelCalc={fuelCalc}
            onSave={updateExpense} onCancel={() => navigate("detail", selectedId)}
            saving={saving} isEdit={true}
            dragOver={dragOver} setDragOver={setDragOver}
            onDrop={e=>{ e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            onFiles={handleFiles} fileRef={fileRef}
            removeFile={i => setForm(p=>({ ...p, files:p.files.filter((_,j)=>j!==i) }))}
          />
        )}
        {view==="detail" && selectedExp && (
          <DetailView
            expense={selectedExp}
            onBack={() => navigate("list")}
            onDelete={deleteExpense}
            onEdit={() => {
              setForm({
                ...selectedExp,
                amount: String(selectedExp.amount),
                distance: String(selectedExp.distance || ""),
                fuelEff: selectedExp.fuelEff || String(15),
                fuelPrice: selectedExp.fuelPrice || String(165),
                files: selectedExp.files || [],
              });
              navigate("editExp", selectedExp.id);
            }}
          />
        )}
        {view==="pdf" && (
          <PDFView
            filterMonth={filterMonth} setFilterMonth={setFilterMonth}
            onPrint={printPDF} onBack={() => navigate("list")}
            monthExpenses={monthExpenses} monthTotal={monthTotal} monthSettled={monthSettled}
          />
        )}
      </main>

      {view==="list" && (
        <button style={S.fab} onClick={() => { setForm(blankExpense()); navigate("newExp"); }}>＋</button>
      )}
    </div>
  );
}

/* ═══ LIST VIEW ═══ */
function ListView({ expenses, settlements, filterMonth, setFilterMonth, monthTotal, monthSettled, onSelectExp, onDeleteSettle, onNewExp, onNewSettle }) {
  const monthUnsettled = monthTotal - monthSettled;
  return (
    <div>
      <div style={S.filterRow}>
        <input type="month" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={S.monthInput} />
        <button style={S.outlineBtn} onClick={() => setFilterMonth("")}>全期間</button>
      </div>
      <div style={S.summaryRow}>
        <SumCard label="経費計" val={fmt(monthTotal)}     color="#F97316" />
        <SumCard label="精算済" val={fmt(monthSettled)}   color="#10B981" />
        <SumCard label="未精算" val={fmt(monthUnsettled)} color="#EF4444" />
      </div>
      <SecTitle title="経費一覧" action={{ label:"＋ 登録", fn:onNewExp }} />
      {expenses.length===0 ? <Empty text="経費データなし" /> : expenses.map(e => {
        const cat=getCat(e.category);
        return (
          <button key={e.id} style={S.card} onClick={() => onSelectExp(e.id)}>
            <div style={{...S.cardLine, background:cat.color}} />
            <div style={S.cardBody}>
              <div style={S.cardDesc}>{e.description}</div>
              <div style={S.cardMeta}>
                <span style={{...S.badge, background:cat.color+"20", color:cat.color}}>{cat.icon} {cat.label}</span>
                {e.from&&e.to && <span style={S.grayBadge}>{e.from}→{e.to}</span>}
                {e.files?.length>0 && <span style={S.grayBadge}>📎{e.files.length}</span>}
              </div>
            </div>
            <div style={S.cardRight}>
              <div style={S.cardAmt}>{fmt(e.amount)}</div>
              <div style={S.cardDate}>{fmtDate(e.date)}</div>
            </div>
          </button>
        );
      })}
      <SecTitle title="精算記録" action={{ label:"＋ 記録", fn:onNewSettle }} />
      {settlements.length===0 ? <Empty text="精算記録なし" /> : settlements.map(r => (
        <div key={r.id} style={S.settleCard}>
          <div style={S.settleLeft}>
            <div style={S.settleAmt}>{fmt(r.amount)}</div>
            <div style={S.settleDate}>{fmtDate(r.date)}{r.memo ? ` — ${r.memo}` : ""}</div>
          </div>
          <button style={S.delBtn} onClick={() => onDeleteSettle(r.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

function SumCard({label,val,color}) {
  return (
    <div style={{...S.sumCard, borderColor:color+"44"}}>
      <div style={{...S.sumLabel,color}}>{label}</div>
      <div style={{...S.sumVal,color}}>{val}</div>
    </div>
  );
}
function SecTitle({title,action}) {
  return (
    <div style={S.secTitle}>
      <span>{title}</span>
      {action && <button style={S.inlineBtn} onClick={action.fn}>{action.label}</button>}
    </div>
  );
}
function Empty({text}) { return <div style={S.empty}>{text}</div>; }

/* ═══ EXPENSE FORM ═══ */
function ExpenseForm({ form, onChange, fuelCalc, onSave, onCancel, saving, isEdit, dragOver, setDragOver, onDrop, onFiles, fileRef, removeFile }) {
  const isFuel = form.category==="fuel";
  const valid  = form.date && form.description && form.amount;
  return (
    <div>
      <PageHeader title={isEdit ? "経費を編集" : "経費を登録"} onBack={onCancel} />
      <Field label="日付 *">
        <input type="date" value={form.date} onChange={e=>onChange("date",e.target.value)} style={S.input} />
      </Field>
      <Field label="カテゴリ">
        <div style={S.catGrid}>
          {CATEGORIES.map(cat => (
            <button key={cat.id} style={{...S.catChip,...(form.category===cat.id?{background:cat.color,color:"#fff",borderColor:cat.color}:{})}} onClick={() => onChange("category",cat.id)}>
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>
      </Field>
      {isFuel && (
        <div style={S.fuelBox}>
          <div style={S.fuelTitle}>⛽ ガソリン代計算</div>
          <div style={S.twoCol}>
            <Field label="出発地"><input placeholder="博多駅" value={form.from} onChange={e=>onChange("from",e.target.value)} style={S.input} /></Field>
            <Field label="目的地"><input placeholder="天神"   value={form.to}   onChange={e=>onChange("to",e.target.value)}   style={S.input} /></Field>
          </div>
          <div style={S.threeCol}>
            <Field label="距離(km)"><input type="number" placeholder="0" value={form.distance}  onChange={e=>onChange("distance",e.target.value)}  style={S.input} min="0" /></Field>
            <Field label="燃費(km/L)"><input type="number" value={form.fuelEff}   onChange={e=>onChange("fuelEff",e.target.value)}   style={S.input} min="1" /></Field>
            <Field label="単価(円/L)"><input type="number" value={form.fuelPrice} onChange={e=>onChange("fuelPrice",e.target.value)} style={S.input} min="1" /></Field>
          </div>
          {fuelCalc>0 && (
            <div style={S.fuelResult}>
              <span style={S.fuelLabel}>計算結果</span>
              <span style={S.fuelAmt}>{fmt(fuelCalc)}</span>
              <span style={S.fuelNote}>{form.distance}km ÷ {form.fuelEff}km/L × ¥{form.fuelPrice}</span>
            </div>
          )}
        </div>
      )}
      <Field label={`内容・摘要 *`}>
        <input placeholder={isFuel?"現場往復ガソリン代":"〇〇社との打ち合わせ交通費"} value={form.description} onChange={e=>onChange("description",e.target.value)} style={S.input} />
      </Field>
      <Field label={`金額（円）*${isFuel&&fuelCalc>0?" ← 自動入力済（変更可）":""}`}>
        <div style={{position:"relative"}}>
          <span style={S.yen}>¥</span>
          <input type="number" placeholder="0" value={form.amount} onChange={e=>onChange("amount",e.target.value)} style={{...S.input,paddingLeft:28}} min="0" />
        </div>
      </Field>
      <Field label="備考">
        <textarea placeholder="補足事項" value={form.memo} onChange={e=>onChange("memo",e.target.value)} style={S.textarea} rows={2} />
      </Field>
      <Field label="添付（領収書・写真・PDF）">
        <div style={{...S.dropZone,...(dragOver?S.dropOn:{})}} onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={onDrop} onClick={()=>fileRef.current?.click()}>
          <div style={{fontSize:24,marginBottom:4}}>📎</div>
          <div style={{fontSize:13,color:"#94A3B8"}}>タップまたはドロップ</div>
          <input ref={fileRef} type="file" multiple accept="image/*,.pdf" style={{display:"none"}} onChange={e=>onFiles(e.target.files)} />
        </div>
        {form.files.length>0 && (
          <div style={S.fileRow}>
            {form.files.map((f,i) => (
              <div key={i} style={{position:"relative"}}>
                {f.type.startsWith("image/") ? <img src={f.data} alt={f.name} style={S.thumb} /> : <div style={S.pdfThumb}>PDF</div>}
                <button style={S.fileX} onClick={()=>removeFile(i)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Field>
      <div style={S.formBtns}>
        <button style={S.cancelBtn} onClick={onCancel}>キャンセル</button>
        <button style={{...S.saveBtn,...(valid?{}:S.saveBtnOff)}} onClick={onSave} disabled={!valid||saving}>
          {saving ? "保存中..." : isEdit ? "更新する" : "登録する"}
        </button>
      </div>
    </div>
  );
}

/* ═══ SETTLE FORM ═══ */
function SettleForm({ form, onChange, onSave, onCancel, saving, unsettled }) {
  const valid = form.date && form.amount;
  return (
    <div>
      <PageHeader title="精算を記録" onBack={onCancel} />
      <div style={S.infoBox}>現在の未精算残高: <strong style={{color:"#EF4444"}}>{fmt(unsettled)}</strong></div>
      <Field label="精算日 *">
        <input type="date" value={form.date} onChange={e=>onChange("date",e.target.value)} style={S.input} />
      </Field>
      <Field label="精算金額（円）*">
        <div style={{position:"relative"}}>
          <span style={S.yen}>¥</span>
          <input type="number" placeholder="0" value={form.amount} onChange={e=>onChange("amount",e.target.value)} style={{...S.input,paddingLeft:28}} min="0" />
        </div>
      </Field>
      <Field label="備考">
        <input placeholder="例：振込にて精算" value={form.memo} onChange={e=>onChange("memo",e.target.value)} style={S.input} />
      </Field>
      <div style={S.formBtns}>
        <button style={S.cancelBtn} onClick={onCancel}>キャンセル</button>
        <button style={{...S.saveBtn,...(valid?{}:S.saveBtnOff)}} onClick={onSave} disabled={!valid||saving}>
          {saving?"保存中...":"記録する"}
        </button>
      </div>
    </div>
  );
}

/* ═══ DETAIL VIEW ═══ */
function DetailView({ expense, onBack, onDelete, onEdit }) {
  const cat = getCat(expense.category);
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState(null);

  const openFile = (f) => {
    if (f.type.startsWith("image/")) {
      setPreview(f);
    } else {
      const w = window.open();
      if (w) w.document.write(`<iframe src="${f.data}" style="border:0;width:100vw;height:100vh"></iframe>`);
    }
  };

  return (
    <div>
      <PageHeader
        title="経費詳細"
        onBack={onBack}
        rightBtn={
          <div style={{display:"flex",gap:10}}>
            <button style={S.editBtn} onClick={onEdit}>編集</button>
            <button style={S.redBtn} onClick={()=>setConfirm(true)}>削除</button>
          </div>
        }
      />
      <div style={{...S.detailTop, borderLeftColor:cat.color}}>
        <div style={{fontSize:13,color:cat.color,marginBottom:2}}>{cat.icon} {cat.label}</div>
        <div style={S.detailDesc}>{expense.description}</div>
        <div style={S.detailAmt}>{fmt(expense.amount)}</div>
      </div>
      <div style={S.detailGrid}>
        <DR label="日付" value={fmtDate(expense.date)} />
        {expense.from    && <DR label="出発地"   value={expense.from} />}
        {expense.to      && <DR label="目的地"   value={expense.to} />}
        {expense.distance>0 && <DR label="走行距離" value={`${expense.distance} km`} />}
        {expense.memo    && <DR label="備考"     value={expense.memo} />}
      </div>
      {expense.files?.length>0 && (
        <div style={{marginTop:16}}>
          <div style={{fontSize:12,fontWeight:700,color:"#64748B",marginBottom:8}}>添付ファイル</div>
          <div style={S.fileRow}>
            {expense.files.map((f,i) => (
              <div key={i} onClick={() => openFile(f)} style={{cursor:"pointer"}}>
                {f.type.startsWith("image/")
                  ? <div style={{position:"relative"}}>
                      <img src={f.data} alt={f.name} style={S.thumbLg} />
                      <div style={S.zoomBadge}>⤢</div>
                    </div>
                  : <div style={S.pdfThumbLg}>PDF<br/><span style={{fontSize:9}}>{f.name}</span></div>}
              </div>
            ))}
          </div>
        </div>
      )}
      {preview && (
        <div style={S.previewOverlay} onClick={() => setPreview(null)}>
          <button style={S.previewClose} onClick={() => setPreview(null)}>✕</button>
          <img src={preview.data} alt={preview.name} style={S.previewImg} onClick={e => e.stopPropagation()} />
        </div>
      )}
      {confirm && (
        <div style={S.overlayFixed} onClick={()=>setConfirm(false)}>
          <div style={S.dialog} onClick={e=>e.stopPropagation()}>
            <div style={S.dialogTitle}>削除の確認</div>
            <div style={S.dialogText}>「{expense.description}」を削除しますか？</div>
            <div style={S.dialogBtns}>
              <button style={S.cancelBtn} onClick={()=>setConfirm(false)}>キャンセル</button>
              <button style={{...S.saveBtn,background:"#EF4444"}} onClick={()=>onDelete(expense.id)}>削除する</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function DR({label,value}) {
  return (
    <div style={S.detailRow}>
      <span style={S.detailLabel}>{label}</span>
      <span style={S.detailValue}>{value}</span>
    </div>
  );
}

/* ═══ PDF VIEW ═══ */
function PDFView({ filterMonth, setFilterMonth, onPrint, onBack, monthExpenses, monthTotal, monthSettled }) {
  return (
    <div>
      <PageHeader title="PDF出力" onBack={onBack} />
      <div style={S.infoBox}>対象月を選んで「PDF印刷」→ ブラウザの印刷ダイアログで「PDFに保存」を選択してください。</div>
      <Field label="対象月">
        <input type="month" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={S.input} />
      </Field>
      <div style={S.summaryRow}>
        <SumCard label="経費計" val={fmt(monthTotal)} color="#F97316" />
        <SumCard label="精算済" val={fmt(monthSettled)} color="#10B981" />
        <SumCard label="未精算" val={fmt(monthTotal-monthSettled)} color="#EF4444" />
      </div>
      <div style={{margin:"8px 0 16px",color:"#64748B",fontSize:13}}>{monthExpenses.length}件が対象</div>
      <button style={S.printBtn} onClick={onPrint}>📄 PDFをダウンロード</button>
    </div>
  );
}

/* ═══ 小コンポーネント ═══ */
function PageHeader({title,onBack,rightBtn}) {
  return (
    <div style={S.pageHeader}>
      <button style={S.backBtn} onClick={onBack}>← 戻る</button>
      <span style={S.pageTitle}>{title}</span>
      {rightBtn || <span style={{width:48}} />}
    </div>
  );
}
function Field({label,children}) {
  return <div style={S.field}><label style={S.fieldLabel}>{label}</label>{children}</div>;
}

/* ═══ STYLES ═══ */
const S = {
  root: { minHeight:"100vh", background:"#FFFAF7", fontFamily:"-apple-system,'Hiragino Sans','Meiryo',sans-serif", color:"#1E293B", paddingBottom:80 },
  header: { position:"sticky", top:0, zIndex:50, background:"#fff", borderBottom:"2px solid #F97316", padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between" },
  headerLeft: { display:"flex", alignItems:"center", gap:12 },
  menuBtn: { background:"none", border:"none", fontSize:22, cursor:"pointer", color:"#F97316", padding:"0 4px", lineHeight:1 },
  headerTitle: { fontSize:17, fontWeight:700, color:"#1E293B" },
  headerBadge: { fontSize:11, color:"#94A3B8", display:"flex", flexDirection:"column", alignItems:"flex-end", gap:1 },
  badgeAmt: { fontSize:14, fontWeight:700, color:"#EF4444" },
  overlay: { position:"fixed", inset:0, background:"#00000055", zIndex:200, display:"flex" },
  drawer: { background:"#fff", width:260, maxWidth:"80vw", height:"100%", overflowY:"auto", padding:"0 0 32px", boxShadow:"2px 0 16px #0002" },
  drawerUser: { display:"flex", alignItems:"center", gap:12, padding:"20px 16px 16px", borderBottom:"1px solid #F1F5F9" },
  drawerUserIcon: { fontSize:28, background:"#FFF7ED", borderRadius:"50%", width:40, height:40, display:"flex", alignItems:"center", justifyContent:"center" },
  drawerDivider: { height:1, background:"#F1F5F9", margin:"8px 0" },
  drawerItem: { display:"flex", width:"100%", background:"none", border:"none", textAlign:"left", padding:"13px 20px", fontSize:15, cursor:"pointer", color:"#1E293B", alignItems:"center", gap:10 },
  drawerStat: { display:"flex", justifyContent:"space-between", padding:"6px 20px", fontSize:13, color:"#475569" },
  drawerMonthLabel: { fontSize:11, fontWeight:700, color:"#94A3B8", padding:"8px 20px 4px", letterSpacing:"0.06em" },
  logoutBtn: { display:"block", width:"calc(100% - 32px)", margin:"8px 16px 0", background:"none", border:"1px solid #E2E8F0", borderRadius:8, color:"#94A3B8", padding:"10px", fontSize:13, cursor:"pointer" },
  main: { padding:"16px 16px 0" },
  filterRow: { display:"flex", gap:8, marginBottom:14, alignItems:"center" },
  monthInput: { flex:1, background:"#fff", border:"1px solid #E2E8F0", borderRadius:8, padding:"9px 12px", fontSize:14, color:"#1E293B", outline:"none" },
  outlineBtn: { background:"none", border:"1px solid #E2E8F0", borderRadius:8, padding:"9px 14px", fontSize:13, color:"#64748B", cursor:"pointer" },
  summaryRow: { display:"flex", gap:8, marginBottom:16 },
  sumCard: { flex:1, background:"#fff", border:"1.5px solid", borderRadius:10, padding:"10px 8px", textAlign:"center" },
  sumLabel: { fontSize:10, fontWeight:700, marginBottom:3 },
  sumVal: { fontSize:14, fontWeight:800, fontVariantNumeric:"tabular-nums" },
  secTitle: { display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:13, fontWeight:700, color:"#64748B", marginBottom:8, marginTop:4, paddingBottom:4, borderBottom:"1px solid #F1F5F9" },
  inlineBtn: { background:"#FFF7ED", border:"1px solid #FED7AA", borderRadius:6, color:"#F97316", padding:"4px 10px", fontSize:12, fontWeight:600, cursor:"pointer" },
  card: { display:"flex", alignItems:"center", background:"#fff", border:"1px solid #F1F5F9", borderRadius:10, padding:"12px", marginBottom:8, width:"100%", textAlign:"left", cursor:"pointer", gap:10, boxShadow:"0 1px 3px #0000000a" },
  cardLine: { width:4, minWidth:4, height:42, borderRadius:2 },
  cardBody: { flex:1, minWidth:0 },
  cardDesc: { fontSize:14, fontWeight:600, color:"#1E293B", marginBottom:5 },
  cardMeta: { display:"flex", gap:5, flexWrap:"wrap" },
  badge: { fontSize:11, fontWeight:600, padding:"2px 7px", borderRadius:4 },
  grayBadge: { fontSize:11, color:"#94A3B8", background:"#F8FAFC", border:"1px solid #E2E8F0", padding:"2px 7px", borderRadius:4 },
  cardRight: { textAlign:"right" },
  cardAmt: { fontSize:15, fontWeight:700, color:"#F97316", fontVariantNumeric:"tabular-nums" },
  cardDate: { fontSize:11, color:"#94A3B8", marginTop:2 },
  settleCard: { display:"flex", alignItems:"center", background:"#F0FDF4", border:"1px solid #BBF7D0", borderRadius:10, padding:"10px 14px", marginBottom:8, gap:12 },
  settleLeft: { flex:1 },
  settleAmt: { fontSize:15, fontWeight:700, color:"#10B981", fontVariantNumeric:"tabular-nums" },
  settleDate: { fontSize:12, color:"#64748B", marginTop:2 },
  delBtn: { background:"none", border:"none", color:"#94A3B8", fontSize:16, cursor:"pointer", padding:"0 4px" },
  empty: { color:"#94A3B8", fontSize:13, padding:"14px 4px", textAlign:"center" },
  pageHeader: { display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 },
  pageTitle: { fontSize:16, fontWeight:700 },
  backBtn: { background:"none", border:"none", color:"#F97316", fontSize:14, cursor:"pointer", padding:0 },
  editBtn: { background:"#FFF7ED", border:"1px solid #FED7AA", borderRadius:6, color:"#F97316", fontSize:13, fontWeight:600, cursor:"pointer", padding:"4px 12px" },
  redBtn: { background:"none", border:"none", color:"#EF4444", fontSize:13, cursor:"pointer", padding:0 },
  field: { marginBottom:16 },
  fieldLabel: { display:"block", fontSize:12, fontWeight:600, color:"#64748B", marginBottom:5 },
  input: { width:"100%", background:"#fff", border:"1px solid #E2E8F0", borderRadius:8, padding:"10px 12px", fontSize:14, color:"#1E293B", outline:"none", boxSizing:"border-box" },
  textarea: { width:"100%", background:"#fff", border:"1px solid #E2E8F0", borderRadius:8, padding:"10px 12px", fontSize:14, color:"#1E293B", outline:"none", resize:"vertical", fontFamily:"inherit", boxSizing:"border-box" },
  catGrid: { display:"flex", flexWrap:"wrap", gap:7 },
  catChip: { background:"#F8FAFC", border:"1px solid #E2E8F0", borderRadius:7, color:"#475569", padding:"6px 11px", fontSize:12, cursor:"pointer" },
  fuelBox: { background:"#FFF7ED", border:"1px solid #FED7AA", borderRadius:10, padding:14, marginBottom:16 },
  fuelTitle: { fontSize:13, fontWeight:700, color:"#F97316", marginBottom:12 },
  twoCol: { display:"flex", gap:10 },
  threeCol: { display:"flex", gap:8, flexWrap:"wrap" },
  fuelResult: { background:"#fff", border:"1px solid #FED7AA", borderRadius:8, padding:"10px 14px", display:"flex", alignItems:"center", gap:10, marginTop:4, flexWrap:"wrap" },
  fuelLabel: { fontSize:11, color:"#F97316", fontWeight:700 },
  fuelAmt: { fontSize:20, fontWeight:800, color:"#F97316", fontVariantNumeric:"tabular-nums" },
  fuelNote: { fontSize:11, color:"#94A3B8", marginLeft:"auto" },
  yen: { position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"#94A3B8", fontWeight:700, pointerEvents:"none", fontSize:14 },
  dropZone: { border:"2px dashed #E2E8F0", borderRadius:10, padding:22, textAlign:"center", cursor:"pointer", background:"#F8FAFC" },
  dropOn: { borderColor:"#F97316", background:"#FFF7ED" },
  fileRow: { display:"flex", flexWrap:"wrap", gap:8, marginTop:10 },
  thumb: { width:56, height:56, objectFit:"cover", borderRadius:6, display:"block" },
  thumbLg: { width:100, height:100, objectFit:"cover", borderRadius:8, display:"block" },
  zoomBadge: { position:"absolute", bottom:4, right:4, background:"#000000aa", color:"#fff", borderRadius:4, fontSize:12, width:20, height:20, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" },
  previewOverlay: { position:"fixed", inset:0, background:"#000000ee", display:"flex", alignItems:"center", justifyContent:"center", zIndex:500, padding:16 },
  previewClose: { position:"fixed", top:16, right:16, background:"#ffffff22", border:"none", color:"#fff", fontSize:22, width:44, height:44, borderRadius:"50%", cursor:"pointer", zIndex:510, display:"flex", alignItems:"center", justifyContent:"center" },
  previewImg: { maxWidth:"100%", maxHeight:"100%", objectFit:"contain", borderRadius:8 },
  pdfThumb: { width:56, height:56, background:"#FEE2E2", color:"#EF4444", borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700 },
  pdfThumbLg: { width:100, height:100, background:"#FEE2E2", color:"#EF4444", borderRadius:8, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, textAlign:"center", padding:6 },
  fileX: { position:"absolute", top:-6, right:-6, background:"#EF4444", color:"#fff", border:"none", borderRadius:"50%", width:18, height:18, fontSize:9, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0 },
  formBtns: { display:"flex", gap:10, marginTop:24, justifyContent:"flex-end" },
  cancelBtn: { background:"#F8FAFC", border:"1px solid #E2E8F0", borderRadius:8, color:"#64748B", padding:"11px 20px", fontSize:14, cursor:"pointer" },
  saveBtn: { background:"#F97316", border:"none", borderRadius:8, color:"#fff", padding:"11px 24px", fontSize:14, fontWeight:700, cursor:"pointer" },
  saveBtnOff: { opacity:0.4, cursor:"not-allowed" },
  infoBox: { background:"#FFF7ED", border:"1px solid #FED7AA", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#7C3800", marginBottom:16, lineHeight:1.6 },
  printBtn: { display:"block", width:"100%", background:"#F97316", border:"none", borderRadius:10, color:"#fff", padding:15, fontSize:16, fontWeight:700, cursor:"pointer", textAlign:"center" },
  fab: { position:"fixed", bottom:24, right:20, width:56, height:56, borderRadius:"50%", background:"#F97316", color:"#fff", border:"none", fontSize:28, lineHeight:1, cursor:"pointer", boxShadow:"0 4px 14px #F9731644", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 },
  detailTop: { background:"#fff", border:"1px solid #F1F5F9", borderLeft:"4px solid", borderRadius:10, padding:16, marginBottom:16, boxShadow:"0 1px 3px #0000000a" },
  detailDesc: { fontSize:17, fontWeight:700, color:"#1E293B", margin:"4px 0 8px" },
  detailAmt: { fontSize:26, fontWeight:800, color:"#F97316", fontVariantNumeric:"tabular-nums" },
  detailGrid: { background:"#fff", border:"1px solid #F1F5F9", borderRadius:10, overflow:"hidden", marginBottom:16 },
  detailRow: { display:"flex", gap:16, padding:"11px 16px", borderBottom:"1px solid #F8FAFC" },
  detailLabel: { fontSize:12, color:"#94A3B8", minWidth:72 },
  detailValue: { fontSize:14, color:"#1E293B", flex:1 },
  overlayFixed: { position:"fixed", inset:0, background:"#00000066", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 },
  dialog: { background:"#fff", border:"1px solid #E2E8F0", borderRadius:14, padding:"24px 20px", width:"90%", maxWidth:340 },
  dialogTitle: { fontSize:17, fontWeight:700, marginBottom:8 },
  dialogText: { fontSize:14, color:"#64748B", marginBottom:20 },
  dialogBtns: { display:"flex", gap:10, justifyContent:"flex-end" },
};
