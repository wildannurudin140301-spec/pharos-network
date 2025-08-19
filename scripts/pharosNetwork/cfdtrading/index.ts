import * as dotenv from "dotenv";
import path from "path";
import getProof from "./proof";
import { Contract, formatUnits, JsonRpcProvider, Wallet } from "ethers";
import { CFDTradeAbi, pairs, router, spender, mockUSD, faucet } from "./data";
import { randomAmount } from "@scripts/utils/amount";
import { tokenBalance } from "@scripts/utils/balance";
import { approve } from "@scripts/utils/approve";
import { success } from "@scripts/utils/console";
import { waitForReceipt } from "@scripts/utils/tx";

type Health = {
  fail: number;
  cooldownUntilMs: number;     // time-based
  cooldownUntilRound: number;  // round-based
};

const pairHealth = new Map<number, Health>();
const now = () => Date.now();

// Bisa diatur dari .env, ada default aman
const COOLDOWN_BASE_MS = Number(process.env.PAIR_COOLDOWN_BASE_MS ?? 60_000);   // 1m
const COOLDOWN_MAX_MS  = Number(process.env.PAIR_COOLDOWN_MAX_MS  ?? 900_000);  // 15m
const COOLDOWN_BASE_ROUNDS = Number(process.env.PAIR_COOLDOWN_BASE_ROUNDS ?? 2);
const COOLDOWN_MAX_ROUNDS  = Number(process.env.PAIR_COOLDOWN_MAX_ROUNDS  ?? 12);

// fallback kalau runner lupa kirim currentRound
let internalRoundCounter = 0;

function markFail(id: number, currentRound: number) {
  const h = pairHealth.get(id) || { fail: 0, cooldownUntilMs: 0, cooldownUntilRound: 0 };
  h.fail = Math.min(20, h.fail + 1);

  const ms = Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * Math.pow(2, Math.max(0, h.fail - 1)));
  const rounds = Math.min(COOLDOWN_MAX_ROUNDS, COOLDOWN_BASE_ROUNDS * Math.pow(2, Math.max(0, h.fail - 1)));

  h.cooldownUntilMs = now() + ms;
  h.cooldownUntilRound = currentRound + rounds;

  pairHealth.set(id, h);

  const remainMin = Math.ceil((h.cooldownUntilMs - now()) / 60000);
  const remainRounds = Math.max(0, h.cooldownUntilRound - currentRound);
  console.log(`[cooldown] pair=${id} fail=${h.fail} until≈${remainMin}m / ${remainRounds} rounds`);
}

function markOk(id: number) {
  const h = pairHealth.get(id) || { fail: 0, cooldownUntilMs: 0, cooldownUntilRound: 0 };
  h.fail = Math.max(0, h.fail - 1);
  h.cooldownUntilMs = 0;
  h.cooldownUntilRound = 0;
  pairHealth.set(id, h);
}

function pickHealthyPair(currentRound: number) {
  const usable = pairs.filter(p => {
    const id = Number(p.pair);
    const h = pairHealth.get(id);
    if (!h) return true;
    // hanya boleh dipilih ketika dua syarat terpenuhi:
    // 1) waktu cooldown habis, dan 2) jumlah cycle cooldown terlewati
    return h.cooldownUntilMs <= now() && currentRound >= h.cooldownUntilRound;
  });
  const list = usable.length ? usable : pairs; // kalau semua cooldown, fallback ke semua
  return list[Math.floor(Math.random() * list.length)];
}

interface OpenPositionParams {
  baseDir: string;
  signer: Wallet;
  provider: JsonRpcProvider;
  currentRound?: number; // dikirim dari runner; kalau kosong pakai internal counter
}

