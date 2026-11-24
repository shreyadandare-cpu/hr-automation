import { useState } from "react";
import { api, apiMsg } from "../../api.js";
import ConfirmDialog from "../../components/ConfirmDialog.jsx";
import Modal, { Field } from "../../components/Modal.jsx";
import { Callout, ListSkeleton, Pill, SectionHead } from "../../components/ui.jsx";
import { useToast } from "../../components/toast.jsx";
import { problems, useList, when } from "../engage/shared.jsx";

/* Slack and Microsoft Teams, as Keka's integrations: HR adds a channel's incoming webhook link and chooses the company news
   it gets (announcements, who is on leave today, celebrations, open roles, praise). Nothing private is ever posted: leave
   shows names only, never the kind of leave. The link is stored encrypted and shown only as its last characters. */
const TONE = { sent: "ok", skipped: "mute", failed: "bad" };
const STATUS = { sent: "Sent", skipped: "Not sent (test server)", failed: "Failed" };
const HOW = {
  slack: "In Slack, open the channel's settings, choose Integrations, then Add an app, and add Incoming Webhooks. Copy the webhook URL it gives you.",
  teams: "In Teams, open the channel's menu, choose Workflows, then \"Post to a channel when a webhook request is received\". Copy the link it gives you.",
};

export default function ChatChannels() {
  const { data, error, reload } = useList("/api/chat-channels");
  const toast = useToast();
  const [edit, setEdit] = useState(null), [removing, setRemoving] = useState(null), [testing, setTesting] = useState(0);
  if (error && !(data && data.channels)) return <section className="section"><SectionHead title="Slack and Teams" /><Callout>{error}</Callout></section>;
  const test = async (c) => {
    setTesting(c.id);
    const r = await api("POST", `/api/chat-channels/${c.id}/test`);
    setTesting(0); reload();
    if (!r.ok) return toast(apiMsg(r));
    toast(r.data.status === "sent" ? `A test message was posted to ${c.name}.` : r.data.status === "skipped" ? "This is a test server, so nothing was posted. It is recorded below." : `The test message could not be posted: ${r.data.error}`);
  };
  const remove = async (c) => {
    const r = await api("DELETE", `/api/chat-channels/${c.id}`);
    setRemoving(null);
    if (!r.ok) toast(apiMsg(r)); else { toast(`${c.name} was removed.`); reload(); }
  };
  return (
    <section className="section">
      <SectionHead title="Slack and Teams" sub="Post company news to your chat channels: announcements, who is on leave today, celebrations, open roles and praise."
        actions={data && data.channels ? <button type="button" className="btn primary" onClick={() => setEdit({})} disabled={!data.encryptionReady}>Add a channel</button> : null} />
      {data && !data.encryptionReady && <Callout>Webhook links are stored encrypted, and the server's encryption key is not set yet. Please ask the technical team to set it before adding a channel.</Callout>}
      {data && data.channels && !data.sendsForReal && <Callout>This is a test server, so messages are recorded below but never posted.</Callout>}
      <div className="card">
        <div className="card-h"><h3>Channels</h3></div>
        {!data ? <ListSkeleton faces={false} rows={3} /> : data.channels.length ? (
          <ul className="m-0 flex list-none flex-col p-0">{data.channels.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-line px-6 py-4 first:border-t-0 max-sm:px-4">
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2"><b className="font-bold">{c.name}</b><Pill tone="info">{data.kinds[c.kind]}</Pill>{!c.enabled && <Pill tone="mute">Paused</Pill>}</span>
                <span className="text-[14px] text-ink-dim">{c.events.map((e) => data.events[e]).filter(Boolean).join(" · ")}</span>
                <span className="text-[14px] text-ink-faint break-all">{c.link}</span>
              </span>
              <span className="inline-flex flex-wrap gap-2">
                <button type="button" className="btn glass sm" disabled={testing === c.id} onClick={() => test(c)}>{testing === c.id ? "Sending…" : "Send a test"}</button>
                <button type="button" className="btn glass sm" onClick={() => setEdit(c)}>Edit</button>
                <button type="button" className="btn glass sm" onClick={() => setRemoving(c)}>Remove</button>
              </span>
            </li>))}</ul>)
          : <div className="empty">No channels yet. Add one to post company news to Slack or Teams.</div>}
      </div>
      {data && data.log && data.log.length > 0 && (
        <div className="card">
          <div className="card-h"><h3>Latest messages</h3></div>
          <div className="tbl-wrap"><table>
            <thead><tr><th>When</th><th>Channel</th><th>Message</th><th>Result</th></tr></thead>
            <tbody>{data.log.map((x) => (
              <tr key={x.id}><td>{when(x.at)}</td><td>{x.channel}</td><td>{x.title}</td>
                <td><Pill tone={TONE[x.status]}>{STATUS[x.status]}</Pill>{x.status === "failed" && x.error && <div className="text-[13px] text-ink-dim">{x.error}</div>}</td></tr>))}</tbody>
          </table></div>
        </div>)}
      {edit && data && <ChannelForm c={edit} kinds={data.kinds} events={data.events} onClose={(saved) => { setEdit(null); if (saved) reload(); }} />}
      {removing && <ConfirmDialog title={`Remove ${removing.name}?`} confirmLabel="Remove channel" onConfirm={() => remove(removing)} onClose={() => setRemoving(null)}>
        Nothing more is posted to this channel, and its saved link is deleted.</ConfirmDialog>}
    </section>
  );
}

