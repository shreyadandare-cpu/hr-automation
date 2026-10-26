import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { useAuth } from "./auth.jsx";
import { buildPerson } from "./lib/people.js";

/* The company data every page needs: people, tool access, documents, and the signed-in person's profile. */
const DataContext = createContext(null);
export const useData = () => useContext(DataContext);

export function DataProvider({ children }) {
  const { isHr } = useAuth();
  const [roster, setRoster] = useState(null);
  const [tools, setTools] = useState([]);
  const [offs, setOffs] = useState([]);
  const [docs, setDocs] = useState([]);
  const [profile, setProfile] = useState(null);
  const [leave, setLeave] = useState(null);
  const [records, setRecords] = useState([]);   // HR only: personal details collected at onboarding

  const reload = useCallback(async () => {
    const [r, t, o, d, p, rec, lv] = await Promise.all([
      api("GET", "/api/roster"), api("GET", "/api/tool-access"), isHr ? api("GET", "/api/offboarding") : { ok: false }, api("GET", "/api/documents"), api("GET", "/api/profile"),
      isHr ? api("GET", "/api/onboarding") : { ok: false }, api("GET", "/api/leave"),
    ]);
    if (lv.ok) setLeave(lv.data);
    if (rec.ok) setRecords(rec.data);
    setRoster(r.ok ? r.data : []);
    if (t.ok) setTools(t.data.rows);
    if (o.ok && Array.isArray(o.data)) setOffs(o.data);
    if (d.ok) setDocs(d.data);
    if (p.ok) setProfile(p.data);
  }, [isHr]);
  const reloadLeave = useCallback(async () => { const r = await api("GET", "/api/leave"); if (r.ok) setLeave(r.data); return r; }, []);
  useEffect(() => { reload(); }, [reload]);

  const people = useMemo(() => {
    if (!roster) return null;
    const offMap = new Map(offs.map((o) => [String(o.email).toLowerCase(), o]));
    return roster.map((r, i) => buildPerson(r, i, tools, offMap));
  }, [roster, tools, offs]);

  return <DataContext.Provider value={{ people, docs, profile, records, leave, setProfile, reload, reloadLeave, setRoster }}>{children}</DataContext.Provider>;
}
