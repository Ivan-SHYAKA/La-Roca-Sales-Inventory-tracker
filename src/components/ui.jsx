import { useState } from "react";
import { Eye, EyeOff, AlertTriangle, CheckCircle2 } from "lucide-react";

export function Card({ children, className = "", ...props }) {
  return (
    <div {...props} className={`bg-[var(--cream)] border border-[var(--basalt)]/10 rounded-md p-5 ${className}`} style={{ boxShadow: "0 1px 0 rgba(38,34,29,0.04)" }}>
      {children}
    </div>
  );
}
export function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="flex gap-[2px]">
        <div className="w-1 h-4 rounded-full" style={{ background: "#B54A28" }} />
        <div className="w-1 h-4 rounded-full" style={{ background: "#46583F" }} />
        <div className="w-1 h-4 rounded-full" style={{ background: "#B8923F" }} />
      </div>
      <span className="uppercase tracking-wider text-xs font-semibold text-[var(--basalt)]/70" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{children}</span>
    </div>
  );
}
export function Input(props) {
  return <input {...props} className={`w-full border border-[var(--basalt)]/15 rounded px-2 py-1.5 text-sm mt-1 bg-white ${props.className || ""}`} />;
}
// Same as Input, but for passwords: adds a show/hide eye toggle so staff can
// check what they typed before submitting, especially on a shared tablet.
export function PasswordInput({ className = "", ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative mt-1">
      <input {...props} type={show ? "text" : "password"}
        className={`w-full border border-[var(--basalt)]/15 rounded px-2 py-1.5 pr-9 text-sm bg-white ${className}`} />
      <button type="button" tabIndex={-1} onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--basalt)]/40 hover:text-[var(--basalt)]/70">
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}
export function Select({ children, ...props }) {
  return <select {...props} className="w-full border border-[var(--basalt)]/15 rounded px-2 py-1.5 text-sm mt-1 bg-white">{children}</select>;
}
export function Badge({ color, children }) {
  return <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: color + "22", color }}>{children}</span>;
}
export function PrimaryBtn({ children, color = "var(--ember)", disabled, className = "", ...props }) {
  return (
    <button {...props} disabled={disabled}
      className={`flex items-center gap-1.5 px-4 py-2 rounded text-sm font-medium text-white ${disabled ? "cursor-not-allowed" : ""} ${className}`}
      style={{ background: color, opacity: disabled ? 0.45 : 1 }}>
      {children}
    </button>
  );
}
export function StatusBadge({ status }) {
  const map = { placed: "#26221D", ready: "#8A6FB0", cancelled: "#B54A28", served: "#B8923F", billed: "#46583F" };
  return <Badge color={map[status]}>{status}</Badge>;
}
// Generic acknowledgement/confirmation popup: used anywhere a status-changing action
// (mark ready, mark served, cancel, etc.) should require an explicit "yes" instead of
// firing on a single click, and anywhere follow-up details need to be reviewed first.
export function ConfirmModal({ title, children, confirmLabel = "Confirm", confirmColor = "var(--moss)", busy, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 no-print" onClick={onClose}>
      <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <SectionLabel>{title}</SectionLabel>
        {children}
        <div className="flex gap-2 mt-4">
          <PrimaryBtn color={confirmColor} disabled={busy} onClick={onConfirm}>{busy ? "Working…" : confirmLabel}</PrimaryBtn>
          <button onClick={onClose} className="px-4 py-2 rounded text-sm border border-[var(--basalt)]/20">Cancel</button>
        </div>
      </Card>
    </div>
  );
}
export function FlagsPanel({ flags }) {
  return (
    <Card>
      <SectionLabel>Operational flags</SectionLabel>
      {flags.length === 0 ? (
        <p className="text-sm text-[var(--basalt)]/50 flex items-center gap-2"><CheckCircle2 size={16} /> No inconsistencies detected right now.</p>
      ) : (
        <ul className="space-y-2">
          {flags.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-sm">
              <AlertTriangle size={14} color={f.severity === "high" ? "var(--ember)" : "var(--gold)"} />
              <Badge color={f.severity === "high" ? "var(--ember)" : "var(--gold)"}>{f.role}</Badge>
              {f.msg}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
