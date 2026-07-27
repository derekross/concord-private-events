/**
 * useDecryptedImage — resolve an encrypted V2 ImagePointer (community icon /
 * banner) to a displayable object URL. Decrypt-once cache per (url, key,
 * nonce), synchronous seeding from the resolved cache so a remount paints on
 * the first frame, object URLs never revoked (bounded cache).
 *
 * Ported from Armada's useDecryptedImage2 (restructured: pointer changes
 * adjust state during render, the effect only handles the async resolution).
 */

import { useEffect, useState } from "react";

import { decryptImagePointer } from "@/concord-v2/lib/image";
import type { ImagePointer } from "@/concord-v2/lib/types";

const MAX_CACHED = 128;
const cache = new Map<string, Promise<string>>();
const resolved = new Map<string, string>();

function cacheKey(image: ImagePointer): string {
  return `${image.url}\n${image.key}\n${image.nonce}`;
}

/** Returns the decrypted object URL, or null while loading / on failure. */
export function useDecryptedImage(image: ImagePointer | undefined): string | null {
  const url = image?.url;
  const key = image?.key;
  const nonce = image?.nonce;
  const ck = image ? cacheKey(image) : null;

  const [src, setSrc] = useState<string | null>(() => (ck ? resolved.get(ck) ?? null : null));

  // Pointer changed (or removed) → reseed synchronously from the resolved
  // cache during render (React-sanctioned state adjustment), so the effect
  // never needs a synchronous setState.
  const [prevCk, setPrevCk] = useState(ck);
  if (prevCk !== ck) {
    setPrevCk(ck);
    setSrc(ck ? resolved.get(ck) ?? null : null);
  }

  useEffect(() => {
    if (!image || !url || !key || !nonce || !ck) return;
    if (resolved.has(ck)) return; // already seeded during render

    let cancelled = false;
    let promise = cache.get(ck);
    if (!promise) {
      promise = decryptImagePointer(image);
      cache.set(ck, promise);
      promise
        .then((u) => {
          resolved.set(ck, u);
          if (resolved.size > MAX_CACHED) {
            const oldest = resolved.keys().next().value;
            if (oldest !== undefined && oldest !== ck) resolved.delete(oldest);
          }
        })
        .catch(() => {
          if (cache.get(ck) === promise) cache.delete(ck);
        });
      if (cache.size > MAX_CACHED) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined && oldest !== ck) cache.delete(oldest);
      }
    }
    promise
      .then((u) => {
        if (!cancelled) setSrc(u);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key, nonce, ck]);

  return src;
}
