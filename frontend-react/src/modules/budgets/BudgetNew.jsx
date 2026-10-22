import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiMsg } from "../../api.js";
import { SectionHead } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { Wf, useCats } from "./util.jsx";

export default function BudgetNew() {
  const navigate = useNavigate();
  const toast = useToast();
  const cats = (useCats() || []).filter((c) => c.active);
  const [d, setD] = useState({ purpose: "", category: "", requestedBudget: "", headcount: "", eventDate: "", description: "" });
  const [er, setEr] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (ev) => {
    ev.preventDefault();
    setBusy(true); setEr({});
    const r = await api("POST", "/api/budget-requests", d);
    setBusy(false);
    if (!r.ok) {
      const errs = (r.data && r.data.errors) || {};
      setEr(errs);
      if (!Object.keys(errs).length) toast(apiMsg(r));
      else setTimeout(() => {
        const el = document.querySelector(".ferr");
        if (el) { el.scrollIntoView({ block: "center" }); const i = el.closest(".field")?.querySelector("input,textarea,select"); if (i) i.focus(); }
      }, 0);
      return;
    }
    toast(`Budget request ${r.data.requestNo} sent to HR.`);
    navigate(`/app/budgets/${r.data.id}`);
  };

  return (
    <section className="section">
      <SectionHead eyebrow="Me" title="Budget" accent="request." sub="Ask HR to approve a budget before you spend. HR can approve the full amount or less. After the event, upload the final bill and up to the approved budget is reimbursed." />
      <form className="grid" style={{ gap: 22 }} noValidate onSubmit={submit}>
        <div className="card"><div className="card-h"><h3>What is the budget for?</h3></div><div className="card-b form">
          <div className="span" style={{ gridColumn: "1/-1" }}>
            <Wf id="bn-purpose" label="Purpose" error={er.purpose}><input className="input" id="bn-purpose" maxLength={120} value={d.purpose} onChange={set("purpose")} placeholder="e.g. Team success dinner" /></Wf>
          </div>
          <Wf id="bn-category" label="Category" error={er.category}>
            <select className="input" id="bn-category" value={d.category} onChange={set("category")}>
              <option value="">Choose…</option>
              {cats.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select>
          </Wf>
          <Wf id="bn-requestedBudget" label="Requested budget (₹)" error={er.requestedBudget}><input className="input" id="bn-requestedBudget" type="number" min="0" step="100" value={d.requestedBudget} onChange={set("requestedBudget")} placeholder="20000" /></Wf>
          <Wf id="bn-headcount" label="Number of people (optional)" error={er.headcount}><input className="input" id="bn-headcount" type="number" min="1" step="1" value={d.headcount} onChange={set("headcount")} placeholder="10" /></Wf>
          <Wf id="bn-eventDate" label="Date" error={er.eventDate}><input className="input" id="bn-eventDate" type="date" value={d.eventDate} onChange={set("eventDate")} /></Wf>
          <div style={{ gridColumn: "1/-1" }}>
            <Wf id="bn-description" label="Description" error={er.description}><textarea className="input" id="bn-description" rows={3} maxLength={1000} value={d.description} onChange={set("description")} placeholder="Team dinner to celebrate successful project delivery" /></Wf>
          </div>
        </div></div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <button type="button" className="btn glass" onClick={() => navigate("/app/budgets")}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? "Sending…" : "Submit request"}</button>
        </div>
      </form>
    </section>
  );
}
