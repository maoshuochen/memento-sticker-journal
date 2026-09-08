import { useEffect, useRef, useState } from "react"

import type { LocalRepository } from "@/data/repository"
import type { AppSnapshot, AssetRecord } from "@/domain/model"

const MAX_REMOTE_ASSET_ATTEMPTS = 3
const REMOTE_ASSET_RETRY_DELAYS_MS = [250, 750] as const
const MAX_ASSET_BYTES = 6 * 1024 * 1024

interface CachedAssetUrl {
  fingerprint: string
  url?: string
  revokeOnDispose: boolean
  fetching: boolean
  attemptedRetryKey: number | undefined
}

function assetFingerprint(asset: AssetRecord): string {
  if (asset.blob) return `blob:${asset.revision}:${asset.updatedAt}:${asset.blob.type}:${asset.blob.size}`
  if (asset.url) return `url:${asset.url}`
  return `remote:${asset.remoteKey ?? ""}:${asset.revision}:${asset.updatedAt}`
}

function sameUrls(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
  return left.size === right.size && [...left].every(([id, url]) => right.get(id) === url)
}

function revokeCachedUrl(cached: CachedAssetUrl): void {
  if (cached.url && cached.revokeOnDispose) URL.revokeObjectURL(cached.url)
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => finish(true), delayMs)
    const finish = (result: boolean) => {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      signal.removeEventListener("abort", onAbort)
      resolve(result)
    }
    const onAbort = () => finish(false)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

function isCurrentAsset(
  cache: Map<string, CachedAssetUrl>,
  id: string,
  fingerprint: string,
  epoch: number,
  currentEpoch: { value: number },
): CachedAssetUrl | undefined {
  if (epoch !== currentEpoch.value) return undefined
  const cached = cache.get(id)
  return cached?.fingerprint === fingerprint ? cached : undefined
}

export function useAssetUrls(
  snapshot: AppSnapshot | undefined,
  repository: LocalRepository | null,
  retryKey = 0,
  onAuthExpired?: () => void,
): ReadonlyMap<string, string> {
  const [assetUrls, setAssetUrls] = useState<ReadonlyMap<string, string>>(new Map())
  const cacheRef = useRef(new Map<string, CachedAssetUrl>())
  const epochRef = useRef({ value: 0 })
  const repositoryRef = useRef<LocalRepository | null>(null)

  useEffect(() => () => {
    epochRef.current.value += 1
    for (const cached of cacheRef.current.values()) revokeCachedUrl(cached)
    cacheRef.current.clear()
  }, [])

  useEffect(() => {
    const cache = cacheRef.current
    const epoch = epochRef.current
    epoch.value += 1
    const currentEpoch = epoch.value
    const controllers = new Set<AbortController>()

    const clearCache = () => {
      for (const cached of cache.values()) revokeCachedUrl(cached)
      cache.clear()
      setAssetUrls((current) => current.size ? new Map() : current)
    }

    if (repositoryRef.current !== repository) {
      clearCache()
      repositoryRef.current = repository
    }

    if (!snapshot || !repository) {
      clearCache()
      return () => {
        epoch.value += 1
      }
    }

    const renderAssets = snapshot.assets.filter((asset) => asset.role !== "source")
    const liveIds = new Set(renderAssets.map((asset) => asset.id))
    const next = new Map<string, string>()
    const remoteAssets: Array<{ asset: AssetRecord; fingerprint: string }> = []

    for (const asset of renderAssets) {
      const fingerprint = assetFingerprint(asset)
      const existing = cache.get(asset.id)
      if (existing?.fingerprint === fingerprint) {
        if (existing.url) next.set(asset.id, existing.url)
        else if (asset.remoteKey && !existing.fetching && existing.attemptedRetryKey !== retryKey) {
          existing.fetching = true
          existing.attemptedRetryKey = undefined
          remoteAssets.push({ asset, fingerprint })
        }
        continue
      }

      if (existing) revokeCachedUrl(existing)
      if (asset.blob) {
        const url = URL.createObjectURL(asset.blob)
        cache.set(asset.id, { fingerprint, url, revokeOnDispose: true, fetching: false, attemptedRetryKey: retryKey })
        next.set(asset.id, url)
      } else if (asset.url) {
        cache.set(asset.id, { fingerprint, url: asset.url, revokeOnDispose: false, fetching: false, attemptedRetryKey: retryKey })
        next.set(asset.id, asset.url)
      } else if (asset.remoteKey) {
        cache.set(asset.id, { fingerprint, revokeOnDispose: false, fetching: true, attemptedRetryKey: undefined })
        remoteAssets.push({ asset, fingerprint })
      }
    }

    for (const [id, cached] of cache) {
      if (liveIds.has(id)) continue
      revokeCachedUrl(cached)
      cache.delete(id)
    }
    setAssetUrls((current) => sameUrls(current, next) ? current : new Map(next))

    for (const { asset, fingerprint } of remoteAssets) {
      const controller = new AbortController()
      controllers.add(controller)
      const download = async (): Promise<void> => {
        try {
          for (let attempt = 0; attempt < MAX_REMOTE_ASSET_ATTEMPTS; attempt += 1) {
            if (controller.signal.aborted || !isCurrentAsset(cache, asset.id, fingerprint, currentEpoch, epoch)) return
            let response: Response
            try {
              response = await fetch(`/api/assets/${encodeURIComponent(asset.id)}`, {
                credentials: "same-origin",
                cache: "no-store",
                signal: controller.signal,
              })
            } catch {
              if (controller.signal.aborted) return
              if (attempt >= MAX_REMOTE_ASSET_ATTEMPTS - 1) return
              const resumed = await waitForRetry(REMOTE_ASSET_RETRY_DELAYS_MS[attempt] ?? 750, controller.signal)
              if (!resumed) return
              continue
            }

            if (response.ok) {
              const blob = await response.blob()
              if (controller.signal.aborted) return
              if (!blob.size || blob.size > MAX_ASSET_BYTES || blob.type.toLowerCase() !== asset.mimeType.toLowerCase()) return
              const cached = isCurrentAsset(cache, asset.id, fingerprint, currentEpoch, epoch)
              if (!cached) return
              if (!await repository.cacheAssetBlob(asset, blob)) return
              const url = URL.createObjectURL(blob)
              const current = isCurrentAsset(cache, asset.id, fingerprint, currentEpoch, epoch)
              if (!current) {
                URL.revokeObjectURL(url)
                return
              }
              current.url = url
              current.revokeOnDispose = true
              setAssetUrls((currentUrls) => {
                const updated = new Map(currentUrls)
                updated.set(asset.id, url)
                return updated
              })
              return
            }

            if (response.status === 401 && isCurrentAsset(cache, asset.id, fingerprint, currentEpoch, epoch)) onAuthExpired?.()
            if (response.status < 500 || attempt >= MAX_REMOTE_ASSET_ATTEMPTS - 1) return
            const resumed = await waitForRetry(REMOTE_ASSET_RETRY_DELAYS_MS[attempt] ?? 750, controller.signal)
            if (!resumed) return
          }
        } finally {
          controllers.delete(controller)
          const cached = isCurrentAsset(cache, asset.id, fingerprint, currentEpoch, epoch)
          if (cached) {
            cached.fetching = false
            cached.attemptedRetryKey = retryKey
          }
        }
      }
      void download().catch(() => undefined)
    }

    return () => {
      epoch.value += 1
      for (const controller of controllers) controller.abort()
      controllers.clear()
      for (const cached of cache.values()) {
        cached.fetching = false
      }
    }
  }, [onAuthExpired, repository, retryKey, snapshot])

  return assetUrls
}
