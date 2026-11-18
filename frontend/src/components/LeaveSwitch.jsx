import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { ViewTabs } from "./leaveSummary.jsx";

const PATH = { hr: "/app/leave", my: "/app/my-leave", team: "/app/team-leave" };

/* The tabs that join the leave pages: "Leave management" for HR, "My leave" for everyone, "Team leave" for people who approve a team.
   Shown at the top of each of those pages, with the current one selected. Someone with only My leave sees nothing. */
export default function LeaveSwitch({ current }) {
  const { isHr, isManager } = useAuth();
  const nav = useNavigate();
  const views = [...(isHr ? [["hr", "Leave management"]] : []), ["my", "My leave"], ...(isManager ? [["team", "Team leave"]] : [])];
  if (views.length < 2) return null;
  return <div className="row" style={{ justifyContent: "flex-start" }}><ViewTabs views={views} view={current} onView={(k) => nav(PATH[k])} /></div>;
}
