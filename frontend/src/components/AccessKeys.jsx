import { useEffect, useState } from "react";
import { api, apiMsg } from "../api.js";
import { PRODUCT } from "../brand.js";
import Modal, { Field } from "./Modal.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import { ListSkeleton, shortDate } from "./ui.jsx";

/* Account > Access keys for Claude: the Wohlig One connector (docs/MCP_CONNECTOR.md). The address to add in Claude, the apps
   connected through it (Disconnect), and personal access keys for setups that cannot sign in. The server keeps only a key's
   hash, so a new key is shown once, here, and never again. */
const DAYS = [[30, "30 days"], [90, "90 days"], [180, "180 days"], [365, "One year"]];

export function AccessKeysCard({ toast }) {
  const [keys, setKeys] = useState(null);
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState(null);       // { key, secret } just made, shown once
  const [revoking, setRevoking] = useState(null);
  const [apps, setApps] = useState(null);
  const [ending, setEnding] = useState(null);
  const load = () => Promise.all([
    api("GET", "/api/access-keys").then((r) => setKeys(r.ok ? r.data.keys : [])),
    api("GET", "/api/oauth/grants").then((r) => setApps(r.ok ? r.data.grants : [])),
  ]);
  useEffect(() => { load(); }, []);
  const address = `${location.origin}/mcp`;
  const copyAddress = async () => {
    try { await navigator.clipboard.writeText(address); toast("The connector address is copied."); }
    catch { toast("Please select the address and copy it."); }
  };
  const disconnect = async () => {
    const r = await api("DELETE", `/api/oauth/grants/${ending.id}`);
    toast(r.ok ? `"${ending.name}" is disconnected.` : apiMsg(r));
    setEnding(null);
    load();
  };

  const revoke = async () => {
    const r = await api("DELETE", `/api/access-keys/${revoking.id}`);
    toast(r.ok ? `The access key "${revoking.name}" is revoked.` : apiMsg(r));
    setRevoking(null);
    load();
  };

  return (
    <div className="card"><div className="card-h"><h3>Access keys for Claude</h3></div><div className="card-b">
      <p className="m-0 mb-3 max-w-[64ch] text-[15px] text-ink-dim">
        Claude can work in {PRODUCT} for you: it can do what you can do here, and nothing more. Salaries, payments, tax, bank details,
        documents and access rights are never available to it. To connect, add this address in Claude under Settings &gt; Connectors &gt;
        Add custom connector, then choose Connect and sign in.
      </p>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <code className="min-w-0 rounded-field border border-line bg-tint px-3 py-2 font-mono text-[15px] text-ink [overflow-wrap:anywhere]">{address}</code>
        <button type="button" className="btn glass" onClick={copyAddress}>Copy address</button>
      </div>
      <h4 className="m-0 mb-2 font-display text-[17px] font-semibold text-ink">Connected apps</h4>
      {!apps ? <ListSkeleton rows={1} faces={false} /> : apps.length === 0
        ? <p className="m-0 mb-5 text-[15px] text-ink-dim">No apps are connected yet.</p>
        : <ul className="m-0 mb-5 flex list-none flex-col gap-0 p-0">
          {apps.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
              <div className="min-w-0">
                <div className="font-bold text-ink [overflow-wrap:anywhere]">{g.name}</div>
                <div className="text-[14px] text-ink-dim">Connected {shortDate(g.createdAt)}{g.lastUsedAt ? ` · Last used ${shortDate(g.lastUsedAt)}` : ""}</div>
              </div>
              <button type="button" className="btn glass" onClick={() => setEnding(g)} aria-label={`Disconnect ${g.name}`}>Disconnect</button>
            </li>
          ))}
        </ul>}
      <h4 className="m-0 mb-2 font-display text-[17px] font-semibold text-ink">Access keys</h4>
      <p className="m-0 mb-3 max-w-[64ch] text-[15px] text-ink-dim">
        Only for a setup that cannot sign in, such as a script. Please keep a key private, and revoke it when you no longer use it.
      </p>
      {!keys ? <ListSkeleton rows={2} faces={false} /> : keys.length === 0
        ? <p className="m-0 mb-3 text-[15px] text-ink-dim">You have no access keys yet.</p>
        : <ul className="m-0 mb-4 flex list-none flex-col gap-0 p-0">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
              <div className="min-w-0">
                <div className="font-bold text-ink [overflow-wrap:anywhere]">{k.name}</div>
                <div className="text-[14px] text-ink-dim">
                  <span className="font-mono">{k.hint}…</span> · Made {shortDate(k.createdAt)} · Ends {shortDate(k.expiresAt)}
                  {" · "}{k.lastUsedAt ? `Last used ${shortDate(k.lastUsedAt)}` : "Not used yet"}
                </div>
              </div>
              <button type="button" className="btn glass" onClick={() => setRevoking(k)} aria-label={`Revoke the access key ${k.name}`}>Revoke</button>
            </li>
          ))}
        </ul>}
      {keys && <button type="button" className="btn glass" onClick={() => setMaking(true)}>Make an access key</button>}
      {making && <MakeKeyDialog onClose={() => setMaking(false)} onMade={(m) => { setMaking(false); setMade(m); load(); }} />}
      {made && <NewKeyDialog made={made} toast={toast} onClose={() => setMade(null)} />}
      {ending && <ConfirmDialog title="Disconnect this app?" confirmLabel="Disconnect" danger onConfirm={disconnect} onClose={() => setEnding(null)}>
        "{ending.name}" will no longer be able to use {PRODUCT}. You can connect it again from Claude at any time.
      </ConfirmDialog>}
      {revoking && <ConfirmDialog title="Revoke this access key?" confirmLabel="Revoke key" danger onConfirm={revoke} onClose={() => setRevoking(null)}>
        Claude will no longer be able to use "{revoking.name}". This cannot be undone; you can make a new key at any time.
      </ConfirmDialog>}
    </div></div>
  );
}

