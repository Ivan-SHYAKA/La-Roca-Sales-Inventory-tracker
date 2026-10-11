import { useState } from "react";
import { Input, ConfirmModal, Req, MissingHint } from "../ui";
import { fmt, orderLabel } from "../../lib/format";

// The manager removing a billed invoice, or sales / receptionist asking for it to be
// removed. Either way a reason is needed; the wording below is the only difference.
export function RemoveInvoiceModal({ group, mode, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const asking = mode === "request";
  const missing = reason.trim().length >= 3 ? [] : ["a reason"];
  return (
    <ConfirmModal
      title={asking ? `Ask to remove — ${orderLabel(group)}?` : `Remove invoice — ${orderLabel(group)}?`}
      confirmLabel={asking ? "Send request" : "Remove invoice"}
      confirmColor="var(--ember)"
      busy={busy}
      onConfirm={() => { if (!missing.length) onConfirm(reason.trim()); }}
      onClose={onClose}>
      <p className="text-xs text-[var(--basalt)]/60 mb-2">
        {group.items.map((it) => `${it.qty}× ${it.name}`).join(", ")} · RWF {fmt(group.total)}
      </p>
      <p className="text-xs text-[var(--basalt)]/60 mb-3">
        {asking
          ? "Nothing is removed until the manager approves. They will see your reason."
          : "The invoice stops counting in sales and revenue. It is kept in the Removed invoices list, where you can restore it."}
      </p>
      <label className="text-xs text-[var(--basalt)]/60">Reason<Req /></label>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. billed twice by mistake" autoFocus />
      <MissingHint items={missing} className="mt-2" />
    </ConfirmModal>
  );
}

// Manager answering a request: approving removes the invoice, rejecting keeps it.
export function AnswerRequestModal({ request, approve, busy, onClose, onConfirm }) {
  const [note, setNote] = useState("");
  return (
    <ConfirmModal
      title={approve ? "Approve removal?" : "Reject removal?"}
      confirmLabel={approve ? "Approve and remove" : "Reject"}
      confirmColor={approve ? "var(--moss)" : "var(--ember)"}
      busy={busy}
      onConfirm={() => onConfirm(note.trim())}
      onClose={onClose}>
      <p className="text-sm mb-1">Invoice for <b>{request.label}</b> · RWF {fmt(request.total)}</p>
      <p className="text-xs text-[var(--basalt)]/60 mb-3">Asked by {request.requestedBy}: “{request.reason}”</p>
      <label className="text-xs text-[var(--basalt)]/60">{approve ? "Note (optional)" : "Message to them (optional)"}</label>
      <Input value={note} onChange={(e) => setNote(e.target.value)} />
    </ConfirmModal>
  );
}

export function RestoreModal({ group, busy, onClose, onConfirm }) {
  return (
    <ConfirmModal title={`Restore invoice — ${orderLabel(group)}?`} confirmLabel="Restore" confirmColor="var(--moss)" busy={busy} onConfirm={onConfirm} onClose={onClose}>
      <p className="text-sm">This puts the invoice (RWF {fmt(group.total)}) back into billed sales and revenue.</p>
    </ConfirmModal>
  );
}
