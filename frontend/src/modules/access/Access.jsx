import { useMemo, useState } from "react";
import { api, apiMsg } from "../../api.js";
import { useAuth } from "../../auth.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import ConfirmDialog from "../../components/ConfirmDialog.jsx";
import PeoplePicker from "../../components/PeoplePicker.jsx";
import { Callout, Icon, Pill, SectionHead, ViewTabs, initials, CardSkeleton } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { useList } from "../engage/shared.jsx";

/*
 * Company > Access (super admins only). Who may do what, for the whole company or for a team: a team is everyone below a person
 * in the reporting tree, to any depth. Super admins tick permissions per person; nothing named is stored, the quick-fill buttons
 * only tick boxes. Changes count from the person's next click. The rules: backend/src/access-rules.js.
 */
const longDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const ROW = "flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-5 py-3.5 first:border-t-0 max-sm:px-4";

export default function Access() {
  const { superAdmin } = useAuth();
  const { data, error, reload } = useList("/api/access/people");
  const [view, setView] = useState("people");
  if (!superAdmin) return <div className="card"><div className="empty">Only super admins can open this page.</div></div>;
  return (
    <div className="flex flex-col gap-6">
      <SectionHead title="Access" sub="Who may do what, for the whole company or for a team. A team is everyone below a person in the reporting lines."
        tabs={<ViewTabs label="Access" view={view} onView={setView} views={[["people", "People"], ["super", "Super admins"], ["who", "Who can do what"]]} />} />
      {error && <Callout>{error}</Callout>}
      <Callout>Access you give here counts from the person&rsquo;s next click: their menu shows the matching pages under Manage, and notices for that work reach them.</Callout>
      {data && <Callout>Salaries, payslips, bank details and finance reports are visible only to {(data.salaryOwners || []).join(", ") || "the salary owner"}. They cannot be given to anyone here, and super admins do not see them.</Callout>}
      {!data ? <CardSkeleton lines={4} />
        : view === "people" ? <PeopleTab data={data} reload={reload} />
        : view === "super" ? <SuperTab data={data} reload={reload} />
        : <WhoTab data={data} />}
    </div>
  );
}

function useNames(data) {
  return useMemo(() => Object.fromEntries(data.people.map((p) => [p.email, p.name])), [data]);
}
const scopeText = (g, names, owner) => (g.scope === "company" ? "Whole company" : `Team under ${names[g.scopeRootEmail || owner] || g.scopeRootEmail || "them"}`);

function Face({ p }) {
  return <span aria-hidden="true" className="grid size-10 flex-none place-items-center rounded-full bg-maroon font-display text-[15px] text-ivory">{initials(p.name)}</span>;
}

