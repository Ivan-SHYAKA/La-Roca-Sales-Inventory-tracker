import { useState } from "react";
import { Input, ConfirmModal } from "../ui";
import { orderLabel } from "../../lib/format";

export function CancelModal({ group, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <ConfirmModal title={`Cancel order — ${orderLabel(group)}?`} confirmLabel="Confirm cancel" confirmColor="var(--ember)" busy={busy}
      onConfirm={() => onConfirm(reason.trim() || "Not specified")} onClose={onClose}>
      <p className="text-xs text-[var(--basalt)]/60 mb-2">{group.items.map((it) => `${it.qty}× ${it.name}`).join(", ")}</p>
      <label className="text-xs text-[var(--basalt)]/60">Reason for cancelling</label>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. client changed their mind" autoFocus />
    </ConfirmModal>
  );
}
