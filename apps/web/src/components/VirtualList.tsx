import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props<T> {
  items: T[];
  rowHeight: number;
  overscan?: number;
  renderRow: (item: T, index: number) => ReactNode;
  className?: string;
}

/**
 * Lightweight windowed list: renders only the rows visible in the nearest
 * scrollable ancestor (the main content pane), plus overscan.
 */
export function VirtualList<T>({ items, rowHeight, overscan = 8, renderRow, className }: Props<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 40 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const scrollParent = (function find(node: HTMLElement | null): HTMLElement | Window {
      while (node) {
        const { overflowY } = getComputedStyle(node);
        if (overflowY === 'auto' || overflowY === 'scroll') return node;
        node = node.parentElement;
      }
      return window;
    })(el.parentElement);

    const update = () => {
      const viewportH = scrollParent instanceof Window ? window.innerHeight : scrollParent.clientHeight;
      const top = el.getBoundingClientRect().top;
      const parentTop = scrollParent instanceof Window ? 0 : scrollParent.getBoundingClientRect().top;
      const offset = parentTop - top; // how far we've scrolled into the list
      const start = Math.max(0, Math.floor(offset / rowHeight) - overscan);
      const end = Math.min(items.length, Math.ceil((offset + viewportH) / rowHeight) + overscan);
      setRange((r) => (r.start === start && r.end === end ? r : { start, end }));
    };
    update();
    const target = scrollParent instanceof Window ? window : scrollParent;
    target.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      target.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [items.length, rowHeight, overscan]);

  return (
    <div ref={containerRef} className={className} style={{ height: items.length * rowHeight, position: 'relative' }}>
      {items.slice(range.start, range.end).map((item, i) => {
        const index = range.start + i;
        return (
          <div key={index} style={{ position: 'absolute', top: index * rowHeight, left: 0, right: 0, height: rowHeight }}>
            {renderRow(item, index)}
          </div>
        );
      })}
    </div>
  );
}
