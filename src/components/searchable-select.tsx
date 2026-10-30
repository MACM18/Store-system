"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FiChevronDown, FiSearch } from "react-icons/fi";

type Option = { value: string; label: string };

type SearchableSelectProps = {
  name: string;
  options: Option[];
  defaultValue?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  required?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
};

export function SearchableSelect({ name, options, defaultValue = "", placeholder = "Choose an option", searchPlaceholder = "Type to search…", required = false, disabled = false, "aria-label": ariaLabel }: SearchableSelectProps) {
  const listboxId = useId();
  const initialOption = options.find((option) => option.value === defaultValue);
  const [selectedValue, setSelectedValue] = useState(defaultValue);
  const selectedValueRef = useRef(defaultValue);
  const [query, setQuery] = useState(initialOption?.label ?? "");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.normalize("NFC").toLocaleLowerCase();
  const matches = useMemo(() => options.filter((option) => option.label.normalize("NFC").toLocaleLowerCase().includes(normalizedQuery)), [options, normalizedQuery]);

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  useEffect(() => {
    if (!required || !rootRef.current) return;
    const form = rootRef.current.closest("form");
    if (!form) return;
    const validateSelection = (event: Event) => {
      if (selectedValueRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(true);
      inputRef.current?.focus();
    };
    form.addEventListener("submit", validateSelection, true);
    return () => form.removeEventListener("submit", validateSelection, true);
  }, [required]);

  function choose(option: Option) {
    selectedValueRef.current = option.value;
    setSelectedValue(option.value);
    setQuery(option.label);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setQuery(options.find((option) => option.value === selectedValue)?.label ?? "");
    }
    if (event.key === "Enter" && open && matches[0]) {
      event.preventDefault();
      choose(matches[0]);
    }
    if (event.key === "ArrowDown") setOpen(true);
  }

  return <div className={`searchable-select ${open ? "is-open" : ""} ${disabled ? "is-disabled" : ""}`} ref={rootRef}>
    <input type="hidden" name={name} value={selectedValue} />
    <div className="searchable-select-control">
      <FiSearch aria-hidden="true" className="searchable-select-search-icon" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-required={required}
        autoComplete="off"
        disabled={disabled}
        placeholder={selectedValue ? "" : placeholder}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => { selectedValueRef.current = ""; setQuery(event.target.value); setSelectedValue(""); setOpen(true); }}
        onKeyDown={handleKeyDown}
      />
      <FiChevronDown aria-hidden="true" className="searchable-select-chevron" />
    </div>
    {open && !disabled && <div className="searchable-select-menu" id={listboxId} role="listbox">
      {matches.length ? matches.map((option) => <button type="button" role="option" aria-selected={selectedValue === option.value} className={selectedValue === option.value ? "selected" : ""} key={option.value} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>{option.label}</button>) : <div className="searchable-select-empty">No matching items</div>}
    </div>}
    <span className="searchable-select-sr-label">{searchPlaceholder}</span>
  </div>;
}