function PeopleTab({ data, reload }) {
  const [q, setQ] = useState(""), [open, setOpen] = useState(null);
  const names = useNames(data);
  const rank = (p) => (p.superAdmin ? 0 : p.grants.length ? 1 : 2);
  const shown = data.people.filter((p) => `${p.name} ${p.title} ${p.email}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name));
  return (
    <>
      <div className="card overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4 max-sm:px-4">
          <input className="input max-w-[360px] flex-1" type="search" placeholder="Search people…" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="text-[14px] text-ink-dim">{data.people.filter((p) => p.superAdmin || p.grants.length).length} people have access beyond their own records.</span>
        </div>
        <ul className="m-0 list-none p-0">
          {shown.map((p) => (
            <li key={p.email} className={ROW}>
              <Face p={p} />
              <div className="min-w-0 flex-[1_1_220px]">
                <b className="block font-display text-[16px] font-medium text-heading">{p.name}</b>
                <span className="text-[14px] text-ink-dim">{p.title || p.email}{p.manager ? ` · reports to ${p.manager}` : ""}</span>
              </div>
              <div className="flex flex-[1_1_240px] flex-wrap gap-1.5">
                {p.superAdmin ? <Pill tone="info">Super admin: everything except salaries</Pill>
                  : p.grants.length ? <Summary grants={p.grants} names={names} owner={p.email} />
                  : <span className="text-[14px] text-ink-faint">Own records only{p.blocked ? " · login removed" : ""}</span>}
              </div>
              <button type="button" className="btn glass sm" onClick={() => setOpen(p)} aria-label={`Manage access for ${p.name}`}>Manage</button>
            </li>))}
          {!shown.length && <li className="empty">No one matches.</li>}
        </ul>
      </div>
      {open && <PersonDialog data={data} person={data.people.find((x) => x.email === open.email) || open} names={names} reload={reload} onClose={() => setOpen(null)} />}
    </>
  );
}

function Summary({ grants, names, owner }) {
  const company = grants.filter((g) => g.scope === "company").length, teams = [...new Set(grants.filter((g) => g.scope === "tree").map((g) => g.scopeRootEmail || owner))];
  return <>
    {company > 0 && <Pill tone="ok">{company} for the whole company</Pill>}
    {teams.map((t) => <Pill key={t} tone="warn">{grants.filter((g) => g.scope === "tree" && (g.scopeRootEmail || owner) === t).length} for {names[t] || t}&rsquo;s team</Pill>)}
  </>;
}

/* One person: what they hold now (remove any of it), and ticks to give more. */
function PersonDialog({ data, person, names, reload, onClose }) {
  const toast = useToast();
  const [ticks, setTicks] = useState({});   // perm -> { scope: "company" | "tree", root: "" }
  const [until, setUntil] = useState(""), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [history, setHistory] = useState(null);
  const held = new Set(person.grants.map((g) => `${g.permission}|${g.scope}|${g.scopeRootEmail || ""}`));
  const staff = data.people.filter((p) => p.status !== "login only").map((p) => ({ email: p.email, name: p.name, title: p.title }));

  const tick = (perm, on) => setTicks((t) => { const n = { ...t }; if (on) n[perm.key] = { scope: perm.team ? "tree" : "company", root: "" }; else delete n[perm.key]; return n; });
  const fill = (preset) => setTicks((t) => {
    const n = { ...t };
    for (const k of preset.perms) { const p = data.permissions.find((x) => x.key === k); n[k] = { scope: preset.scope === "tree" && p.team ? "tree" : "company", root: "" }; }
    return n;
  });
  const give = async () => {
    const grants = Object.entries(ticks).map(([permission, v]) => ({ permission, scope: v.scope === "company" ? "company" : "tree", scopeRootEmail: v.scope === "other" ? v.root : null, expiresAt: until || null, note }));
    if (!grants.length) { setErr("Please tick at least one permission."); return; }
    if (grants.some((g, i) => Object.values(ticks)[i].scope === "other" && !g.scopeRootEmail)) { setErr("Please choose whose team for each “Team under…” tick."); return; }
    setBusy(true); const r = await api("POST", "/api/access/grants", { email: person.email, grants }); setBusy(false);
    if (!r.ok) { setErr(apiMsg(r)); return; }
    setErr(""); setTicks({}); await reload();
    toast(r.data.added ? `${person.name} now has ${r.data.added} more permission${r.data.added === 1 ? "" : "s"}.` : "Nothing new: they already had all of that.");
  };
  const remove = async (g) => {
    setBusy(true); const r = await api("DELETE", `/api/access/grants/${g.id}`); setBusy(false);
    if (!r.ok) { toast(apiMsg(r)); return; }
    await reload(); toast("Access removed.");
  };
  const showHistory = async () => { const r = await api("GET", `/api/access/people/${encodeURIComponent(person.email)}/history`); setHistory(r.ok ? r.data.history : []); };
  const label = (k) => (data.permissions.find((p) => p.key === k) || { label: k }).label;

  return (
    <Modal wide onClose={busy ? () => {} : onClose} label={`Access for ${person.name}`}>
      <div className="card-h"><h3>Access for {person.name}</h3></div>
      <div className="card-b flex flex-col gap-6">
        {person.superAdmin && <Callout>{person.name} is a super admin and can do everything. Extra ticks are not needed.</Callout>}
        <section aria-labelledby="ac-now">
          <h4 id="ac-now" className="m-0 mb-2 font-display text-[17px] font-medium text-heading">What they can do now</h4>
          <p className="m-0 mb-3 text-[14px] text-ink-dim">Everyone can always see and change their own records{person.manager ? "" : ""}. Managers keep what they have today for their direct reports.</p>
          {person.grants.length ? (
            <ul className="m-0 flex list-none flex-col gap-0 rounded-field border border-line p-0">
              {person.grants.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2.5 first:border-t-0">
                  <span className="min-w-0 flex-[1_1_200px] text-[15px] text-ink">{label(g.permission)}</span>
                  <span className="text-[14px] text-ink-dim">{scopeText(g, names, person.email)}{g.expiresAt ? ` · until ${longDate(g.expiresAt)}` : ""}</span>
                  <button type="button" className="btn glass sm" disabled={busy} onClick={() => remove(g)} aria-label={`Remove ${label(g.permission)}`}>Remove</button>
                </li>))}
            </ul>) : <p className="m-0 text-[14px] text-ink-faint">Nothing beyond their own records.</p>}
        </section>

        <section aria-labelledby="ac-give">
          <h4 id="ac-give" className="m-0 mb-2 font-display text-[17px] font-medium text-heading">Give more access</h4>
          <div className="mb-4 flex flex-wrap gap-2" aria-label="Quick fill">
            {Object.entries(data.presets).map(([k, p]) => <button key={k} type="button" className="btn glass sm" onClick={() => fill(p)}>{p.label}</button>)}
            {Object.keys(ticks).length > 0 && <button type="button" className="btn link" onClick={() => setTicks({})}>Clear ticks</button>}
          </div>
          <div className="flex flex-col gap-5">
            {data.groups.map((grp) => (
              <fieldset key={grp} className="m-0 rounded-field border border-line p-0">
                <legend className="ml-3 px-1.5 font-display text-[15px] font-medium text-heading">{grp}</legend>
                {data.permissions.filter((p) => p.group === grp).map((p) => {
                  const t = ticks[p.key], already = person.grants.some((g) => g.permission === p.key && g.scope === "company");
                  return (
                    <div key={p.key} className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-line px-4 py-3 first:border-t-0">
                      <label className="flex min-w-0 flex-[1_1_260px] cursor-pointer items-start gap-3">
                        <input type="checkbox" className="mt-1 size-5 flex-none accent-maroon" checked={!!t} disabled={already} onChange={(e) => tick(p, e.target.checked)} />
                        <span><span className="block text-[15px] font-bold text-ink">{p.label}{already ? " (has it)" : ""}</span><span className="block text-[14px] text-ink-dim">{p.hint}</span></span>
                      </label>
                      {t && (
                        <div className="flex flex-[0_1_300px] flex-col gap-2">
                          <select className="input" aria-label={`Who “${p.label}” covers`} value={t.scope} onChange={(e) => setTicks({ ...ticks, [p.key]: { ...t, scope: e.target.value } })}>
                            <option value="company">Whole company</option>
                            {p.team && <option value="tree">Their own team</option>}
                            {p.team && <option value="other">Team under someone else…</option>}
                          </select>
                          {t.scope === "other" && <PeoplePicker id={`ac-root-${p.key}`} people={staff} value={t.root} onChange={(v) => setTicks({ ...ticks, [p.key]: { ...t, root: v || "" } })} placeholder="Whose team…" />}
                        </div>)}
                    </div>);
                })}
              </fieldset>))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <Field id="ac-until" label="Until (optional)" hint="Leave empty to keep it until it is removed."><input id="ac-until" type="date" className="input" min={data.today} value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
            <Field id="ac-note" label="Why (optional)"><input id="ac-note" className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example, covers payroll in March" /></Field>
          </div>
          {err && <p role="alert" className="m-0 mt-2 text-[14px] text-bad">{err}</p>}
        </section>

        <section>
          {history ? (
            <>
              <h4 className="m-0 mb-2 font-display text-[17px] font-medium text-heading">History</h4>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[14px] text-ink-dim">
                {history.map((h) => <li key={h.id}>{label(h.permission)}, {scopeText(h, names, person.email).toLowerCase()}: given by {names[h.grantedBy] || h.grantedBy} on {longDate(h.grantedAt)}{h.revokedAt ? `, removed by ${names[h.revokedBy] || h.revokedBy} on ${longDate(h.revokedAt)}` : ""}.</li>)}
                {!history.length && <li>Nothing yet.</li>}
              </ul>
            </>) : <button type="button" className="btn link" onClick={showHistory}>Show history</button>}
        </section>
      </div>
      <div className="modal-f">
        <button type="button" className="btn glass" onClick={onClose} disabled={busy}>Close</button>
        <button type="button" className="btn primary" onClick={give} disabled={busy || !Object.keys(ticks).length}>{busy ? "Saving…" : `Give access${Object.keys(ticks).length ? ` (${Object.keys(ticks).length})` : ""}`}</button>
      </div>
    </Modal>
  );
}

function SuperTab({ data, reload }) {
  const toast = useToast();
  const [pick, setPick] = useState(""), [drop, setDrop] = useState(null), [busy, setBusy] = useState(false);
  const supers = data.people.filter((p) => p.superAdmin);
  const others = data.people.filter((p) => !p.superAdmin && p.status !== "offboarding").map((p) => ({ email: p.email, name: p.name, title: p.title }));
  const set = async (email, on) => {
    setBusy(true); const r = await api("PUT", `/api/access/super-admins/${encodeURIComponent(email)}`, { on }); setBusy(false);
    if (!r.ok) { toast(apiMsg(r)); return false; }
    await reload(); return true;
  };
  return (
    <div className="card overflow-hidden p-0">
      <div className="border-b border-line px-5 py-4 max-sm:px-4">
        <p className="m-0 text-[15px] text-ink-dim">Super admins can do everything except see salaries, and are the only people who give access. There is always at least one.</p>
      </div>
      <ul className="m-0 list-none p-0">
        {supers.map((p) => (
          <li key={p.email} className={ROW}>
            <Face p={p} />
            <div className="min-w-0 flex-1"><b className="block font-display text-[16px] font-medium text-heading">{p.name}{p.email === data.me ? " (you)" : ""}</b><span className="text-[14px] text-ink-dim">{p.title || p.email}</span></div>
            <button type="button" className="btn glass sm" disabled={busy || supers.length < 2} onClick={() => setDrop(p)}>Remove</button>
          </li>))}
      </ul>
      <div className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-4 max-sm:px-4">
        <div className="min-w-[240px] flex-1"><Field id="sa-new" label="Add a super admin"><PeoplePicker id="sa-new" people={others} value={pick} onChange={(v) => setPick(v || "")} /></Field></div>
        <button type="button" className="btn primary sm mb-1" disabled={busy || !pick} onClick={async () => { if (await set(pick, true)) { toast("Super admin added."); setPick(""); } }}>Make super admin</button>
      </div>
      {drop && <ConfirmDialog title={`Remove ${drop.name} as super admin?`} confirmLabel="Remove" danger onClose={() => setDrop(null)}
        onConfirm={async () => { if (await set(drop.email, false)) toast(`${drop.name} is no longer a super admin.`); setDrop(null); }}>
        {drop.email === data.me ? "You will lose access to this page straight away." : `${drop.name} keeps only the permissions ticked for them.`}
      </ConfirmDialog>}
    </div>
  );
}

function WhoTab({ data }) {
  const [perm, setPerm] = useState(data.permissions[0].key);
  const names = useNames(data);
  const p = data.permissions.find((x) => x.key === perm);
  const holders = data.people.flatMap((x) => (x.superAdmin ? [{ person: x, text: "Everything, as a super admin" }]
    : x.grants.filter((g) => g.permission === perm).map((g) => ({ person: x, text: `${scopeText(g, names, x.email)}${g.expiresAt ? `, until ${longDate(g.expiresAt)}` : ""}` }))));
  return (
    <div className="card overflow-hidden p-0">
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-4 max-sm:px-4">
        <div className="min-w-[260px] flex-1"><Field id="who-perm" label="Permission">
          <select id="who-perm" className="input" value={perm} onChange={(e) => setPerm(e.target.value)}>
            {data.groups.map((g) => <optgroup key={g} label={g}>{data.permissions.filter((x) => x.group === g).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>)}
          </select></Field></div>
        <p className="m-0 mb-2 flex-[1_1_260px] text-[14px] text-ink-dim">{p.hint}{p.team ? "" : " Whole company only."}</p>
      </div>
      <ul className="m-0 list-none p-0">
        {holders.map((h, i) => (
          <li key={`${h.person.email}-${i}`} className={ROW}>
            <Face p={h.person} />
            <div className="min-w-0 flex-1"><b className="block font-display text-[16px] font-medium text-heading">{h.person.name}</b><span className="text-[14px] text-ink-dim">{h.text}</span></div>
            {h.text.startsWith("Everything") && <Icon name="shield" />}
          </li>))}
      </ul>
    </div>
  );
}
