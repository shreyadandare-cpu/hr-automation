import { useMemo, useState } from "react";
import { DropdownMenu } from "radix-ui";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, apiMsg } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useToast } from "../components/toast.jsx";
import { useData } from "../data.jsx";
import { PageTabs, PersonCell, Pill, SectionHead, ToolIcon, shortDate, pill, PageSkeleton } from "../components/ui.jsx";
import Pager from "../components/Pager.jsx";
import OrgChart from "../components/OrgChart.jsx";
import { AddMemberModal } from "../modules/employee/cards.jsx";
import { STATUS, TOOLS, leaving, byEmployeeNo, isTop, mgrOf, teamUnder, toolIds } from "../lib/people.js";
import { scopeSet } from "../lib/useLeave.js";
import { usePresence, presenceLabel } from "../lib/usePresence.js";

function StatusPill({ person }) {
  if (person.status === "active" && person.lastDay) { const [w, tone] = leaving(person); return <Pill tone={tone}>{w} {shortDate(person.lastDay)}</Pill>; }
  const [label, tone] = STATUS[person.status];
  return <Pill tone={tone}>{label}</Pill>;
}

/* Reporting manager: everyone just reads it. HR changes it from the three-dot menu at the end of the row. */
function ManagerCell({ person }) {
  const cur = mgrOf(person);
  if (isTop(person) && !cur) return <span className="muted" title="At the top of the company">No manager</span>;
  return <span className={cur ? "" : "muted"}>{cur || "—"}</span>;
}