export async function OpenPosition({ baseDir, signer, provider, currentRound }: OpenPositionParams) {
  dotenv.config({ path: path.join(baseDir, ".env") });

  // pastikan ada round number
  const round = currentRound ?? ++internalRoundCounter;

  // pilih pair yang sehat (tidak sedang cooldown)
  const selectedPair = pickHealthyPair(round);
  const isLong = Math.random() < 0.5;
  const pair = BigInt(selectedPair.pair);
  const { PROXY_URL = "" } = process.env!;

  // saldo & faucet
  const { balance: usdcBal, decimals: usdcDecimals } = await tokenBalance({
    address: signer.address,
    provider,
    tokenAddress: mockUSD
  });

  const amount = BigInt(
    Math.floor(
      randomAmount({
        min: 10_000_000,
        max: 50_000_000
      })
    )
  );

  if (usdcBal < amount) {
    console.log("Insufficient USDC balance!");
    console.log("Claiming faucet...");
    const faucetContract = new Contract(faucet, CFDTradeAbi, signer);
    const faucetTx: any = await faucetContract.claim();
    if (!faucetTx || typeof faucetTx.wait !== "function") throw new Error("Faucet tx invalid (no .wait())");
    const faucetRcpt = await waitForReceipt(provider, faucetTx.hash);
    if (!faucetRcpt || faucetRcpt.status !== 1) throw new Error("Faucet claim failed");
    success({ hash: faucetTx.hash });
  }

  // approve
  await approve({
    tokenAddress: mockUSD,
    signer,
    router: spender,
    amount,
    provider,
  });

  // proof
  console.log(`Pair selected: ${selectedPair.name} (id=${selectedPair.pair})`);
  let proof: any;
  try {
    proof = await getProof({ pair: selectedPair.pair, PROXY_URL });
  } catch (e: any) {
    markFail(Number(selectedPair.pair), round);
    console.log(`Skip pair ${selectedPair.name}: ${e?.message || String(e)}`);
    return;
  }

  const contractRouter = new Contract(router, CFDTradeAbi, signer);

  // PRE-FLIGHT: staticCall → kalau revert, skip (hindari "missing revert data" saat estimateGas)
  try {
    await (contractRouter as any).openPosition.staticCall(
      pair,
      proof,
      isLong,
      1n,
      amount,
      0n,
      0n
    );
  } catch (e: any) {
    markFail(Number(selectedPair.pair), round);
    console.log(
      `Preflight failed for ${selectedPair.name} (id=${selectedPair.pair}). Skip. Reason: ${
        e?.shortMessage || e?.message || e
      }`
    );
    return;
  }

  // Estimate gas (opsional tapi bagus). Kalau gagal, skip.
  let gasLimit: bigint | undefined;
  try {
    const gasEst: bigint = await (contractRouter as any).openPosition.estimateGas(
      pair,
      proof,
      isLong,
      1n,
      amount,
      0n,
      0n
    );
    gasLimit = (gasEst * 12n) / 10n; // +20% buffer
  } catch (e: any) {
    markFail(Number(selectedPair.pair), round);
    console.log(
      `estimateGas failed for ${selectedPair.name} (id=${selectedPair.pair}). Skip. Reason: ${
        e?.shortMessage || e?.message || e
      }`
    );
    return;
  }

  // Kirim TX
  console.log(
    `Opening Position ${formatUnits(amount, usdcDecimals)} ${isLong ? "long" : "short"} ${selectedPair.name}...`
  );

  const tx: any = await (contractRouter as any).openPosition(
    pair,
    proof,
    isLong,
    1n,
    amount,
    0n,
    0n,
    { gasLimit }
  );

  if (!tx || typeof tx.wait !== "function") {
    markFail(Number(selectedPair.pair), round);
    throw new Error(
      `openPosition did not return a TransactionResponse. Got: ${typeof tx} | keys: ${Object.keys(tx || {})}`
    );
  }

  const rcpt = await waitForReceipt(provider, tx.hash);
  if (!rcpt || rcpt.status !== 1) {
    markFail(Number(selectedPair.pair), round);
    throw new Error("openPosition failed (no/failed receipt)");
  }

  markOk(Number(selectedPair.pair));
  success({ hash: tx.hash });
}
