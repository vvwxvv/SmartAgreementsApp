"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * AwSelect — a plain white dropdown.
 *
 * The native <select> popup is painted by the OS, so it comes up as a grey
 * system menu that ignores the page's styling. This replaces it with a small
 * white panel that matches the form fields (underline trigger, white list).
 *
 * Props:
 *   value        current value (string)
 *   onChange     (nextValue) => void
 *   options      [{ value, label }]
 *   placeholder  shown when value is empty (default "—")
 *   className    extra classes on the wrapper
 *   ariaLabel / id
 */
export default function AwSelect({
  value,
  onChange,
  options,
  placeholder = "—",
  className = "",
  ariaLabel,
  id,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const reactId = useId();
  const menuId = (id || reactId) + "-menu";

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Open with the current value highlighted. Focus deliberately stays on the
  // trigger: moving it into the list fights the modal's focus trap (the trap
  // pulls focus back out and the menu closes instantly).
  useEffect(() => {
    if (!open) {
      setActive(-1);
      return undefined;
    }
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    return undefined;
  }, [open, selectedIndex]);

  const commit = (i) => {
    const opt = options[i];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
  };

  // Focus never leaves the trigger, so it owns the whole keyboard model:
  // Enter/Space open the list, and while open they commit the highlighted item.
  // preventDefault stops the button's native click from toggling it back shut.
  const onTriggerKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open && active >= 0) commit(active);
      else setOpen(true);
      return;
    }
    onKeyDown(e);
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open && active >= 0) commit(active);
      else setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(options.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    }
  };

  return (
    <div className={"aw-select " + className} ref={rootRef}>
      <button
        type="button"
        id={id}
        className="ag-input aw-select-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={"aw-select-value" + (selected ? "" : " is-empty")}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="aw-select-caret" aria-hidden="true">▾</span>
      </button>

      {open ? (
        <ul
          id={menuId}
          role="listbox"
          className="aw-select-menu"
          ref={menuRef}
          tabIndex={-1}
          aria-activedescendant={active >= 0 ? menuId + "-" + active : undefined}
          onKeyDown={onKeyDown}
          onBlur={(e) => {
            if (!rootRef.current?.contains(e.relatedTarget)) setOpen(false);
          }}
        >
          {options.map((o, i) => (
            <li
              key={o.value || i}
              id={menuId + "-" + i}
              role="option"
              aria-selected={o.value === value}
              className={
                "aw-select-item" +
                (i === active ? " is-active" : "") +
                (o.value === value ? " is-selected" : "")
              }
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(i);
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
