import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { markTourSeen } from "../utils/tour";
import { TourContext } from "./useTour";


export function TourProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const start = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    markTourSeen();
    setOpen(false);
  }, []);
  return <TourContext.Provider value={{ open, start, close }}>{children}</TourContext.Provider>;
}
