import { useState, useRef, useEffect, useMemo } from "react";

function fuzzyMatch(query: string, target: string): boolean {
  const lowerTarget = target.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let ti = 0;
  for (let qi = 0; qi < lowerQuery.length; qi++) {
    const idx = lowerTarget.indexOf(lowerQuery[qi], ti);
    if (idx === -1) return false;
    ti = idx + 1;
  }
  return true;
}

interface SearchableComboboxProps<T> {
  items: T[];
  selected: T | null;
  onSelect: (item: T | null) => void;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  placeholder?: string;
  noMatchMessage?: string;
}

function SearchableCombobox<T>({
  items,
  selected,
  onSelect,
  getKey,
  getLabel,
  placeholder = "Search...",
  noMatchMessage = "No matches found",
}: SearchableComboboxProps<T>) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    if (query === "") return items;
    return items.filter(item => fuzzyMatch(query, getLabel(item)));
  }, [query, items, getLabel]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [filtered]);

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const item = listRef.current.children[highlightIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, isOpen]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectItem = (item: T) => {
    onSelect(item);
    setQuery(getLabel(item));
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightIndex(i => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIndex(i => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[highlightIndex]) selectItem(filtered[highlightIndex]);
        break;
      case "Escape":
        setIsOpen(false);
        break;
    }
  };

  const selectedLabel = selected ? getLabel(selected) : "";

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
          if (selected && e.target.value !== selectedLabel) {
            onSelect(null);
          }
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full bg-white px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {selected && (
        <button
          type="button"
          onClick={() => { setQuery(""); onSelect(null); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          aria-label="Clear selection"
        >
          ✕
        </button>
      )}
      {isOpen && filtered.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-10 w-full mt-1 max-h-60 overflow-auto bg-white border border-gray-300 rounded-lg shadow-lg"
        >
          {filtered.map((item, idx) => (
            <li
              key={getKey(item)}
              onClick={() => selectItem(item)}
              onMouseEnter={() => setHighlightIndex(idx)}
              className={`px-4 py-2 cursor-pointer ${
                idx === highlightIndex ? "bg-blue-100" : "hover:bg-gray-100"
              } ${selected && getKey(selected) === getKey(item) ? "font-semibold" : ""}`}
            >
              {getLabel(item)}
            </li>
          ))}
        </ul>
      )}
      {isOpen && query !== "" && filtered.length === 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg px-4 py-2 text-gray-500">
          {noMatchMessage}
        </div>
      )}
    </div>
  );
}

export default SearchableCombobox;
