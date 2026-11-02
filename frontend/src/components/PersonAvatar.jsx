import { useData } from "../data.jsx";
import { initials } from "./ui.jsx";
import { AVATAR_COLORS } from "../lib/people.js";
import { lc } from "../lib/useLeave.js";

/* A person's round picture: their profile photo when they have one, otherwise initials on their usual colour. */
export default function PersonAvatar({ email, name }) {
  const { people } = useData();
  const known = (people || []).find((x) => lc(x.email) === lc(email));
  const color = known ? known.color : AVATAR_COLORS[String(name || "").length % AVATAR_COLORS.length];
  const photoV = known && known.photoV;
  return (
    <span className="avatar" style={{ background: photoV ? "transparent" : color }}>
      {photoV ? <img src={`/api/profile/photo?email=${encodeURIComponent(email)}&v=${photoV}`} alt="" /> : initials(name)}
    </span>
  );
}
