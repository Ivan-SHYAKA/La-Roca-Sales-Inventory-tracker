import { useState, useRef, useEffect, useMemo } from "react";
import { X } from "lucide-react";

// Searchable combobox for picking one item out of a long list (inventory now runs to
// hundreds of rows) — type to filter by name, click or Enter to select, instead of
// scrolling a giant <select>. `items` need an `id` and `name`; `getLabel` controls what's
// shown for each option (e.g. with quantity/unit appended) and in the input once chosen.
export function ItemPicker({ items, value, onChange, getLabel, placeholder = "Search…", className = "" }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef(null);

  const sorted = useMemo(() => [...items].sort((a, b) => a.name.localeCompare(b.name)), [items]);
  const selected = items.find((i) => i.id === value);

  useEffect(() => {
    if (!open) setQuery(selected ? getLabel(selected) : "");
  }, [value, items, open, selected, getLabel]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((i) => i.name.toLowerCase().includes(q));
  }, [sorted, query]);

  useEffect(() => {
    const onClickOutside = (e) => { if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const choose = (item) => { onChange(item.id); setQuery(getLabel(item)); setOpen(false); };
  const clear = () => { onChange(""); setQuery(""); setOpen(false); };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          value={open ? query : (selected ? getLabel(selected) : query)}
          onFocus={() => { setOpen(true); setQuery(""); setHighlight(0); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlight]) choose(filtered[highlight]); }
            else if (e.key === "Escape") { setOpen(false); }
          }}
          placeholder={placeholder}
          className="w-full border border-[var(--basalt)]/15 rounded px-2 py-1.5 pr-7 text-sm mt-1 bg-white"
        />
        {selected && (
          <button type="button" onClick={clear} aria-label="Clear selection"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--basalt)]/30 hover:text-[var(--basalt)]/60">
            <X size={14} />
          </button>
        )}
      </div>
      {open && (
        <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-auto bg-white border border-[var(--basalt)]/15 rounded shadow-md text-sm">
          {filtered.length === 0 ? (
            <li className="px-2 py-1.5 text-[var(--basalt)]/40">No matches</li>
          ) : filtered.map((item, idx) => (
            <li key={item.id} onClick={() => choose(item)}
              className="px-2 py-1.5 cursor-pointer"
              style={{ background: idx === highlight ? "rgba(38,34,29,0.06)" : "transparent" }}>
              {getLabel(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
