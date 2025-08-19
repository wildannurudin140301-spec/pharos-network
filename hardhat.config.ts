import "tsconfig-paths/register";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config(); // load .env

const {
  PRIVATE_KEY = "",
  ALCHEMY_API_KEY = "",
  // opsional: langsung pakai full RPC URL kalau kamu punya
  ALCHEMY_RPC_SEPOLIA = "",
  ETHERSCAN_API_KEY = "",
} = process.env;

// Bangun URL Sepolia dari API key, atau pakai env langsung jika disediakan
const sepoliaUrl =
  ALCHEMY_RPC_SEPOLIA ||
  (ALCHEMY_API_KEY ? `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}` : "");

// Normalisasi accounts: Hardhat butuh array of PK string dengan prefix 0x
const accounts = PRIVATE_KEY
  ? [`0x${PRIVATE_KEY.replace(/^0x/, "")}`]
  : [];

const networks: HardhatUserConfig["networks"] = {
  hardhat: {}, // selalu ada network lokal
};

// Tambahkan sepolia hanya jika URL & PK tersedia
if (sepoliaUrl && accounts.length) {
  networks.sepolia = {
    url: sepoliaUrl,
    chainId: 11155111,
    accounts,
  };
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks,
  // opsional: verifikasi etherscan
  etherscan: ETHERSCAN_API_KEY
    ? { apiKey: ETHERSCAN_API_KEY }
    : undefined,
  // opsional: typechain target ethers v6 (toolbox sudah v6 by default)
  typechain: { outDir: "types", target: "ethers-v6" },
};

export default config;
