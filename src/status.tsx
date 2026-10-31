import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { StatusResponse } from "../shared/types";
import { getStatus, postIngest } from "./api";

type StatusContextValue = {
  status: StatusResponse | null;
  error: string | null;
  generation: number;
  refresh: () => Promise<void>;
};

const StatusContext = createContext<StatusContextValue | null>(null);

export function StatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [watch, setWatch] = useState(0);
  const refreshingRef = useRef(false);

  useEffect(() => {
    let cancel = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      try {
        const next = await getStatus();
        if (cancel) return;
        if (refreshingRef.current && !next.refreshing) setGeneration((value) => value + 1);
        refreshingRef.current = next.refreshing;
        setStatus(next);
        setError(null);
        if (next.refreshing) timer = setTimeout(loop, 1200);
      } catch (err) {
        if (cancel) return;
        setError(err instanceof Error ? err.message : "API nedostupné");
        timer = setTimeout(loop, 2500);
      }
    };
    void loop();
    return () => {
      cancel = true;
      if (timer) clearTimeout(timer);
    };
  }, [watch]);

  async function refresh() {
    const pending = postIngest();
    setWatch((value) => value + 1);
    await pending;
    setGeneration((value) => value + 1);
    setWatch((value) => value + 1);
  }

  return (
    <StatusContext.Provider value={{ status, error, generation, refresh }}>{children}</StatusContext.Provider>
  );
}

export function useAppStatus(): StatusContextValue {
  const value = useContext(StatusContext);
  if (!value) throw new Error("StatusProvider chybí");
  return value;
}
