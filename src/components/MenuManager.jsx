import { useState, useEffect } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Card, SectionLabel, Input, Select, Badge, PrimaryBtn, ConfirmModal } from "./ui";
import { ItemPicker } from "./ItemPicker";
import { LINES } from "../lib/constants";
import { fmt } from "../lib/format";
import { draftGet, draftSet, draftClear } from "../lib/draft";
import { addMenuItem, updateMenuItem, removeMenuItem } from "../lib/data";

const emptyForm = { name: "", line: "restaurant", price: "", prepMinutes: "" };

export function MenuManager({ menu, inventory, session, refresh, onError }) {
  const draftKey = `lr-draft-menu-${session.username}`;
  const [form, setForm] = useState(emptyForm);
  const [recipe, setRecipe] = useState([]);
  const [editingItem, setEditingItem] = useState(null);

  useEffect(() => {
    const d = draftGet(draftKey);
    if (d) { setForm(d.form || emptyForm); setRecipe(d.recipe || []); }
  }, []);
  useEffect(() => { draftSet(draftKey, { form, recipe }); }, [form, recipe]);

  const addRow = () => setRecipe([...recipe, { invId: inventory[0]?.id || "", qty: "" }]);
  const updateRow = (i, patch) => setRecipe(recipe.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const removeRow = (i) => setRecipe(recipe.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!form.name || !form.price) return;
    try {
      await addMenuItem(form, recipe);
      setForm({ name: "", line: form.line, price: "", prepMinutes: "" }); setRecipe([]); draftClear(draftKey);
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't save the menu item — check your connection and try again.");
    }
  };
  const remove = async (id) => {
    try {
      await removeMenuItem(id);
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't remove the menu item — check your connection and try again.");
    }
  };

  return (
    <div className="space-y-6">
      {editingItem && (
        <EditMenuItemModal item={editingItem} inventory={inventory} onClose={() => setEditingItem(null)}
          onSaved={async () => { setEditingItem(null); await refresh(); }} onError={onError} />
      )}
      <Card>
        <SectionLabel>Add menu / offering item</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="text-xs text-[var(--basalt)]/60">Name</label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Cappuccino" /></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Line</label><Select value={form.line} onChange={(e) => setForm({ ...form, line: e.target.value })}>{Object.entries(LINES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Price (RWF)</label><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Prep time (min)</label><Input type="number" value={form.prepMinutes} onChange={(e) => setForm({ ...form, prepMinutes: e.target.value })} /></div>
        </div>
        <div className="mt-4">
          <div className="text-xs text-[var(--basalt)]/60 mb-2">Recipe (ingredients consumed per unit sold — used for inventory reconciliation)</div>
          {recipe.map((r, i) => (
            <div key={i} className="flex gap-2 mb-2 items-center">
              <ItemPicker items={inventory} value={r.invId} onChange={(invId) => updateRow(i, { invId })}
                getLabel={(inv) => `${inv.name} (${inv.unit})`} placeholder="Search ingredient…" className="flex-1" />
              <Input type="number" placeholder="qty per unit" value={r.qty} onChange={(e) => updateRow(i, { qty: e.target.value })} />
              <button onClick={() => removeRow(i)}><Trash2 size={14} className="text-[var(--basalt)]/40" /></button>
            </div>
          ))}
          <button onClick={addRow} className="text-xs flex items-center gap-1 text-[var(--basalt)]/60"><Plus size={12} /> Add ingredient</button>
        </div>
        <div className="flex justify-end mt-4">
          <PrimaryBtn color="var(--moss)" onClick={submit}><Plus size={15} /> Add to menu</PrimaryBtn>
        </div>
        {inventory.length === 0 && <p className="text-xs text-[var(--ember)] mt-2">Add inventory items first (Inventory tab) if you want recipes linked for reconciliation.</p>}
      </Card>

      <Card>
        <SectionLabel>Current menu</SectionLabel>
        {menu.length === 0 ? <p className="text-sm text-[var(--basalt)]/50">No items yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10"><th className="py-2 pr-3">Name</th><th className="py-2 pr-3">Line</th><th className="py-2 pr-3">Price</th><th className="py-2 pr-3">Prep</th><th className="py-2 pr-3">Recipe</th><th></th></tr></thead>
            <tbody>
              {menu.map((m) => (
                <tr key={m.id} className="border-b border-[var(--basalt)]/5">
                  <td className="py-2 pr-3">{m.name}</td>
                  <td className="py-2 pr-3"><Badge color={LINES[m.line].color}>{LINES[m.line].label}</Badge></td>
                  <td className="py-2 pr-3 font-mono text-xs">RWF {fmt(m.price)}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{m.prepMinutes}m</td>
                  <td className="py-2 pr-3 text-xs text-[var(--basalt)]/60">{(m.recipe || []).length} ingredient(s)</td>
                  <td className="py-2 flex gap-3">
                    <button onClick={() => setEditingItem(m)} aria-label={`Edit ${m.name}`}><Pencil size={14} className="text-[var(--basalt)]/40 hover:text-[var(--moss)]" /></button>
                    <button onClick={() => remove(m.id)} aria-label={`Delete ${m.name}`}><Trash2 size={14} className="text-[var(--basalt)]/30 hover:text-[var(--ember)]" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function EditMenuItemModal({ item, inventory, onClose, onSaved, onError }) {
  const [form, setForm] = useState({ name: item.name, line: item.line, price: String(item.price), prepMinutes: String(item.prepMinutes) });
  const [recipe, setRecipe] = useState((item.recipe || []).map((r) => ({ invId: r.invId, qty: String(r.qty) })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const addRow = () => setRecipe([...recipe, { invId: inventory[0]?.id || "", qty: "" }]);
  const updateRow = (i, patch) => setRecipe(recipe.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const removeRow = (i) => setRecipe(recipe.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!form.name.trim() || !form.price) { setError("Name and price are required."); return; }
    setBusy(true); setError("");
    try {
      await updateMenuItem(item.id, form, recipe);
      onSaved();
    } catch (e) {
      setError(e.message || "Couldn't save the menu item — check your connection and try again.");
      onError?.(e.message || "Couldn't save the menu item — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmModal title={`Edit ${item.name}`} confirmLabel="Save changes" confirmColor="var(--moss)" busy={busy} onConfirm={save} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs text-[var(--basalt)]/60">Name</label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="text-xs text-[var(--basalt)]/60">Line</label><Select value={form.line} onChange={(e) => setForm({ ...form, line: e.target.value })}>{Object.entries(LINES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></div>
        <div><label className="text-xs text-[var(--basalt)]/60">Price (RWF)</label><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
        <div><label className="text-xs text-[var(--basalt)]/60">Prep time (min)</label><Input type="number" value={form.prepMinutes} onChange={(e) => setForm({ ...form, prepMinutes: e.target.value })} /></div>
      </div>
      <div className="mt-4">
        <div className="text-xs text-[var(--basalt)]/60 mb-2">Recipe (ingredients consumed per unit sold)</div>
        {recipe.map((r, i) => (
          <div key={i} className="flex gap-2 mb-2 items-center">
            <Select value={r.invId} onChange={(e) => updateRow(i, { invId: e.target.value })}>
              {inventory.map((inv) => <option key={inv.id} value={inv.id}>{inv.name} ({inv.unit})</option>)}
            </Select>
            <Input type="number" placeholder="qty per unit" value={r.qty} onChange={(e) => updateRow(i, { qty: e.target.value })} />
            <button onClick={() => removeRow(i)}><Trash2 size={14} className="text-[var(--basalt)]/40" /></button>
          </div>
        ))}
        <button onClick={addRow} className="text-xs flex items-center gap-1 text-[var(--basalt)]/60"><Plus size={12} /> Add ingredient</button>
      </div>
      {error && <p className="text-xs text-[var(--ember)] mt-2">{error}</p>}
    </ConfirmModal>
  );
}
