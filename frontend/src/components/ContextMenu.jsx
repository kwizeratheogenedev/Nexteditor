import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// A right-click menu in the style of desktop editors (Premiere Pro, DaVinci
// Resolve, CapCut): grouped rows with shortcut hints, check marks for
// toggles, flyout submenus, and colour swatches. It only renders the spec
// it's given - what each row does lives with the caller.
//
// Item shapes:
//   { label, hint?, onClick, checked?, disabled?, danger? }
//   { label, submenu: [items] }
//   { label, swatches: [{ value, color, title }], value, onPick }
//   { label, input: { value, placeholder, onSubmit } }   - inline rename
//   'divider'
// Falsy items are skipped, so callers can write `cond && { ... }`.

const MARGIN = 8;

function placeWithin(el, x, y) {
  const rect = el.getBoundingClientRect();
  const left = Math.max(MARGIN, Math.min(x, window.innerWidth - rect.width - MARGIN));
  const top = Math.max(MARGIN, Math.min(y, window.innerHeight - rect.height - MARGIN));
  return { left, top };
}

function MenuList({ items, onClose, title, isSub = false, parentRect = null, x = 0, y = 0 }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  const [openSub, setOpenSub] = useState(null);
  const rows = items.filter(Boolean);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (isSub && parentRect) {
      const rect = el.getBoundingClientRect();
      // Opens to the right of its row, or to the left when there's no room.
      const fitsRight = parentRect.right + rect.width + MARGIN <= window.innerWidth;
      const left = fitsRight ? parentRect.right - 2 : parentRect.left - rect.width + 2;
      const top = Math.max(MARGIN, Math.min(parentRect.top - 5, window.innerHeight - rect.height - MARGIN));
      setPos({ left, top, ready: true });
    } else {
      setPos({ ...placeWithin(el, x, y), ready: true });
    }
  }, [isSub, parentRect, x, y]);

  useEffect(() => {
    if (!isSub && pos.ready) ref.current?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [isSub, pos.ready]);

  const onKeyDown = (event) => {
    const buttons = [...ref.current.querySelectorAll(':scope > .st-cm-row > button:not(:disabled), :scope > .st-cm-row > .st-cm-trigger:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(index + step + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'ArrowRight' && document.activeElement?.dataset.sub) {
      event.preventDefault();
      event.stopPropagation();
      document.activeElement.click();
    } else if (event.key === 'ArrowLeft' && isSub) {
      event.preventDefault();
      event.stopPropagation();
      onClose(false);
    }
  };

  return (
    <div
      ref={ref}
      className={`st-cm ${isSub ? 'is-sub' : ''}`}
      role="menu"
      style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {title && <div className="st-cm-title">{title}</div>}
      {rows.map((item, index) => {
        if (item === 'divider') return <div key={`d${index}`} className="st-cm-divider" role="separator" />;
        const key = `${item.label}-${index}`;
        if (item.submenu) {
          const open = openSub?.key === key;
          return (
            <div key={key} className="st-cm-row" onMouseEnter={(event) => !item.disabled && setOpenSub({ key, rect: event.currentTarget.getBoundingClientRect() })}>
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={open}
                data-sub="1"
                className={`st-cm-item st-cm-trigger ${open ? 'is-open' : ''}`}
                disabled={item.disabled}
                onClick={(event) => setOpenSub(open ? null : { key, rect: event.currentTarget.parentElement.getBoundingClientRect() })}
              >
                <span className="st-cm-check" />
                <span className="st-cm-label">{item.label}</span>
                <span className="st-cm-arrow" aria-hidden="true">›</span>
              </button>
              {/* Portalled to <body>: inside the parent, its blur and scroll
                  area would clip a fixed-position submenu. */}
              {open && createPortal(
                <MenuList
                  items={item.submenu}
                  isSub
                  parentRect={openSub.rect}
                  onClose={(all) => { if (all === false) setOpenSub(null); else onClose(); }}
                />,
                document.body,
              )}
            </div>
          );
        }
        if (item.swatches) {
          return (
            <div key={key} className="st-cm-row st-cm-swatch-row" onMouseEnter={() => setOpenSub(null)}>
              <span className="st-cm-caption">{item.label}</span>
              <div className="st-cm-swatches">
                {item.swatches.map((swatch) => (
                  <button
                    key={swatch.title}
                    type="button"
                    title={swatch.title}
                    aria-label={swatch.title}
                    className={`st-cm-swatch ${item.value === swatch.value ? 'is-on' : ''} ${swatch.value ? '' : 'is-none'}`}
                    style={swatch.color ? { background: swatch.color } : undefined}
                    onClick={() => { item.onPick(swatch.value); onClose(); }}
                  />
                ))}
              </div>
            </div>
          );
        }
        if (item.input) {
          return (
            <form
              key={key}
              className="st-cm-row st-cm-input-row"
              onMouseEnter={() => setOpenSub(null)}
              onSubmit={(event) => {
                event.preventDefault();
                item.input.onSubmit(new FormData(event.currentTarget).get('value'));
                onClose();
              }}
            >
              <span className="st-cm-caption">{item.label}</span>
              <input
                name="value"
                defaultValue={item.input.value}
                placeholder={item.input.placeholder}
                aria-label={item.label}
                onKeyDown={(event) => { if (event.key !== 'Escape') event.stopPropagation(); }}
              />
            </form>
          );
        }
        return (
          <div key={key} className="st-cm-row" onMouseEnter={() => setOpenSub(null)}>
            <button
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={item.checked === undefined ? undefined : Boolean(item.checked)}
              className={`st-cm-item ${item.danger ? 'is-danger' : ''}`}
              disabled={item.disabled}
              title={item.title}
              onClick={() => { item.onClick?.(); onClose(); }}
            >
              <span className="st-cm-check" aria-hidden="true">{item.checked ? '✓' : ''}</span>
              <span className="st-cm-label">{item.label}</span>
              {item.hint && <kbd className="st-cm-hint">{item.hint}</kbd>}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ContextMenu({ x, y, title, items, onClose }) {
  const rootRef = useRef(null);

  useEffect(() => {
    // Submenus live in a portal, so "inside" means inside any menu panel.
    const inside = (target) => target instanceof Node && (rootRef.current?.contains(target) || Boolean(target.closest?.('.st-cm')));
    const onPointerDown = (event) => { if (!inside(event.target)) onClose(); };
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    const onScroll = (event) => { if (!inside(event.target)) onClose(); };
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div ref={rootRef} className="st-cm-root">
      <MenuList items={items} title={title} x={x} y={y} onClose={onClose} />
    </div>
  );
}

export default ContextMenu;
