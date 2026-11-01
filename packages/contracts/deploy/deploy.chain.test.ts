/**
 * Testy skryptu wdrożenia na łańcuchu w procesie (EDR). Sprawdzają stan odczytany z łańcucha, nie wyniki
 * transakcji: role, niezmienne powiązania, transfer admina do Safe, pełny przepływ darowizny po wdrożeniu.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import hre from "hardhat";
import { parseManifest } from "@charonchain/shared";
import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  keccak256,
  toBytes,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadArtifact } from "./artifacts.js";
import {
  DeployConfigError,
  LOCAL_CHAIN_ID,
  deployAll,
  validateDeployConfig,
  verifyDeployment,
  type DeployConfig,
  type Deployment,
} from "./deploy.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mockUsdc = JSON.parse(
  readFileSync(join(root, "artifacts/test/utils/MockUSDC.sol/MockUSDC.json"), "utf8"),
) as { abi: Abi; bytecode: Hex };

type Connection = Awaited<ReturnType<typeof hre.network.create>>;
let connection: Connection;
let publicClient: PublicClient;
let accounts: Address[];

const wallet = (address: Address): WalletClient =>
  createWalletClient({ account: address, transport: custom(connection.provider as never) });

const uris = [
  "ipfs://t0",
  "ipfs://t1",
  "ipfs://t2",
  "ipfs://t3",
  "ipfs://t4",
  "ipfs://t5",
] as const;
const SHA = "a".repeat(40);

function configFor(usdc: Address): DeployConfig {
  // accounts[0] = wdrażający; pozostałe to osobne adresy ról (odpowiedniki Safe).
  const [, safe, guardian, registrar, governor, publisher, reviewer] = accounts as [
    Address,
    Address,
    Address,
    Address,
    Address,
    Address,
    Address,
  ];
  return {
    chainId: LOCAL_CHAIN_ID,
    usdc,
    adminSafe: safe,
    roles: {
      guardian,
      registrar,
      reputationGovernor: governor,
      reportPublisher: publisher,
      reviewer,
    },
    adminTransferDelaySeconds: 3 * 86_400,
    tierUris: uris,
    suspendedUri: "ipfs://suspended",
    gitCommitSha: SHA,
  };
}

async function deployMockUsdc(): Promise<Address> {
  const w = wallet(accounts[0] as Address);
  const hash = await w.deployContract({
    abi: mockUsdc.abi,
    bytecode: mockUsdc.bytecode,
    chain: null,
    account: accounts[0] as Address,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return getAddress(receipt.contractAddress as string);
}

async function freshDeployment(): Promise<{ config: DeployConfig; deployment: Deployment }> {
  const config = configFor(await deployMockUsdc());
  const deployment = await deployAll(
    { publicClient, walletClient: wallet(accounts[0] as Address) },
    config,
  );
  return { config, deployment };
}

beforeAll(async () => {
  connection = await hre.network.create();
  publicClient = createPublicClient({ transport: custom(connection.provider as never) });
  accounts = ((await connection.provider.request({ method: "eth_accounts" })) as string[]).map(
    (a) => getAddress(a),
  );
});

afterAll(async () => {
  await connection.close();
});

describe("validateDeployConfig (czyste, bez łańcucha)", () => {
  const dummy = (n: number): Address => getAddress(`0x${n.toString(16).padStart(40, "0")}`);
  const base: DeployConfig = {
    chainId: 421614,
    usdc: dummy(1),
    adminSafe: dummy(2),
    roles: {
      guardian: dummy(3),
      registrar: dummy(4),
      reputationGovernor: dummy(5),
      reportPublisher: dummy(6),
      reviewer: dummy(7),
    },
    adminTransferDelaySeconds: 86_400,
    tierUris: uris,
    suspendedUri: "ipfs://s",
    gitCommitSha: SHA,
  };
  const deployer = dummy(99);

  it("poprawna konfiguracja Sepolia nie ma uwag", () => {
    expect(validateDeployConfig(base, deployer)).toEqual([]);
  });
  it("odrzuca mainnet i dowolną inną sieć (CLAUDE.md pkt 3)", () => {
    expect(validateDeployConfig({ ...base, chainId: 42161 }, deployer).join()).toMatch(/mainnet/);
    expect(validateDeployConfig({ ...base, chainId: 1 }, deployer).join()).toMatch(/wyłącznie/);
  });
  it("wdrażający nie może zachować roli ani być Safe (AC-30)", () => {
    expect(validateDeployConfig({ ...base, adminSafe: deployer }, deployer).join()).toMatch(
      /adminSafe.*wdrażający/,
    );
    expect(
      validateDeployConfig(
        { ...base, roles: { ...base.roles, registrar: deployer } },
        deployer,
      ).join(),
    ).toMatch(/registrar/);
  });
  it("publisher ≠ reviewer, guardian ≠ admin (AC-23)", () => {
    expect(
      validateDeployConfig(
        { ...base, roles: { ...base.roles, reviewer: base.roles.reportPublisher } },
        deployer,
      ).join(),
    ).toMatch(/AC-23/);
    expect(
      validateDeployConfig(
        { ...base, roles: { ...base.roles, guardian: base.adminSafe } },
        deployer,
      ).join(),
    ).toMatch(/guardian/);
  });
  it("poza siecią lokalną opóźnienie admina ≥ 1 doba; w sieci lokalnej dozwolone 0", () => {
    expect(
      validateDeployConfig({ ...base, adminTransferDelaySeconds: 3_600 }, deployer).join(),
    ).toMatch(/minimum/);
    expect(
      validateDeployConfig(
        { ...base, chainId: LOCAL_CHAIN_ID, adminTransferDelaySeconds: 0 },
        deployer,
      ),
    ).toEqual([]);
  });
  it("odrzuca adres zerowy, zły checksum, puste URI i zły commit", () => {
    expect(
      validateDeployConfig(
        { ...base, usdc: "0x0000000000000000000000000000000000000000" },
        deployer,
      ).join(),
    ).toMatch(/zerowy/);
    const withLetters = getAddress("0x00000000000000000000000000000000000000ab");
    const badChecksum =
      withLetters.replace(/[A-F]/, (c) => c.toLowerCase()) === withLetters
        ? withLetters.replace(/[a-f]/, (c) => c.toUpperCase())
        : withLetters.replace(/[A-F]/, (c) => c.toLowerCase());
    expect(badChecksum).not.toBe(withLetters);
    expect(
      validateDeployConfig({ ...base, usdc: badChecksum as Address }, deployer).join(),
    ).toMatch(/usdc: niepoprawny adres/);
    expect(validateDeployConfig({ ...base, suspendedUri: "" }, deployer).join()).toMatch(/puste/);
    expect(validateDeployConfig({ ...base, gitCommitSha: "xyz" }, deployer).join()).toMatch(
      /gitCommitSha/,
    );
  });
});

describe("deployAll na łańcuchu lokalnym", () => {
  it("wdraża, nadaje role, planuje transfer admina i przechodzi weryfikację z łańcucha", async () => {
    const { config, deployment } = await freshDeployment();
    expect(await verifyDeployment(publicClient, deployment, config)).toEqual([]);
    expect(deployment.adminTransferStatus).toBe("ADMIN_TRANSFER_PENDING");
    expect(new Set(Object.values(deployment.contracts)).size).toBe(4);
  });

  it("szkic manifestu przechodzi parseManifest (po podstawieniu chainId Sepolia dla sieci lokalnej)", async () => {
    const { deployment } = await freshDeployment();
    const manifest = parseManifest({ ...deployment.manifest, chainId: 421614 });
    expect(manifest.contracts.router).toBe(deployment.contracts.router);
    expect(manifest.sourcesHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("do czasu akceptacji przez Safe weryfikacja „admin przyjęty” zgłasza problemy; po akceptacji przechodzi", async () => {
    const { config, deployment } = await freshDeployment();
    const early = await verifyDeployment(publicClient, deployment, config, {
      expectAdminAccepted: true,
    });
    expect(early.length).toBe(8); // po 2 uwagi na kontrakt: admin ≠ Safe oraz oczekujący transfer
    expect(early.join()).toMatch(/oczekiwano Safe/);

    await connection.provider.request({ method: "evm_increaseTime", params: [3 * 86_400 + 10] });
    await connection.provider.request({ method: "evm_mine", params: [] });
    const safe = wallet(config.adminSafe);
    for (const [name, address] of [
      ["CampaignRegistry", deployment.contracts.registry],
      ["DonationRouter", deployment.contracts.router],
      ["ReputationSBT", deployment.contracts.reputation],
      ["ImpactRegistry", deployment.contracts.impact],
    ] as const) {
      const hash = await safe.writeContract({
        address,
        abi: loadArtifact(name).abi,
        functionName: "acceptDefaultAdminTransfer",
        account: config.adminSafe,
        chain: null,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
    expect(
      await verifyDeployment(publicClient, deployment, config, { expectAdminAccepted: true }),
    ).toEqual([]);
    // Wdrażający utracił uprawnienia admina.
    const deployer = wallet(accounts[0] as Address);
    await expect(
      deployer.writeContract({
        address: deployment.contracts.router,
        abi: loadArtifact("DonationRouter").abi,
        functionName: "unpause",
        account: accounts[0] as Address,
        chain: null,
      }),
    ).rejects.toThrow();
  });

  it("weryfikacja wykrywa rozbieżność ról (inny registrar niż w konfiguracji)", async () => {
    const { config, deployment } = await freshDeployment();
    const tampered: DeployConfig = {
      ...config,
      roles: { ...config.roles, registrar: accounts[10] as Address },
    };
    const problems = await verifyDeployment(publicClient, deployment, tampered);
    expect(problems.join()).toMatch(/registry\.REGISTRAR/);
  });

  it("rzuca przy niezgodnym chainId węzła i nie wysyła transakcji", async () => {
    const config = { ...configFor(await deployMockUsdc()), chainId: 421614 };
    const before = await publicClient.getBlockNumber();
    await expect(
      deployAll({ publicClient, walletClient: wallet(accounts[0] as Address) }, config),
    ).rejects.toBeInstanceOf(DeployConfigError);
    expect(await publicClient.getBlockNumber()).toBe(before);
  });

  it("odrzuca USDC o innej liczbie miejsc (konstruktor routera) bez częściowego manifestu", async () => {
    const token18 = JSON.parse(
      readFileSync(join(root, "artifacts/test/utils/MockToken18.sol/MockToken18.json"), "utf8"),
    ) as { abi: Abi; bytecode: Hex };
    const w = wallet(accounts[0] as Address);
    const hash = await w.deployContract({
      abi: token18.abi,
      bytecode: token18.bytecode,
      chain: null,
      account: accounts[0] as Address,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const config = configFor(getAddress(receipt.contractAddress as string));
    await expect(deployAll({ publicClient, walletClient: w }, config)).rejects.toThrow();
  });

  it("po wdrożeniu działa pełny przepływ: kampania → darowizna → saldo beneficjenta → claim SBT", async () => {
    const { config, deployment } = await freshDeployment();
    const registryAbi = loadArtifact("CampaignRegistry").abi;
    const routerAbi = loadArtifact("DonationRouter").abi;
    const sbtAbi = loadArtifact("ReputationSBT").abi;
    const beneficiary = accounts[11] as Address;
    const donor = accounts[12] as Address;

    const block = await publicClient.getBlock();
    const start = block.timestamp - 10n;
    const end = block.timestamp + 86_400n;
    const registrar = wallet(config.roles.registrar);
    await publicClient.waitForTransactionReceipt({
      hash: await registrar.writeContract({
        address: deployment.contracts.registry,
        abi: registryAbi,
        functionName: "createCampaign",
        args: [
          beneficiary,
          1_000_000_000n,
          start,
          end,
          keccak256(toBytes("org")),
          keccak256(toBytes("meta")),
        ],
        account: config.roles.registrar,
        chain: null,
      }),
    });

    const donorWallet = wallet(donor);
    const tx = async (hash: Hex): Promise<void> => {
      const r = await publicClient.waitForTransactionReceipt({ hash });
      expect(r.status).toBe("success");
    };
    await tx(
      await wallet(accounts[0] as Address).writeContract({
        address: config.usdc,
        abi: mockUsdc.abi,
        functionName: "mint",
        args: [donor, 5_000_000n],
        account: accounts[0] as Address,
        chain: null,
      }),
    );
    await tx(
      await donorWallet.writeContract({
        address: config.usdc,
        abi: mockUsdc.abi,
        functionName: "approve",
        args: [deployment.contracts.router, 2_000_000n],
        account: donor,
        chain: null,
      }),
    );
    await tx(
      await donorWallet.writeContract({
        address: deployment.contracts.router,
        abi: routerAbi,
        functionName: "donate",
        args: [1n, 2_000_000n],
        account: donor,
        chain: null,
      }),
    );

    const received = await publicClient.readContract({
      address: config.usdc,
      abi: mockUsdc.abi,
      functionName: "balanceOf",
      args: [beneficiary],
    });
    expect(received).toBe(2_000_000n); // 100% do beneficjenta, bez prowizji
    const routerBalance = await publicClient.readContract({
      address: config.usdc,
      abi: mockUsdc.abi,
      functionName: "balanceOf",
      args: [deployment.contracts.router],
    });
    expect(routerBalance).toBe(0n); // router nie przechowuje środków

    await tx(
      await donorWallet.writeContract({
        address: deployment.contracts.reputation,
        abi: sbtAbi,
        functionName: "claim",
        account: donor,
        chain: null,
      }),
    );
    expect(
      await publicClient.readContract({
        address: deployment.contracts.reputation,
        abi: sbtAbi,
        functionName: "tierOf",
        args: [donor],
      }),
    ).toBeGreaterThanOrEqual(1);

    // Guardian może wstrzymać, ale nie odblokować (docs/02 §1).
    const guardian = wallet(config.roles.guardian);
    await tx(
      await guardian.writeContract({
        address: deployment.contracts.router,
        abi: routerAbi,
        functionName: "pause",
        account: config.roles.guardian,
        chain: null,
      }),
    );
    await expect(
      guardian.writeContract({
        address: deployment.contracts.router,
        abi: routerAbi,
        functionName: "unpause",
        account: config.roles.guardian,
        chain: null,
      }),
    ).rejects.toThrow();
  });
});

describe("CLI deploy:sepolia (bez sieci)", () => {
  it("odmawia mainnetu jeszcze przed odczytem klucza i nie wypisuje sekretów", async () => {
    const { spawnSync } = await import("node:child_process");
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "coc-deploy-"));
    const cfgPath = join(dir, "cfg.json");
    const secret = `0x${"1".repeat(64)}`;
    writeFileSync(
      cfgPath,
      JSON.stringify({ ...configFor(getAddress(`0x${"2".repeat(40)}`)), chainId: 42161 }),
    );
    const result = spawnSync("node_modules/.bin/tsx", ["deploy/cli.ts"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        DEPLOY_CONFIG: cfgPath,
        DEPLOYER_PRIVATE_KEY: secret,
        ARBITRUM_SEPOLIA_RPC_URL: "http://127.0.0.1:1",
      },
    });
    expect(result.status).not.toBe(0);
    const stderr = `${result.stderr}${result.stdout}`;
    expect(stderr).toMatch(/wyłącznie na Arbitrum Sepolia/);
    expect(stderr).not.toContain(secret);
  });
});