function MakeKeyDialog({ onClose, onMade }) {
  const [f, setF] = useState({ name: "", days: 90 });
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);   // the server asked for a new sign-in first
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr({}); setFresh(false);
    const r = await api("POST", "/api/access-keys", f);
    setBusy(false);
    if (!r.ok && r.data && r.data.needsFreshSignIn) { setFresh(true); return; }
    if (!r.ok) { const fe = (r.data && r.data.errors) || {}; setErr(fe.name || fe.days ? fe : { name: apiMsg(r) }); return; }
    onMade(r.data);
  };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>Make an access key</h3></div>
      <form onSubmit={submit} noValidate>
        <div className="card-b">
          <Field id="ak-name" label="Name" hint="Something that tells you where it is used, for example Work laptop." error={err.name}>
            <input id="ak-name" className="input" maxLength={60} data-autofocus value={f.name} aria-invalid={!!err.name}
              onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field id="ak-days" label="Works for" error={err.days}>
            <select id="ak-days" className="input" value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })}>
              {DAYS.map(([d, label]) => <option key={d} value={d}>{label}</option>)}
            </select>
          </Field>
          {fresh && <div role="alert" className="flex flex-col items-start gap-2 rounded-field border border-line bg-tint px-4 py-3 text-[15px] text-ink">
            For your safety, a key can be made only within 30 minutes of signing in. Please sign out, sign in again, and make the key then.
            <button type="button" className="btn glass sm" onClick={async () => { await api("POST", "/api/logout"); location.href = "/login"; }}>Sign in again</button>
          </div>}
        </div>
        <div className="modal-f">
          <button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !f.name.trim()}>{busy ? "Making…" : "Make key"}</button>
        </div>
      </form>
    </Modal>
  );
}

function NewKeyDialog({ made, toast, onClose }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(made.secret); toast("The access key is copied."); }
    catch { toast("Please select the key and copy it."); }
  };
  return (
    <Modal onClose={onClose}>
      <div className="card-h"><h3>Your new access key</h3></div>
      <div className="card-b">
        <p className="m-0 text-[15px] text-ink-dim">
          Please copy this key now and add it to the {PRODUCT} connector in Claude. For your safety it is shown only once; if you lose it,
          revoke it and make a new one.
        </p>
        <Field id="ak-secret" label={`Access key "${made.key.name}"`}>
          <textarea id="ak-secret" className="input h-auto resize-none font-mono [overflow-wrap:anywhere]" rows={2} readOnly spellCheck={false}
            value={made.secret} data-autofocus onFocus={(e) => e.target.select()} />
        </Field>
      </div>
      <div className="modal-f">
        <button type="button" className="btn glass" onClick={onClose}>Done</button>
        <button type="button" className="btn primary" onClick={copy}>Copy key</button>
      </div>
    </Modal>
  );
}
