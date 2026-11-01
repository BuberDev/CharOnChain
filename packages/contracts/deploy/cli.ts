/**
 * CLI wdrożenia na Arbitrum Sepolia (COC-016). WYMAGA działań właściciela: RPC, klucz wdrażającego z testnetowym
 * ETH, adresy Safe i ról. Skrypt NIE jest uruchamiany w CI ani przez agenta bez jawnej zgody.
 *
 *   DEPLOY_CONFIG=deploy.sepolia.json ARBITRUM_SEPOLIA_RPC_URL=… pnpm --filter @charonchain/contracts run deploy:sepolia
 *   … dodaj `--execute`, żeby faktycznie wysłać transakcje (domyślnie: plan i walidacja, zero transakcji).
 *
 * Gwarancje: wyłącznie Arbitrum Sepolia (421614) — mainnet jest odrzucany w kodzie i wymaga zmiany kodu po decyzji
 * właściciela; klucz prywatny tylko ze zmiennej środowiskowej `DEPLOYER_PRIVATE_KEY` (nigdy z pliku ani argumentów,
 * nigdy w logach); manifest zapisywany dopiero po weryfikacji stanu z łańcucha i walidacji `parseManifest`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { parseManifest } from "@charonchain/shared";
import { createPublicClient, createWalletClient, http, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  DeployConfigError,
  deployAll,
  validateDeployConfig,
  type DeployConfig,
} from "./deploy.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const config = JSON.parse(readFileSync(requireEnv("DEPLOY_CONFIG"), "utf8")) as DeployConfig;
  if (config.chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) {
    throw new DeployConfigError([
      "to CLI wdraża wyłącznie na Arbitrum Sepolia (421614); mainnet wymaga decyzji właściciela",
    ]);
  }

  const rpcUrl = requireEnv("ARBITRUM_SEPOLIA_RPC_URL");
  const key = requireEnv("DEPLOYER_PRIVATE_KEY");
  if (!isHex(key) || key.length !== 66)
    throw new Error("DEPLOYER_PRIVATE_KEY: oczekiwano 0x + 64 znaki hex");
  const account = privateKeyToAccount(key);

  const issues = validateDeployConfig(config, account.address);
  if (issues.length > 0) throw new DeployConfigError(issues);

  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain: arbitrumSepolia,
    transport: http(rpcUrl),
  });
  const nodeChainId = await publicClient.getChainId();
  if (nodeChainId !== ARBITRUM_SEPOLIA_CHAIN_ID)
    throw new Error(`RPC zwraca chainId ${String(nodeChainId)}, oczekiwano 421614`);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Wdrażający: ${account.address} (saldo ${balance.toString()} wei)`);
  console.log(
    `USDC: ${config.usdc} · Safe admina: ${config.adminSafe} · opóźnienie admina: ${String(config.adminTransferDelaySeconds)} s`,
  );
  if (!execute) {
    console.log(
      "Tryb planu: walidacja przeszła, żadna transakcja nie została wysłana. Dodaj --execute, aby wdrożyć.",
    );
    return;
  }

  const deployment = await deployAll({ publicClient, walletClient }, config);
  const manifest = parseManifest(deployment.manifest);
  const out = process.env["DEPLOY_MANIFEST_OUT"] ?? "deployments/arbitrum-sepolia.json";
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify({ ...manifest, status: deployment.adminTransferStatus }, null, 2)}\n`,
  );
  console.log(
    `Wdrożono. Manifest: ${out}. Status: ${deployment.adminTransferStatus} — Safe musi wywołać acceptDefaultAdminTransfer() w 4 kontraktach po upływie opóźnienia.`,
  );
  console.log(
    "Zweryfikuj kod w eksploratorze i potwierdź obsługę opcodów cancun (PUSH0/MCOPY) na Sepolia, zanim cokolwiek uznasz za gotowe.",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Nieznany błąd");
  process.exitCode = 1;
});
