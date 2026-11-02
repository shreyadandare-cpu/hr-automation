import { useState } from "react";
import Modal from "./Modal.jsx";

/* A yes/no question in the app's dialog style, instead of the browser's confirm(). onConfirm may be async. */
export default function ConfirmDialog({ title, children, confirmLabel = "Confirm", danger = false, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } };
  return (
    <Modal onClose={busy ? () => {} : onClose}>
      <div className="card-h"><h3>{title}</h3></div>
      <div className="card-b" style={{ color: "var(--ink-dim)", fontSize: 14.5 }}>{children}</div>
      <div className="modal-f">
        <button type="button" className="btn glass" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={`btn ${danger ? "danger" : "primary"}`} onClick={go} disabled={busy} autoFocus>{busy ? "Working…" : confirmLabel}</button>
      </div>
    </Modal>
  );
}
