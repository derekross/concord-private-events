/**
 * Lightning payment helpers — LUD-16 (LNURL-pay) client-side resolution.
 *
 * Tapping a lightning address with an amount set resolves the full pay flow
 * in the background: address → /.well-known/lnurlp → callback → BOLT-11
 * invoice, then hands the wallet a `lightning:<bolt11>` URI with the exact
 * sats already filled in. Callers fall back to the bare `lightning:address`
 * on any failure.
 */

import { useQuery } from "@tanstack/react-query";

/** Parse `user@domain` lightning addresses. */
export function parseLightningAddress(id: string): { user: string; domain: string } | null {
  const m = id.trim().match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
  return m ? { user: m[1], domain: m[2] } : null;
}

export interface LnurlpParams {
  callback: string;
  minSendable: number;
  maxSendable: number;
}

/** Step 1 of LNURL-pay: resolve the address to its pay params. */
export async function fetchLnurlpParams(address: string, signal?: AbortSignal): Promise<LnurlpParams> {
  const parsed = parseLightningAddress(address);
  if (!parsed) throw new Error("not a lightning address");

  const res = await fetch(
    `https://${parsed.domain}/.well-known/lnurlp/${encodeURIComponent(parsed.user)}`,
    { signal, headers: { Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`lnurlp fetch failed: HTTP ${res.status}`);
  const json = await res.json();
  if (json.status === "ERROR") throw new Error(json.reason ?? "lnurlp error");
  if (typeof json.callback !== "string" || typeof json.minSendable !== "number" || typeof json.maxSendable !== "number") {
    throw new Error("malformed lnurlp response");
  }
  return { callback: json.callback, minSendable: json.minSendable, maxSendable: json.maxSendable };
}

/** Step 2 of LNURL-pay: request the BOLT-11 invoice for an amount (msats). */
export async function fetchInvoice(callback: string, msats: number, signal?: AbortSignal): Promise<string> {
  const url = new URL(callback);
  url.searchParams.set("amount", String(msats));
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`invoice fetch failed: HTTP ${res.status}`);
  const json = await res.json();
  if (json.status === "ERROR") throw new Error(json.reason ?? "invoice error");
  if (typeof json.pr !== "string" || !json.pr) throw new Error("malformed invoice response");
  return json.pr;
}

/**
 * Full flow: address + sats → `lightning:<bolt11>` URI with the amount
 * baked in. Throws when the amount is outside the receiver's bounds or any
 * step fails — the caller falls back to the bare address URI.
 */
export async function resolveLightningInvoiceUri(address: string, sats: number, signal?: AbortSignal): Promise<string> {
  const msats = Math.round(sats * 1000);
  const params = await fetchLnurlpParams(address, signal);
  if (msats < params.minSendable || msats > params.maxSendable) {
    throw new Error(`amount out of range (${params.minSendable}–${params.maxSendable} msats)`);
  }
  const pr = await fetchInvoice(params.callback, msats, signal);
  return `lightning:${pr}`;
}

/** Shared Coinbase BTC-USD spot rate, refreshed every minute. */
export function useBtcUsdRate() {
  return useQuery<number>({
    queryKey: ["btc-usd-spot"],
    queryFn: async ({ signal }) => {
      const res = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot", { signal });
      if (!res.ok) throw new Error(`rate fetch failed: HTTP ${res.status}`);
      const json = await res.json();
      return Number(json.data.amount);
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}
