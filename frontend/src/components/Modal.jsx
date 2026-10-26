import { useEffect } from "react";

/* A dialog over a dimmed page. Escape or a click outside closes it. */
export default function Modal({ onClose, children }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

export const Field = ({ id, label, hint, error, children }) => (
  <div className="field"><label htmlFor={id}>{label}</label>{children}{hint && <span className="hint">{hint}</span>}{error && <span className="ferr" role="alert">{error}</span>}</div>
);
