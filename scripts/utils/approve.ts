// @scripts/utils/approve.ts
import { Contract, InterfaceAbi, JsonRpcProvider, Wallet } from "ethers";
import ERC20ABI from "@scripts/lib/ERC20.json";
import { waitForReceipt } from "@scripts/utils/tx";

interface ApproveParams {
  tokenAddress: string;
  ERC20ABI?: InterfaceAbi;
  signer: Wallet;
  router: string;              // spender
  amount: bigint;              // gunakan 'bigint' (bukan 'BigInt' type)
  provider?: JsonRpcProvider;  // optional (fallback ke signer.provider)
}

export async function approve({
  tokenAddress,
  ERC20ABI: abiOverride,
  signer,
  router,
  amount,
  provider,
}: ApproveParams) {
  const abi = abiOverride || (ERC20ABI as InterfaceAbi);
  const erc20 = new Contract(tokenAddress, abi, signer);
  const pvdr = provider || (signer.provider as JsonRpcProvider | undefined);
  if (!pvdr) throw new Error("approve(): provider is required");

  console.log("Checking allowance...");
  const allowance: bigint = await erc20.allowance(signer.address, router);
  console.log(allowance.toString());

  if (allowance >= amount) {
    console.log("Sufficient allowance already approved.");
    return;
  }

  if (allowance > 0n) {
    console.log("Resetting allowance to 0 first...");
    const resetTx: any = await erc20.approve(router, 0n);
    if (!resetTx || typeof resetTx.wait !== "function") throw new Error("approve(reset): invalid tx (no .wait())");
    const resetRcpt = await waitForReceipt(pvdr, resetTx.hash);
    if (!resetRcpt || resetRcpt.status !== 1) throw new Error("approve(reset) failed");
    console.log(`Reset tx: ${resetTx.hash}`);
  }

  console.log("Approving new amount to spender...");
  const approveTx: any = await erc20.approve(router, amount);
  if (!approveTx || typeof approveTx.wait !== "function") throw new Error("approve(): invalid tx (no .wait())");
  const approveRcpt = await waitForReceipt(pvdr, approveTx.hash);
  if (!approveRcpt || approveRcpt.status !== 1) throw new Error("approve() failed");
  console.log(`Approve tx: ${approveTx.hash}`);
}