/* The three dots at the end of a row (HR only). The menu is drawn over the page so the table never clips it. */
function RowMenu({ person, canEdit, onView, onEdit }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="dots-btn" aria-label={`Actions for ${person.name}`} onClick={(e) => e.stopPropagation()}>⋯</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="row-menu" align="end" sideOffset={6} collisionPadding={8} onClick={(e) => e.stopPropagation()}>
          <DropdownMenu.Item className="row-menu-i" onSelect={() => onView(person)}>View profile</DropdownMenu.Item>
          {canEdit && <DropdownMenu.Item className="row-menu-i" disabled={person.status === "offboarded"} onSelect={() => onEdit(person)}>Edit</DropdownMenu.Item>}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* The projects someone is working on now: the first one, and a "+N" badge (hover for all, with where each runs). */
function ProjectsCell({ person }) {
  const now = (person.projects || []).filter((a) => a.status === "Active");
  if (!now.length) return <span className="muted">—</span>;
  const all = now.map((a) => (a.location ? `${a.project} · ${a.location}` : a.project)).join("\n");
  return (
    <div className="proj-line" title={all}>
      <span className="proj-name">{now[0].project}</span>
      {now.length > 1 && <span className="proj-more">+{now.length - 1}</span>}
    </div>
  );
}

export default function Employees() {
  const auth = useAuth(), { user, can, canAll } = auth;
  // people.edit: Edit on a row for the people in scope (everyone for the whole company); moving anyone between managers
  // and seeing former employees are company-wide; the Claude status refresh belongs to tool access.
  const editsAll = canAll("people.edit"), seesFormer = canAll("people.view") || editsAll, managesTools = canAll("tools.manage");
  const { people, reload, claudeMode } = useData();
  const presence = usePresence();
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [former, setFormer] = useState(true);   // people who have left stay in the list, marked Exited; HR can hide them
  const [size, setSize] = useState(10);
  const [page, setPage] = useState(1);
  const [params, setParams] = useSearchParams();
  const chart = params.get("view") === "chart", listView = params.get("view") === "list";
  const [dept, setDept] = useState("");
  const [scope, setScope] = useState("all");          // "all" or "team": the people under me
  const [adding, setAdding] = useState(false);        // the Add member dialog for my own team
  // Claude access (HR): giving it happens on the person's own page. Here HR can only refresh the status from the Claude organisation.
  const refreshClaude = async () => {
    if (refreshing) return;
    setRefreshing(true);
    const r = await api("POST", "/api/tool-access/claude/refresh");
    setRefreshing(false);
    if (!r.ok) { toast(apiMsg(r)); return; }
    if (r.data.mode === "simulated") { toast("Claude is not connected yet (no admin key), so there is nothing to refresh."); return; }
    await reload();
    toast(r.data.changed ? `Claude status updated for ${r.data.changed} ${r.data.changed === 1 ? "person" : "people"}.` : "Already up to date with the Claude organisation.");
  };

  const { direct, team } = useMemo(() => teamUnder(people, user && user.email), [people, user]);   // the people under me
  const inTeam = scope === "team" && team.length > 0;
  const meP = (people || []).find((p) => String(p.email).toLowerCase() === String(user && user.email).toLowerCase());

  const formerCount = (people || []).filter((p) => p.status === "offboarded").length;
  const showFormer = seesFormer && former && formerCount > 0;
  const editScope = can("people.edit") ? scopeSet(auth, "people.edit", people) : new Set();
  const mayEdit = (p) => !editScope || editScope.has(String(p.email).toLowerCase());
  const all = useMemo(() => {
    const s = q.toLowerCase();
    return (inTeam ? team : (people || [])).filter((p) => (showFormer || p.status !== "offboarded") && (!s || (p.no + p.name + p.email + p.dept + p.title + (p.location || "") + (p.projects || []).map((a) => a.project).join(" ")).toLowerCase().includes(s)))
      .sort(byEmployeeNo);
  }, [people, team, inTeam, q, showFormer]);
  const pages = Math.max(1, Math.ceil(all.length / size)), cur = Math.min(page, pages);
  const rows = all.slice((cur - 1) * size, cur * size);

  if (!people) return <PageSkeleton />;
  const views = <PageTabs label="Employees" current={chart ? "chart" : listView ? "list" : "dir"} items={[["dir", "Directory", "/app/employees"], ["list", "List", "/app/employees?view=list"], ["chart", "Org chart", "/app/employees?view=chart"]]} />;
  if (chart) return (
    <section className="section">
      <SectionHead title="Employees" sub="The company from the top down, from the reporting manager set for each person. Select someone to open their page." tabs={views} />
      <OrgChart people={people} />
    </section>
  );
  if (!listView) {
    const depts = [...new Set((people || []).filter((p) => p.status !== "offboarded").map((p) => p.dept).filter((d) => d && d !== "—"))].sort();
    const shown = all.filter((p) => !dept || p.dept === dept);
    return (
      <section className="section">
        <SectionHead title="Employees" sub="Everyone at Wohlig. Select a person to open their page." tabs={views} />
        <div className="card">
          <div className="filters">
            <select className="input" aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{depts.map((d) => <option key={d}>{d}</option>)}</select>
            <input className="input grow" placeholder="Search by name, ID, project, location or email" aria-label="Search employees" value={q} onChange={(e) => setQ(e.target.value)} />
            {seesFormer && formerCount > 0 && <label className="former-toggle"><input type="checkbox" checked={former} onChange={(e) => { setFormer(e.target.checked); setPage(1); }} />Show exited ({formerCount})</label>}
            <span className="muted">Showing {shown.length} of {(people || []).filter((p) => showFormer || p.status !== "offboarded").length}</span>
          </div>
        </div>
        {shown.length ? (
          <div className="dir-grid">
            {shown.map((p) => (
              <Link key={p.email} className={`card dir-card${p.status === "offboarded" ? " former" : ""}`} to={`/app/employees/${encodeURIComponent(p.email)}`}>
                <span className="avatar dir-av" style={{ background: p.color }}>{p.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase()}</span>
                <span className="dir-t">
                  <b>{p.name}</b>
                  {(p.status === "offboarded" || p.status === "offboarding") && <span><Pill tone={STATUS[p.status][1]}>{STATUS[p.status][0]}{p.status === "offboarded" && p.lastDay ? ` · ${shortDate(p.lastDay)}` : ""}</Pill></span>}
                  {(() => { const l = presenceLabel(presence[String(p.email).toLowerCase()]); return l ? <span><Pill tone={l[1]}>{l[0]}</Pill></span> : null; })()}
                  <span className="dir-role">{p.title && p.title !== "—" ? p.title : "Wohlig"}</span>
                  <span><i>Department</i>{p.dept && p.dept !== "—" ? p.dept : "Not set"}</span>
                  {p.location && <span><i>Location</i>{p.location}</span>}
                  <span><i>Email</i>{p.email}</span>
                </span>
              </Link>))}
          </div>) : <div className="card"><div className="empty">No one matches your search. Please try another name or department.</div></div>}
      </section>
    );
  }
  return (
    <section className="section">
      <SectionHead title="Employees" sub="Everyone with a record here, and which tools they can use right now." tabs={views}
        actions={<>
          {managesTools && claudeMode !== "simulated" && <button type="button" className="btn glass sm" disabled={refreshing} onClick={refreshClaude}>{refreshing ? "Checking…" : "Refresh Claude status"}</button>}
          {seesFormer && formerCount > 0 && <label className="former-toggle"><input type="checkbox" checked={former} onChange={(e) => { setFormer(e.target.checked); setPage(1); }} />Show exited employees ({formerCount})</label>}
          <input className="input" placeholder="Search by name, ID, project, location or email" aria-label="Search employees" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </>} />
      {team.length > 0 && (
        <div className="row" style={{ alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div className="seg" role="radiogroup" aria-label="Whose people">
            <label><input type="radio" name="emp-scope" checked={scope === "all"} onChange={() => { setScope("all"); setPage(1); }} />Everyone</label>
            <label><input type="radio" name="emp-scope" checked={scope === "team"} onChange={() => { setScope("team"); setPage(1); }} />My team ({team.length})</label>
          </div>
          <button type="button" className="btn glass sm" onClick={() => setAdding(true)}>+ Add member</button>
          {inTeam && <span className="muted">{direct.length} {direct.length === 1 ? "person reports" : "people report"} to you directly{team.length > direct.length ? `, ${team.length - direct.length} more work under them` : ""}.</span>}
        </div>)}
      <div className="card"><div className="tbl-wrap"><table className="dir-table">
        <thead><tr><th>ID</th><th>Employee</th><th className="hide-sm">Role</th><th className="hide-sm">Reporting manager</th><th className="hide-sm">Projects</th><th>Status</th><th>Tools</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {rows.length ? rows.map((p) => (
            <tr key={p.id} className={p.status === "offboarded" ? "former" : ""}>
              <td className="num-cell"><span className="emp-no">{p.no}</span></td>
              <td><PersonCell person={p} /></td>
              <td className="hide-sm"><div className="cell-main">{p.title}{p.intern && <span className={pill("info")} style={{ marginLeft: 8, verticalAlign: "middle" }}>Intern</span>}</div><div className="cell-sub">{[p.dept, p.location].filter((x) => x && x !== "—").join(" · ")}</div></td>
              <td className="hide-sm"><ManagerCell person={p} /></td>
              <td className="hide-sm"><ProjectsCell person={p} /></td>
              <td><StatusPill person={p} /><div className="cell-sub">Joined {shortDate(p.start)}</div></td>
              <td><div className="apps-row">{toolIds(p).map((id) => <ToolIcon key={id} tool={TOOLS[id]} state={p.grants[id]} />)}
                {p.grants && p.grants.claude === "invited" && <span className="cell-sub" style={{ marginLeft: 8 }}>Invited</span>}
                {p.grants && p.grants.claude === "requested" && <span className="cell-sub" style={{ marginLeft: 8 }}>Requested</span>}</div></td>
              <td className="dots-cell"><RowMenu person={p} canEdit={mayEdit(p)} onView={(x) => nav(`/app/employees/${encodeURIComponent(x.email)}`)} onEdit={(x) => nav(`/app/employees/${encodeURIComponent(x.email)}?edit=1`)} /></td>
            </tr>
          )) : <tr><td colSpan="8"><div className="empty">{q ? `No one matches “${q}”.` : "No one here yet."}</div></td></tr>}
        </tbody>
      </table></div>
      <Pager total={all.length} page={cur} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} /></div>
      {adding && meP && <AddMemberModal boss={meP} asHr={editsAll} onClose={() => setAdding(false)} />}
    </section>
  );
}
