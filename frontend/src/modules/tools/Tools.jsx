import { useEffect, useMemo, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import { useData } from "../../data.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import PeoplePicker from "../../components/PeoplePicker.jsx";
import { Callout, CardSkeleton, ListSkeleton, PageSkeleton, Pill, SectionHead, ViewTabs } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";

/*
 * Manage > Tools & cost. Every paid tool (AI assistants and the rest), who has a seat, and what it costs each month.
 * "Tool access" manages; "See finance reports" sees the cost read-only. Rupees and dollars are always totalled apart.
 * Claude is connected: its seats are given and removed from the person's page, through Claude itself. API: backend/src/tools.js.
 */
const SYM = { INR: "₹", USD: "$" };
const money = (minor, cur) => (minor == null ? "" : `${SYM[cur] || ""}${(minor / 100).toLocaleString(cur === "INR" ? "en-IN" : "en-US", { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`);
const both = (bag) => ["INR", "USD"].filter((c) => bag && bag[c]).map((c) => money(bag[c], c)).join(" + ") || "—";
const thisMonth = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const TH = "border-b border-line px-4 py-3 text-left text-[13px] font-bold text-ink-dim";
const TD = "border-b border-line px-4 py-3 align-middle text-[15px] text-ink";

export default function Tools() {
  const { canAll } = useAuth();
  const manage = canAll("tools.manage"), cost = manage || canAll("finance.view");
  const [list, setList] = useState(null), [costs, setCosts] = useState(null), [month, setMonth] = useState(thisMonth());
  const [err, setErr] = useState(""), [view, setView] = useState("tools"), [dlg, setDlg] = useState(null);
  const loadList = async () => { const r = await api("GET", "/api/tools"); if (r.ok) setList(r.data); else setErr(apiMsg(r)); };
  const loadCosts = async (m = month) => { if (!cost) return; const r = await api("GET", `/api/tools/costs?month=${m}`); if (r.ok) setCosts(r.data); else setErr(apiMsg(r)); };
  useEffect(() => { loadList(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCosts(null); loadCosts(month); }, [month]);   // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => { loadList(); loadCosts(); };

  if (!cost) return <section className="section"><SectionHead title="Tools & cost" /><div className="card"><div className="empty">You do not have access to this page. Please ask a super admin if you need it.</div></div></section>;
  if (!list) return <PageSkeleton />;
  const byTool = new Map((costs ? costs.tools : []).map((t) => [t.slug, t]));
  const missing = (costs ? costs.tools : []).filter((t) => t.priceMissing);
  return (
    <section className="section">
      <SectionHead title="Tools & cost" sub="Every paid tool, who has a seat and what it costs each month. Rupees and dollars are totalled separately."
        actions={manage ? <button type="button" className="btn primary" onClick={() => setDlg({ kind: "tool", tool: null })}>Add a tool</button> : null}
        tabs={<ViewTabs label="Tools" view={view} onView={setView} views={[["tools", "Tools"], ["bills", "Monthly bills"], ["teams", "By department"]]} />} />
      {err && <Callout>{err}</Callout>}
      <div className="flex flex-wrap items-end gap-4">
        <Field id="tc-month" label="Month"><input id="tc-month" type="month" className="input" max={thisMonth()} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>
      </div>
      {!costs ? <CardSkeleton lines={2} /> : (
        <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
          <Tile label="In rupees" value={money(costs.totals.INR || 0, "INR")} sub={`${monthName(costs.month)}, seats and bills`} />
          <Tile label="In dollars" value={money(costs.totals.USD || 0, "USD")} sub={`${monthName(costs.month)}, seats and bills`} />
          <Tile label="Paid seats" value={costs.tools.reduce((n, t) => n + t.paidSeats, 0)} sub={`${costs.tools.reduce((n, t) => n + t.waitingSeats, 0)} waiting to be accepted`} />
          <Tile label="Tools without a price" value={missing.length} sub={missing.length ? missing.map((t) => t.name).join(", ") : "Every seat has a price"} warn={missing.length > 0} />
        </div>)}
      {view === "tools" && (
        <div className="card overflow-hidden p-0"><div className="relative overflow-x-auto"><table className="w-full border-collapse">
          <thead><tr><th className={TH}>Tool</th><th className={TH}>Price per seat</th><th className={TH}>Seats</th><th className={TH}>This month</th><th className={TH}><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{list.tools.map((t) => { const c = byTool.get(t.slug); return (
            <tr key={t.slug} className={t.active ? "" : "opacity-60"}>
              <td className={TD}><b className="block font-display text-[16px] font-medium text-heading">{t.name}</b>
                <span className="text-[13.5px] text-ink-dim">{[t.vendor, list.categories[t.category], t.connected ? "connected" : null, t.active ? null : "not in use"].filter(Boolean).join(" · ")}</span></td>
              <td className={TD}>{t.billing === "free" ? "Free" : t.billing === "usage" ? "By usage" : t.seatCostMinor == null ? <Pill tone="warn">Not set</Pill> : `${money(t.seatCostMinor, t.currency)} a month`}</td>
              <td className={TD}>{t.seats ? <>{t.seats.paid}{t.seats.waiting ? <span className="text-[13.5px] text-ink-dim"> (+{t.seats.waiting} waiting)</span> : null}</> : "—"}</td>
              <td className={TD}>{c ? both({ [t.currency]: c.seatTotalMinor, ...Object.fromEntries(Object.entries(c.billsMinor).map(([k, v]) => [k, (k === t.currency ? c.seatTotalMinor : 0) + v])) }) : <span className="inline-block w-20"><ListSkeleton rows={1} faces={false} /></span>}</td>
              <td className={`${TD} whitespace-nowrap text-right`}>
                {manage && <><button type="button" className="btn glass sm" onClick={() => setDlg({ kind: "seats", tool: t })}>People</button>{" "}
                  <button type="button" className="btn glass sm" onClick={() => setDlg({ kind: "bill", tool: t })}>Add bill</button>{" "}
                  <button type="button" className="btn glass sm" onClick={() => setDlg({ kind: "tool", tool: t })}>Edit</button></>}
              </td>
            </tr>); })}</tbody>
        </table></div></div>)}
      {view === "bills" && (!costs ? <CardSkeleton /> : (
        <div className="card overflow-hidden p-0">
          {costs.bills.length ? <ul className="m-0 list-none p-0">{costs.bills.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-5 py-3.5 first:border-t-0">
              <b className="min-w-0 flex-[1_1_160px] font-display text-[16px] font-medium text-heading">{(list.tools.find((t) => t.slug === b.tool) || { name: b.tool }).name}</b>
              <span className="text-[15px] text-ink">{money(b.amountMinor, b.currency)}</span>
              <span className="min-w-0 flex-[1_1_200px] text-[14px] text-ink-dim">{b.note}</span>
              {manage && <button type="button" className="btn glass sm" onClick={async () => { const r = await api("DELETE", `/api/tools/bills/${b.id}`); if (r.ok) reload(); }}>Remove</button>}
            </li>))}</ul> : <div className="empty">No bills recorded for {monthName(costs.month)}. Use &ldquo;Add bill&rdquo; on a tool for usage or an invoice.</div>}
        </div>))}
      {view === "teams" && (!costs ? <CardSkeleton /> : (
        <div className="card overflow-hidden p-0">
          {Object.keys(costs.byDept).length ? <table className="w-full border-collapse"><thead><tr><th className={TH}>Department</th><th className={TH}>Seats this month</th></tr></thead>
            <tbody>{Object.entries(costs.byDept).sort((a, b) => a[0].localeCompare(b[0])).map(([d, bag]) => <tr key={d}><td className={TD}>{d}</td><td className={TD}>{both(bag)}</td></tr>)}</tbody></table>
            : <div className="empty">No paid seats with a price yet.</div>}
        </div>))}
      {dlg && dlg.kind === "tool" && <ToolDialog tool={dlg.tool} meta={list} onClose={() => setDlg(null)} onDone={() => { setDlg(null); reload(); }} />}
      {dlg && dlg.kind === "seats" && <SeatsDialog tool={dlg.tool} onClose={() => { setDlg(null); reload(); }} />}
      {dlg && dlg.kind === "bill" && <BillDialog tool={dlg.tool} month={month} onClose={() => setDlg(null)} onDone={() => { setDlg(null); setView("bills"); reload(); }} />}
    </section>
  );
}

