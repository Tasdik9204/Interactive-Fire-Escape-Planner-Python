import { useEffect, useState } from 'react';
import { loadAsset } from '../app/persist';

const cache = new Map<string, Promise<string | null>>();

/** Object URL for a stored image; shared across components, kept for the session. */
export function useAssetUrl(assetId: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!assetId) {
      setUrl(null);
      return;
    }
    let alive = true;
    let p = cache.get(assetId);
    if (!p) {
      p = loadAsset(assetId)
        .then((a) => (a ? URL.createObjectURL(a.blob) : null))
        .catch(() => null);
      cache.set(assetId, p);
    }
    p.then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [assetId]);
  return url;
}
