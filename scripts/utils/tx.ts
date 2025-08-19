// @scripts/utils/tx.ts
import { JsonRpcProvider } from "ethers";
import { sleepBackoff } from "@scripts/utils/time";

export async function waitForReceipt(
  provider: JsonRpcProvider,
  hash: string,
  tries = 6
) {
  for (let i = 0; i < tries; i++) {
    try {
      const rcpt = await provider.getTransactionReceipt(hash);
      if (rcpt) return rcpt;
    } catch (e: any) {
      if (e?.code === -32004 || /busy|rate|timeout/i.test(String(e))) {
        await sleepBackoff(i);
        continue;
      }
      throw e;
    }
    await sleepBackoff(i);
  }
  return await provider.waitForTransaction(hash, 1, 120_000);
}