function Tile({ label, value, sub, warn }) {
  return (
    <div className={`card flex flex-col gap-1 px-5 py-4 ${warn ? "border-l-4 border-l-warn" : ""}`}>
      <span className="text-[14px] font-bold text-ink-dim">{label}</span>
      <b className="font-display text-[28px] font-medium leading-tight text-heading">{value}</b>
      <span className="text-[13.5px] text-ink-dim">{sub}</span>
    </div>
  );
}

function ToolDialog({ tool, meta, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ name: tool ? tool.name : "", vendor: tool ? tool.vendor : "", category: tool ? tool.category : "ai", billing: tool ? tool.billing : "seat",
    currency: tool ? tool.currency : "USD", seatCost: tool && tool.seatCostMinor != null ? String(tool.seatCostMinor / 100) : "", url: tool ? tool.url : "", notes: tool ? tool.notes : "", active: tool ? tool.active : true });
  const [er, setEr] = useState({}), [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const save = async () => {
    setBusy(true); const r = await api(tool ? "PUT" : "POST", tool ? `/api/tools/${tool.slug}` : "/api/tools", f); setBusy(false);
    if (!r.ok) { setEr(r.data && r.data.errors ? r.data.errors : { form: apiMsg(r) }); return; }
    toast(tool ? `${f.name} saved.` : `${f.name} added.`); onDone();
  };
  return (
    <Modal onClose={busy ? () => {} : onClose} label={tool ? `Edit ${tool.name}` : "Add a tool"}>
      <div className="card-h"><h3>{tool ? `Edit ${tool.name}` : "Add a tool"}</h3></div>
      <div className="card-b">
        {er.form && <Callout>{er.form}</Callout>}
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <Field id="tl-name" label="Name" error={er.name}><input id="tl-name" className="input" maxLength={60} value={f.name} onChange={set("name")} aria-invalid={!!er.name} /></Field>
          <Field id="tl-vendor" label="Made by (optional)"><input id="tl-vendor" className="input" maxLength={60} value={f.vendor} onChange={set("vendor")} /></Field>
          <Field id="tl-cat" label="Kind"><select id="tl-cat" className="input" value={f.category} onChange={set("category")}>{Object.entries(meta.categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field id="tl-bill" label="How it is billed"><select id="tl-bill" className="input" value={f.billing} onChange={set("billing")}>{Object.entries(meta.billing).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field id="tl-cur" label="Currency" error={er.currency}><select id="tl-cur" className="input" value={f.currency} onChange={set("currency")}><option value="INR">Rupees (₹)</option><option value="USD">Dollars ($)</option></select></Field>
          {f.billing !== "free" && f.billing !== "usage" && <Field id="tl-cost" label="Price per seat, per month" hint="Leave empty if you don't know it yet." error={er.seatCost}>
            <input id="tl-cost" className="input" inputMode="decimal" value={f.seatCost} onChange={set("seatCost")} placeholder={f.currency === "INR" ? "1650" : "20.00"} aria-invalid={!!er.seatCost} /></Field>}
        </div>
        <Field id="tl-url" label="Address (optional)" error={er.url}><input id="tl-url" className="input" maxLength={300} value={f.url} onChange={set("url")} placeholder="https://" aria-invalid={!!er.url} /></Field>
        <Field id="tl-notes" label="Notes (optional)" hint="For example the plan, or who the account owner is."><textarea id="tl-notes" className="input" rows={2} maxLength={500} value={f.notes} onChange={set("notes")} /></Field>
        {tool && <label className="flex min-h-11 cursor-pointer items-center gap-3"><input type="checkbox" className="size-5 accent-maroon" checked={f.active} onChange={set("active")} /> In use (untick to hide it from staff)</label>}
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
    </Modal>
  );
}

function SeatsDialog({ tool, onClose }) {
  const toast = useToast(), { people } = useData();
  const [seats, setSeats] = useState(null), [pick, setPick] = useState(""), [own, setOwn] = useState(""), [er, setEr] = useState(""), [busy, setBusy] = useState(false);
  const load = async () => { const r = await api("GET", `/api/tools/${tool.slug}/seats`); setSeats(r.ok ? r.data.seats : []); };
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const have = useMemo(() => new Set((seats || []).map((s) => s.email)), [seats]);
  const staff = (people || []).filter((p) => p.status !== "offboarded" && !have.has(p.email.toLowerCase())).map((p) => ({ email: p.email, name: p.name, title: p.title, no: p.no }));
  const give = async () => {
    if (!pick) { setEr("Please choose a person."); return; }
    setBusy(true); const r = await api("POST", `/api/tools/${tool.slug}/seats`, { email: pick, seatCost: own }); setBusy(false);
    if (!r.ok) { setEr((r.data && r.data.errors && Object.values(r.data.errors)[0]) || apiMsg(r)); return; }
    setEr(""); setPick(""); setOwn(""); toast(`${tool.name} seat given.`); load();
  };
  const remove = async (s) => {
    setBusy(true); const r = await api("DELETE", `/api/tools/${tool.slug}/seats/${encodeURIComponent(s.email)}`); setBusy(false);
    if (!r.ok) { toast(apiMsg(r)); return; }
    toast(`${s.name}'s ${tool.name} seat removed.`); load();
  };
  return (
    <Modal wide onClose={busy ? () => {} : onClose} label={`${tool.name} seats`}>
      <div className="card-h"><h3>{tool.name}: who has a seat</h3></div>
      <div className="card-b flex flex-col gap-4">
        {tool.connected && <Callout>{tool.name} is connected: give or remove a seat from the person&rsquo;s page, and {tool.name} itself is updated.</Callout>}
        {!seats ? <ListSkeleton rows={4} /> : seats.length ? (
          <ul className="m-0 list-none rounded-field border border-line p-0">{seats.map((s) => (
            <li key={s.email} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-3 first:border-t-0">
              <span className="min-w-0 flex-[1_1_200px]"><b className="block text-[15px] text-ink">{s.name}</b><span className="text-[13.5px] text-ink-dim">{[s.title, s.dept].filter(Boolean).join(" · ")}</span></span>
              <span className="text-[14px] text-ink-dim">{s.status === "active" || s.status === "member" ? (s.since ? `Since ${new Date(s.since).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : "Has a seat") : `Status: ${s.status}`}{s.seatCostMinor != null ? ` · own price ${money(s.seatCostMinor, tool.currency)}` : ""}</span>
              {!tool.connected && <button type="button" className="btn glass sm" disabled={busy} onClick={() => remove(s)}>Remove</button>}
            </li>))}</ul>) : <p className="m-0 text-[14px] text-ink-dim">Nobody has a seat yet.</p>}
        {!tool.connected && (
          <div className="grid grid-cols-[minmax(0,1fr)_180px_auto] items-end gap-3 max-sm:grid-cols-1">
            <Field id="st-p" label="Give a seat to"><PeoplePicker id="st-p" people={staff} value={pick} onChange={(v) => setPick(v || "")} /></Field>
            <Field id="st-own" label="Own price (optional)" hint={`In ${tool.currency === "INR" ? "rupees" : "dollars"}`}><input id="st-own" className="input" inputMode="decimal" value={own} onChange={(e) => setOwn(e.target.value)} /></Field>
            <button type="button" className="btn primary mb-1" disabled={busy || !pick} onClick={give}>Give seat</button>
          </div>)}
        {er && <p role="alert" className="m-0 text-[14px] text-bad">{er}</p>}
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Done</button></div>
    </Modal>
  );
}

function BillDialog({ tool, month, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ month, amount: "", currency: tool.currency, note: "" }), [er, setEr] = useState({}), [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); const r = await api("POST", `/api/tools/${tool.slug}/bills`, f); setBusy(false);
    if (!r.ok) { setEr(r.data && r.data.errors ? r.data.errors : { form: apiMsg(r) }); return; }
    toast(`${tool.name} bill recorded.`); onDone();
  };
  return (
    <Modal onClose={busy ? () => {} : onClose} label={`Add a ${tool.name} bill`}>
      <div className="card-h"><h3>Add a {tool.name} bill</h3></div>
      <div className="card-b">
        <p className="m-0 mb-4 text-[14px] text-ink-dim">For usage-based cost or the vendor&rsquo;s invoice. Seats with a price are already counted, so add only what is on top.</p>
        {er.form && <Callout>{er.form}</Callout>}
        <div className="grid grid-cols-3 gap-4 max-sm:grid-cols-1">
          <Field id="bl-m" label="Month" error={er.month}><input id="bl-m" type="month" className="input" max={thisMonth()} value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} aria-invalid={!!er.month} /></Field>
          <Field id="bl-a" label="Amount" error={er.amount}><input id="bl-a" className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} aria-invalid={!!er.amount} /></Field>
          <Field id="bl-c" label="Currency" error={er.currency}><select id="bl-c" className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option value="INR">Rupees (₹)</option><option value="USD">Dollars ($)</option></select></Field>
        </div>
        <Field id="bl-n" label="Note (optional)"><input id="bl-n" className="input" maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="For example, API usage" /></Field>
      </div>
      <div className="modal-f"><button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save bill"}</button></div>
    </Modal>
  );
}
