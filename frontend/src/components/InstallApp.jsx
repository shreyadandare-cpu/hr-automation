import { useState } from "react";
import { PRODUCT } from "../brand.js";
import { useInstall } from "../lib/pwa.js";

/* "Get the app" on Home: shown on a phone or computer that can install Wohlig One and has not yet, until the person
   installs it or says not now (remembered on this device). On an iPhone it explains Share, then Add to Home Screen. */
const KEY = "wohlig-install-dismissed";
const dismissed = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
export default function InstallApp() {
  const { can, ios, install } = useInstall();
  const [hide, setHide] = useState(dismissed);
  if (hide || (!can && !ios)) return null;
  const notNow = () => { try { localStorage.setItem(KEY, "1"); } catch { /* private window: shown again next time */ } setHide(true); };
  return (
    <div className="card flex flex-col gap-3 p-5">
      <div className="flex items-center gap-3">
        <img src="/app-icon-192.png" alt="" width="44" height="44" className="size-11 flex-none rounded-field" />
        <div className="min-w-0"><b className="block font-display text-[18px] font-medium">Get the {PRODUCT} app</b>
          <span className="text-[14px] text-ink-dim">{ios ? "Tap Share, then Add to Home Screen. It opens like any other app." : "Open it from your home screen or desktop, like any other app."}</span></div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn glass sm" onClick={notNow}>Not now</button>
        {can && <button type="button" className="btn primary sm" onClick={async () => { if (await install()) setHide(true); }}>Install</button>}
      </div>
    </div>
  );
}
