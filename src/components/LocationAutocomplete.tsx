/**
 * LocationAutocomplete — address input with Nominatim suggestions.
 *
 * Debounced (350ms) search against openstreetmap.org as the owner types;
 * picking a suggestion stores the canonical display_name, which is exactly
 * what the Where card geocodes for its map preview — so a picked address
 * always resolves to a map. Escape closes, selection suppresses re-query.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";

interface Suggestion {
  place_id: number;
  display_name: string;
}

export function LocationAutocomplete({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // True right after a pick — don't re-query for the chosen value.
  const [justSelected, setJustSelected] = useState(false);
  const [debounced, setDebounced] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // Debounce the typed value (also respects Nominatim's 1 req/s policy).
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), 350);
    return () => clearTimeout(timer);
  }, [value]);

  // Close on outside tap.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const { data: results } = useQuery<Suggestion[]>({
    queryKey: ["address-autocomplete", debounced],
    enabled: open && !justSelected && debounced.length >= 3,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(debounced)}`,
        { signal, headers: { Accept: "application/json" } }
      );
      if (!res.ok) throw new Error(`geocode failed: HTTP ${res.status}`);
      return (await res.json()) as Suggestion[];
    },
  });

  const suggestions = open && !justSelected ? results ?? [] : [];

  return (
    <div ref={rootRef} className="relative">
      <Input
        value={value}
        onChange={(e) => {
          setJustSelected(false);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Start typing an address…"
        className={className}
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-autocomplete="list"
      />

      {suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 inset-x-0 top-full mt-1 rounded-xl border border-orange-200 bg-white shadow-lg overflow-hidden"
        >
          {suggestions.map((s) => (
            <li key={s.place_id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                // onMouseDown beats the input's blur so the pick registers.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(s.display_name);
                  setJustSelected(true);
                  setOpen(false);
                }}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm text-gray-800 hover:bg-orange-50 active:bg-orange-100 transition-colors"
              >
                <MapPin size={15} className="mt-0.5 flex-shrink-0 text-red-500" />
                <span className="line-clamp-2">{s.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
