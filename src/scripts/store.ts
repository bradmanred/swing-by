// Small wrapper so private browsing or blocked storage never breaks the page.
export const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

export type Mine = Record<string, { v?: boolean; r?: number; t?: string }>;
export const getMine = () => store.get<Mine>('sb-mine', {});
