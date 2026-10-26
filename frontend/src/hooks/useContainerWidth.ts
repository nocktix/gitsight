import { useEffect, useRef, useState } from "react";

/** Ancho (px) del elemento al que se asigna `ref`, actualizado al redimensionar. */
export function useContainerWidth(defaultWidth: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(defaultWidth);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured) setWidth(measured);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
