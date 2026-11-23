import { useRef, useState } from "react";

/* Six boxes for a PIN. One real (invisible) input sits over them, so typing, pasting, the phone keypad and password managers all
   work, and a screen reader meets an ordinary labelled field. Only digits are accepted; the digits are shown as dots (or as digits when `plain` is set, for the emailed code). */
export default function PinInput({ id, label, value, onChange, onEnter, autoFocus = false, disabled = false, invalid = false, plain = false }) {
  const [focus, setFocus] = useState(false);
  const box = useRef(null);
  return (
    <div className="text-left">
      <label htmlFor={id} className="mb-2 block text-[13px] font-bold text-ink">{label}</label>
      <div className="relative" onClick={() => box.current && box.current.focus()}>
        <input ref={box} id={id} type={plain ? "text" : "password"} inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={6} value={value} disabled={disabled}
          autoFocus={autoFocus} aria-invalid={invalid || undefined} aria-label={`${label}, 6 digits`}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => { if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); } }}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          className="absolute inset-0 z-10 m-0 h-full w-full cursor-text border-0 bg-transparent p-0 text-transparent opacity-0" />
        <div className="grid grid-cols-6 gap-2 max-xs:gap-1.5" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className={`grid h-14 place-items-center rounded-field border bg-paper font-display text-[28px] leading-none text-ink transition-colors ${disabled ? "opacity-60" : ""} ${focus && i === Math.min(value.length, 5) ? "border-accent ring-2 ring-orange" : invalid ? "border-bad" : "border-ink-faint"}`}>
              {value[i] ? (plain ? value[i] : "•") : ""}
            </span>))}
        </div>
      </div>
    </div>
  );
}
