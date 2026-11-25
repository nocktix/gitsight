import { useEffect, useRef, useState } from "react";

/**
 * Un bloque fijo (sticky) que no cabe en la ventana deja ver su parte de abajo solo si se suelta:
 * devuelve `fits` = false cuando su alto supera el alto visible, y el bloque deja de ser sticky.
 */
export function useStickyIfFits<T extends HTMLElement>(margin = 32) {
  const ref = useRef<T>(null);
  const [fits, setFits] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setFits(el.offsetHeight <= window.innerHeight - margin);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    window.addEventListener("resize", check);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [margin]);

  return [ref, fits] as const;
}
