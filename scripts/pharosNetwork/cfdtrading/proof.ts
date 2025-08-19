import { fetchWithProxyUndici } from "@scripts/utils/ip";
import { headers as baseHeaders } from "./data";
import { sleepBackoff } from "@scripts/utils/time";

interface ProofParams { pair: string; PROXY_URL?: string; }

function getHeader(h: any, name: string): string | null {
  if (!h) return null;
  if (typeof h.get === "function") return h.get(name); // native fetch Headers
  const key = Object.keys(h).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? (h as any)[key] : null;
}
const looksLikeJson = (s: string) => /^\s*[\{\[]/.test(s);

const UAS = [
  "pharos-network/1.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
];

export default async function getProof({ pair, PROXY_URL = "" }: ProofParams) {
  const url = `https://proof.brokex.trade/proof?pairs=${encodeURIComponent(pair)}`;

  // ↑ attempts dinaikkan (bisa override via .env PROOF_MAX_ATTEMPTS)
  const maxAttempts = Number(process.env.PROOF_MAX_ATTEMPTS || 10);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ua = UAS[Math.floor(Math.random() * UAS.length)];
    console.log(`Fetching proof... (attempt ${attempt + 1})`);

    // timeout via AbortController
    const controller = new AbortController();
    const timeoutMs = 15000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let status = 200;
    let headers: any = undefined;
    let bodyStr = "";

    try {
      if (PROXY_URL && PROXY_URL.trim() !== "") {
        const r: any = await (fetchWithProxyUndici as any)({
          url,
          proxyUrl: PROXY_URL,
          method: "GET",
          headers: {
            ...baseHeaders,
            accept: "application/json",
            "accept-language": "en-US,en;q=0.9",
            "cache-control": "no-cache",
            pragma: "no-cache",
            "user-agent": ua,
          },
          signal: controller.signal,
        });
        status = typeof r?.status === "number" ? r.status : 200; // util bisa tanpa status
        headers = r?.headers;
        bodyStr = typeof r?.body === "string" ? r.body : String(r?.body ?? "");
      } else {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            ...baseHeaders,
            accept: "application/json",
            "accept-language": "en-US,en;q=0.9",
            "cache-control": "no-cache",
            pragma: "no-cache",
            "user-agent": ua,
          } as any,
          signal: controller.signal,
        });
        status = res.status;
        headers = res.headers;
        bodyStr = await res.text();
      }
    } finally {
      clearTimeout(timer);
    }

    const ct = (getHeader(headers, "content-type") || "").toLowerCase();
    const hasStatus = Number.isFinite(status as any);
    const isOk = hasStatus ? (status >= 200 && status < 300) : true;  // kalau tidak ada status → anggap OK
    const treatAsJson = ct.includes("application/json") || (!ct && looksLikeJson(bodyStr));

    // logging diagnostik
    console.warn(`[proof] attempt=${attempt + 1} status=${status} ct=${ct || "N/A"}`);
    if (!ct || !ct.includes("application/json")) {
      console.warn(`[proof] body preview: ${bodyStr.slice(0, 140).replace(/\s+/g, " ")}`);
    }

    // --- Jika respons JSON ---
    if (treatAsJson) {
      try {
        const json = JSON.parse(bodyStr);

        // RETRY kalau 503/error JSON/atau tidak ada field 'proof'
        if (!isOk || json?.error || !json?.proof) {
          // backoff lebih besar: base 1.5s, factor 1.7x, cap 45s
          await sleepBackoff(attempt, 1500, 1.7, 45000);
          continue;
        }

        // sukses
        return json.proof;
      } catch {
        // HTML terselubung / parse gagal → retry
        await sleepBackoff(attempt, 1500, 1.7, 45000);
        continue;
      }
    }

    // --- Jika bukan JSON: cek retriable (CF/502/503/HTML) ---
    if (
      [0, 429, 502, 503, 504].includes(status) ||
      /<html/i.test(bodyStr) ||
      /cloudflare|rate|busy|temporarily|forbidden|blocked/i.test(bodyStr)
    ) {
      await sleepBackoff(attempt, 1500, 1.7, 45000);
      continue;
    }

    // fallback sleep & coba lagi
    await sleepBackoff(attempt, 1500, 1.7, 45000);
  }

  throw new Error("Proof API failed after retries");
}
