import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api.js";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

/* Who is signed in, and whether they approve anyone's leave (a reporting manager, or a director who approves HR staff's leave). */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isManager, setIsManager] = useState(false);
  useEffect(() => {
    api("GET", "/api/me").then((r) => { if (r.ok) setUser(r.data); });
  }, []);
  useEffect(() => {
    if (!user || user.role === "hr") return;
    api("GET", "/api/leave").then((r) => {
      if (!r.ok) return;
      const me = user.email.toLowerCase(), approvers = Object.values(r.data.approvers || {});
      setIsManager(approvers.includes(me) || (approvers.includes("directors") && (r.data.hrLeaveApprovers || []).includes(me)));
    });
  }, [user]);
  if (!user) return null;
  return <AuthContext.Provider value={{ user, isHr: user.role === "hr", isManager }}>{children}</AuthContext.Provider>;
}
