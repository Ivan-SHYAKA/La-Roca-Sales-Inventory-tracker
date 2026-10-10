import { useState } from "react";
import { Input, ConfirmModal, Req, MissingHint } from "../ui";
import { orderLabel } from "../../lib/format";

export function CancelModal({ group, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <ConfirmModal title={`Cancel order — ${orderLabel(group)}?`} confirmLabel="Confirm cancel" confirmColor="var(--ember)" busy={busy}
      onConfirm={() => { if (reason.trim()) onConfirm(reason.trim()); }} onClose={onClose}>
      <p className="text-xs text-[var(--basalt)]/60 mb-2">{group.items.map((it) => `${it.qty}× ${it.name}`).join(", ")}</p>
      <label className="text-xs text-[var(--basalt)]/60">Reason for cancelling<Req /></label>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. client changed their mind" autoFocus />
      <MissingHint items={reason.trim() ? [] : ["a reason"]} className="mt-2" />
    </ConfirmModal>
  );
}
