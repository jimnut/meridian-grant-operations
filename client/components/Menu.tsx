import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

/**
 * Accessible dropdown menu: arrow-key roving focus, Escape to close, focus
 * returns to the trigger, closes on outside click.
 */
export function Menu({
  trigger,
  items,
  align = 'end',
  label,
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu'; id: string }) => ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerId = useId();

  const enabled = items.filter((item) => !item.disabled);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      const raf = requestAnimationFrame(() => itemRefs.current[activeIndex]?.focus());
      return () => cancelAnimationFrame(raf);
    }
    return undefined;
  }, [open, activeIndex]);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) {
      document.getElementById(triggerId)?.focus();
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % Math.max(1, items.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % Math.max(1, items.length));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(items.length - 1);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {trigger({
        id: triggerId,
        onClick: () => {
          setActiveIndex(0);
          setOpen((value) => !value);
        },
        'aria-expanded': open,
        'aria-haspopup': 'menu',
      })}

      {open && enabled.length > 0 && (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            [align === 'end' ? 'right' : 'left']: 0,
            zIndex: 50,
            minWidth: 200,
            padding: 'var(--space-1)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              tabIndex={index === activeIndex ? 0 : -1}
              disabled={item.disabled}
              className="palette__item"
              style={item.tone === 'danger' ? { color: 'var(--risk-ink)' } : undefined}
              onFocus={() => setActiveIndex(index)}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
