import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, apiShared } from "./api.js";
import { useAuth } from "./auth.jsx";
import { buildPerson } from "./lib/people.js";

/* The company data every page needs: people, tool access, documents, and the signed-in person's profile. */
const DataContext = createContext(null);
export const useData = () => useContext(DataContext);

export function DataProvider({ children }) {
  const { canAll } = useAuth();
  // The company-wide lists are fetched only by people who hold them for the whole company, so no one else gets a refusal.
  const offboards = canAll("offboarding.manage"), onboards = canAll("onboarding.manage");
  const [roster, setRoster] = useState(null);
  const [tools, setTools] = useState([]);
  const [claudeMode, setClaudeMode] = useState("live");   // "simulated" = no Claude admin key: access is requested from the Claude admin instead
  const [offs, setOffs] = useState([]);
  const [docs, setDocs] = useState([]);
  const [profile, setProfile] = useState(null);
  const [leave, setLeave] = useState(null);
  const [records, setRecords] = useState([]);   // onboarding.manage only: personal details collected at onboarding

  // Each list is applied as soon as it arrives, so the page draws with the staff list and fills in the rest, rather than
  // waiting for the slowest request. A failed request (server busy or offline) never leaves the page loading forever.
  const reload = useCallback(async () => {
    const apply = (p, fn) => p.then((r) => { if (r && r.ok) fn(r.data); return r; });
    await Promise.all([
      api("GET", "/api/roster").then((r) => { setRoster(r.ok ? r.data : []); return r; }),
      apply(api("GET", "/api/tool-access"), (d) => { setTools(d.rows); setClaudeMode(d.claudeMode); }),
      offboards ? apply(api("GET", "/api/offboarding"), (d) => { if (Array.isArray(d)) setOffs(d); }) : null,
      apply(api("GET", "/api/documents"), setDocs),
      apply(api("GET", "/api/profile"), setProfile),
      onboards ? apply(api("GET", "/api/onboarding"), setRecords) : null,
      apply(apiShared("/api/leave"), setLeave),
    ]);
  }, [offboards, onboards]);
  const reloadLeave = useCallback(async () => { const r = await api("GET", "/api/leave"); if (r.ok) setLeave(r.data); return r; }, []);
  useEffect(() => { reload(); }, [reload]);

  const people = useMemo(() => {
    if (!roster) return null;
    const offMap = new Map(offs.map((o) => [String(o.email).toLowerCase(), o]));
    return roster.map((r, i) => buildPerson(r, i, tools, offMap));
  }, [roster, tools, offs]);

  return <DataContext.Provider value={{ claudeMode, people, docs, profile, records, leave, setProfile, reload, reloadLeave, setRoster }}>{children}</DataContext.Provider>;
}
