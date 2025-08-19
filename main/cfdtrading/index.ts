import path from "path";
import { OpenPosition } from "@scripts/pharosNetwork/cfdtrading";
import { wallet, provider, envLoaded } from "../setup";
import { failed } from "@scripts/utils/console";
import { sleep } from "@scripts/utils/time";
import { randomAmount } from "@scripts/utils/amount";

const baseDir = path.resolve(__dirname, "..");

async function main() {
  const env = envLoaded();

  for (let index = 1; index <= env.LOOP_COUNT; index++) {
    console.log(`Task cfd trading brokex ${index}/${env.LOOP_COUNT}`);
    try {
      await OpenPosition({
        baseDir,
        signer: wallet.signer,
        provider,
        currentRound: index,     // ⬅️ penting untuk cooldown berbasis cycle
      });
    } catch (error: any) {
      const msg =
        error?.reason ||
        error?.message ||
        (typeof error === "string" ? error : JSON.stringify(error));
      failed({ errorMessage: msg });
    }

    await sleep(
      randomAmount({
        min: env.TIMEOUT_MIN_MS,
        max: env.TIMEOUT_MAX_MS,
      })
    );
  }
}

main().catch((e) => {
  const msg = e?.reason || e?.message || String(e);
  failed({ errorMessage: msg });
});
