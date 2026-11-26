import { createContext, useContext, useEffect, useState } from "react";
import { api, apiShared } from "./api.js";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

/* Who is signed in, and whether they approve anyone's leave (a reporting manager, HR staff included, or a director who approves HR staff's leave). */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isManager, setIsManager] = useState(false);
  useEffect(() => {
    api("GET", "/api/me").then((r) => { if (r.ok) setUser(r.data); });
  }, []);
  useEffect(() => {
    if (!user) return;
    apiShared("/api/leave").then((r) => {
      if (!r.ok) return;
      const me = user.email.toLowerCase(), approvers = Object.values(r.data.approvers || {});
      setIsManager(approvers.includes(me));   // decides someone's leave: above them in the reporting lines, or a super admin
    });
  }, [user]);
  if (!user) return null;
  // can("leave.approve") is true when the person holds that permission for the company or for some team (the server checks the person).
  const access = user.access || {};
  // The server's list is the answer, super admins included: it already holds everything for them except the salary permissions,
  // which only the salary owner has (backend/src/access-rules.js).
  const can = (perm) => access[perm] != null;
  // canAll("x"): holds it for the whole company (company-level screens and settings). canAny(...perms): any of them, in any scope.
  const canAll = (perm) => access[perm] === "company";
  const canAny = (...perms) => perms.some(can);
  return <AuthContext.Provider value={{ user, isHr: user.role === "hr", itAdmin: !!user.itAdmin || user.role === "hr", isManager, payrollReviewer: !!user.payrollReviewer, financeViewer: !!user.financeViewer,
    superAdmin: !!user.superAdmin, access, can, canAll, canAny }}>{children}</AuthContext.Provider>;
}
