import { useLiveQuery } from "dexie-react-hooks";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { localRepository, type LocalRepository } from "@/data/repository";
import type { AppSnapshot } from "@/domain/model";

interface AppDataContextValue {
  snapshot: AppSnapshot;
  repository: LocalRepository;
  assetUrls: ReadonlyMap<string, string>;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

function useAssetUrls(snapshot: AppSnapshot | undefined): ReadonlyMap<string, string> {
  const [assetUrls, setAssetUrls] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    if (!snapshot) return;
    const created: string[] = [];
    const next = new Map<string, string>();
    for (const asset of snapshot.assets) {
      if (asset.blob) {
        const url = URL.createObjectURL(asset.blob);
        created.push(url);
        next.set(asset.id, url);
      } else if (asset.url) {
        next.set(asset.id, asset.url);
      }
    }
    setAssetUrls(next);
    return () => {
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [snapshot]);

  return assetUrls;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void localRepository.initialize()
      .then(() => {
        if (active) setReady(true);
      })
      .catch((error: unknown) => {
        if (active) setInitializationError(error instanceof Error ? error.message : "无法打开本地数据库。");
      });
    return () => {
      active = false;
    };
  }, []);

  const snapshot = useLiveQuery(async () => ready ? await localRepository.snapshot() : undefined, [ready]);
  const assetUrls = useAssetUrls(snapshot);
  const value = useMemo(() => snapshot ? { snapshot, repository: localRepository, assetUrls } : null, [assetUrls, snapshot]);

  if (initializationError) {
    return (
      <main className="data-error" role="alert">
        <p className="wordmark">memento</p>
        <h1>无法打开本地数据</h1>
        <p>{initializationError}</p>
        <button type="button" onClick={() => window.location.reload()}>重新尝试</button>
      </main>
    );
  }

  if (!value) {
    return (
      <main className="grid min-h-svh place-items-center bg-background text-foreground" aria-busy="true">
        <p className="font-serif text-2xl">memento</p>
      </main>
    );
  }

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const value = useContext(AppDataContext);
  if (!value) throw new Error("useAppData must be used inside AppDataProvider.");
  return value;
}
