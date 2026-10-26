import { createContext, useContext } from "react";

export interface TourValue {
  open: boolean;
  start: () => void;
  /** Cierra el recorrido (al terminarlo o saltarlo) y recuerda que ya se vio. */
  close: () => void;
}

export const TourContext = createContext<TourValue | null>(null);

export function useTour(): TourValue {
  const value = useContext(TourContext);
  if (!value) throw new Error("useTour debe usarse dentro de TourProvider");
  return value;
}