function ChannelForm({ c, kinds, events, onClose }) {
  const toast = useToast();
  const editing = !!c.id;
  const [f, setF] = useState({ kind: c.kind || "slack", name: c.name || "", url: "", events: c.events || ["announcements"], enabled: c.enabled !== false });
  const [err, setErr] = useState({}), [busy, setBusy] = useState(false);
  const toggle = (k) => setF({ ...f, events: f.events.includes(k) ? f.events.filter((x) => x !== k) : [...f.events, k] });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const r = await api(editing ? "PUT" : "POST", editing ? `/api/chat-channels/${c.id}` : "/api/chat-channels", f);
    setBusy(false);
    if (!r.ok) { setErr({ ...problems(r), form: r.data && r.data.errors ? "" : apiMsg(r) }); return; }
    toast(editing ? `${f.name} was saved.` : `${f.name} was added. Send a test to check it.`); onClose(true);
  };
  return (
    <Modal onClose={busy ? () => {} : () => onClose(false)}>
      <form onSubmit={save} noValidate>
        <div className="card-h"><h3>{editing ? `Edit ${c.name}` : "Add a channel"}</h3></div>
        <div className="card-b">
          {err.form && <Callout><span role="alert">{err.form}</span></Callout>}
          <Field id="ch-kind" label="Where" error={err.kind}>
            <select id="ch-kind" className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          <Field id="ch-name" label="Channel name" hint="As people know it, for example #general." error={err.name}>
            <input id="ch-name" className="input" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-invalid={!!err.name} />
          </Field>
          <Field id="ch-url" label="Incoming webhook link" hint={`${HOW[f.kind]}${editing ? " Leave it empty to keep the saved link." : ""}`} error={err.url}>
            <input id="ch-url" className="input" type="url" inputMode="url" autoComplete="off" spellCheck={false} value={f.url} placeholder={editing ? c.link : "https://"} onChange={(e) => setF({ ...f, url: e.target.value })} aria-invalid={!!err.url} />
          </Field>
          <fieldset className="m-0 flex flex-col border-0 p-0">
            <legend className="mb-1 p-0 font-bold">What to post</legend>
            {Object.entries(events).map(([k, l]) => (
              <label key={k} className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 flex-none accent-accent" checked={f.events.includes(k)} onChange={() => toggle(k)} />{l}</label>))}
            {err.events && <span className="ferr" role="alert">{err.events}</span>}
          </fieldset>
          <label className="mt-2 flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 flex-none accent-accent" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />Post to this channel (untick to pause)</label>
        </div>
        <div className="modal-f"><button type="button" className="btn glass" onClick={() => onClose(false)} disabled={busy}>Cancel</button><button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save channel"}</button></div>
      </form>
    </Modal>
  );
}
