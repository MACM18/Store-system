"use client";

import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { FiX } from "react-icons/fi";

type DialogProps = {
  title: string;
  description?: string;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Dialog({ title, description, trigger, children, className = "" }: DialogProps) {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  function openFromTrigger(event: React.MouseEvent<HTMLSpanElement>) {
    const button = (event.target as HTMLElement).closest("button");
    if (!button) return;
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "true");
    returnFocusRef.current = button;
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.setAttribute("aria-expanded", "false");
      returnFocusRef.current?.focus();
    };
  }, [open]);

  return <>
    <span className="dialog-trigger-wrap" onClick={openFromTrigger}>{trigger}</span>
    {open && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className={`dialog-panel ${className}`} role="dialog" aria-modal="true" aria-labelledby={`${dialogId}-title`} aria-describedby={description ? `${dialogId}-description` : undefined} ref={panelRef}>
        <header className="dialog-header"><div><h2 id={`${dialogId}-title`}>{title}</h2>{description && <p id={`${dialogId}-description`}>{description}</p>}</div><button type="button" ref={closeRef} className="dialog-close" aria-label="Close dialog" onClick={() => setOpen(false)}><FiX aria-hidden="true" /></button></header>
        <div className="dialog-content">{children}</div>
      </section>
    </div>}
  </>;
}
