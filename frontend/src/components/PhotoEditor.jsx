import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "./Modal.jsx";

const loadImage = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("The picture could not be read.")); img.src = src; });

const VIEW = 340, OUT = 1200;

/* Crop and adjust a photo: drag it to move, zoom with the slider (or mouse wheel), turn it in 90 degree steps. The square you see
   is the picture that goes on the poster. */
export default function PhotoEditor({ src, onApply, onClose }) {
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [turn, setTurn] = useState(0);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [err, setErr] = useState("");
  const canvas = useRef(null), drag = useRef(null);
  useEffect(() => { loadImage(src).then(setImg).catch(() => setErr("The picture could not be opened.")); }, [src]);

  const dims = useCallback(() => {
    const w = turn % 2 ? img.height : img.width, h = turn % 2 ? img.width : img.height;
    return { w, h, base: VIEW / Math.min(w, h) };
  }, [img, turn]);
  const clamp = useCallback((o, z) => {   // the picture must always cover the square
    const { w, h, base } = dims(), mx = Math.max(0, (w * base * z - VIEW) / 2), my = Math.max(0, (h * base * z - VIEW) / 2);
    return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) };
  }, [dims]);
  const paint = useCallback((ctx, size) => {
    const { base } = dims(), f = size / VIEW, s = base * zoom * f;
    ctx.fillStyle = "#222"; ctx.fillRect(0, 0, size, size);
    ctx.save(); ctx.translate(size / 2 + off.x * f, size / 2 + off.y * f); ctx.rotate((turn * Math.PI) / 2); ctx.scale(s, s);
    ctx.drawImage(img, -img.width / 2, -img.height / 2); ctx.restore();
  }, [img, zoom, turn, off, dims]);
  useEffect(() => { if (img && canvas.current) paint(canvas.current.getContext("2d"), VIEW); }, [img, paint]);

  const move = (e) => { if (drag.current) setOff(clamp({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y }, zoom)); };
  const setZ = (z) => { setZoom(z); setOff((o) => clamp(o, z)); };
  const rotate = () => { setTurn((t) => (t + 1) % 4); setOff({ x: 0, y: 0 }); };
  const apply = () => {
    const c = document.createElement("canvas"); c.width = c.height = OUT;
    paint(c.getContext("2d"), OUT);
    c.toBlob((b) => (b ? onApply(URL.createObjectURL(b)) : setErr("The picture could not be saved.")), "image/jpeg", 0.92);
  };

  return (
    <Modal onClose={onClose}>
      <div style={{ display: "grid", gap: 16, justifyItems: "center" }}>
        <h3 style={{ margin: 0 }}>Adjust photo</h3>
        <p className="muted" style={{ margin: 0 }}>Drag to move, zoom to crop. The square is what appears on the poster.</p>
        {err ? <div className="empty">{err}</div> : (
          <canvas ref={canvas} width={VIEW} height={VIEW} className="cel-crop" aria-label="Photo crop area"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y }; }}
            onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
            onWheel={(e) => setZ(Math.min(4, Math.max(1, zoom - e.deltaY / 500)))} />)}
        <label style={{ display: "flex", gap: 12, alignItems: "center", width: VIEW }}>
          <span className="muted">Zoom</span>
          <input type="range" min="1" max="4" step="0.01" value={zoom} onChange={(e) => setZ(Number(e.target.value))} style={{ flex: 1, accentColor: "var(--purple)" }} aria-label="Zoom" />
        </label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <button type="button" className="btn glass sm" onClick={rotate}>Rotate</button>
          <button type="button" className="btn glass sm" onClick={() => { setZoom(1); setOff({ x: 0, y: 0 }); setTurn(0); }}>Reset</button>
          <button type="button" className="btn glass" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={!img} onClick={apply}>Apply</button>
        </div>
      </div>
    </Modal>
  );
}
