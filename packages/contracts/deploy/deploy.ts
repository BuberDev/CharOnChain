/**
 * Wdrożenie SC-1.0 (COC-016): czysta logika oparta na viem, niezależna od sieci. Używana przez lokalne testy
 * (silnik EDR w procesie) i przez CLI (`cli.ts`, Arbitrum Sepolia). Nie zawiera kluczy ani sekretów.
 *
 * Model uprawnień (docs/02 §5, AC-30): wdrażający (EOA) jest początkowym adminem tylko na czas wdrożenia;
 * na końcu wywołuje `beginDefaultAdminTransfer(adminSafe)` w każdym kontrakcie. Safe musi osobno wywołać
 * `acceptDefaultAdminTransfer()` po upływie opóźnienia. Do tego czasu wdrażający nadal jest adminem —
 * manifest ma status ADMIN_TRANSFER_PENDING i NIE wolno go uznać za końcowy.
 */
import {
  getAddress,
  isAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

import {
  CONTRACT_NAMES,
  computeSourcesHash,
  loadArtifact,
  type ContractName,
  type LoadedArtifact,
} from "./artifacts.js";

export const LOCAL_CHAIN_ID = 31337;
export const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
export const MIN_ADMIN_TRANSFER_DELAY_SECONDS = 86_400; // 1 doba poza siecią lokalną

export interface DeployRoles {
  readonly guardian: Address;
  readonly registrar: Address;
  readonly reputationGovernor: Address;
  readonly reportPublisher: Address;
  readonly reviewer: Address;
}

export interface DeployConfig {
  readonly chainId: number;
  readonly usdc: Address;
  readonly adminSafe: Address;
  readonly roles: DeployRoles;
  readonly adminTransferDelaySeconds: number;
  readonly tierUris: readonly [string, string, string, string, string, string];
  readonly suspendedUri: string;
  readonly gitCommitSha: string;
}

export class DeployConfigError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Niepoprawna konfiguracja wdrożenia:\n- ${issues.join("\n- ")}`);
    this.name = "DeployConfigError";
    this.issues = issues;
  }
}

const ZERO = "0x0000000000000000000000000000000000000000";

/** Walidacja przed jakąkolwiek transakcją. Zwraca listę problemów (pusta = OK). */
export function validateDeployConfig(config: DeployConfig, deployer: Address): string[] {
  const issues: string[] = [];
  const named: [string, string][] = [
    ["usdc", config.usdc],
    ["adminSafe", config.adminSafe],
    ...(Object.entries(config.roles) as [string, string][]),
  ];
  for (const [name, value] of named) {
    if (!isAddress(value, { strict: true }))
      issues.push(`${name}: niepoprawny adres EVM lub suma kontrolna`);
    else if (value.toLowerCase() === ZERO) issues.push(`${name}: adres zerowy jest niedozwolony`);
  }
  if (issues.length > 0) return issues;

  const lower = (a: string): string => a.toLowerCase();
  const holders: [string, Address][] = [
    ["adminSafe", config.adminSafe],
    ...(Object.entries(config.roles) as [string, Address][]),
  ];
  for (const [name, address] of holders) {
    if (lower(address) === lower(deployer)) {
      issues.push(`${name}: wdrażający nie może zachować żadnej roli (AC-30)`);
    }
    if (lower(address) === lower(config.usdc))
      issues.push(`${name}: rola nie może wskazywać tokenu`);
  }
  if (lower(config.roles.reportPublisher) === lower(config.roles.reviewer)) {
    issues.push("reportPublisher i reviewer muszą być różnymi adresami (AC-23)");
  }
  if (lower(config.roles.guardian) === lower(config.adminSafe)) {
    issues.push("guardian musi być adresem osobnym od adminSafe");
  }
  if (
    !Number.isSafeInteger(config.adminTransferDelaySeconds) ||
    config.adminTransferDelaySeconds < 0 ||
    config.adminTransferDelaySeconds >= 2 ** 48
  ) {
    issues.push("adminTransferDelaySeconds: oczekiwano liczby całkowitej z zakresu uint48");
  } else if (
    config.chainId !== LOCAL_CHAIN_ID &&
    config.adminTransferDelaySeconds < MIN_ADMIN_TRANSFER_DELAY_SECONDS
  ) {
    issues.push(
      `adminTransferDelaySeconds: poza siecią lokalną minimum to ${String(MIN_ADMIN_TRANSFER_DELAY_SECONDS)} s`,
    );
  }
  if (config.chainId !== LOCAL_CHAIN_ID && config.chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) {
    issues.push(
      `chainId ${String(config.chainId)}: skrypt obsługuje wyłącznie sieć lokalną i Arbitrum Sepolia; mainnet wymaga jawnej decyzji właściciela i bramek bezpieczeństwa (CLAUDE.md pkt 3)`,
    );
  }
  if (config.tierUris.some((uri) => uri.length === 0) || config.suspendedUri.length === 0) {
    issues.push("tierUris i suspendedUri nie mogą być puste");
  }
  if (!/^[0-9a-f]{40}$/.test(config.gitCommitSha))
    issues.push("gitCommitSha: oczekiwano 40 znaków hex (małe litery)");
  return issues;
}

export interface Deployment {
  readonly chainId: number;
  readonly deployer: Address;
  readonly contracts: Record<"registry" | "router" | "reputation" | "impact", Address>;
  readonly transactions: readonly { readonly label: string; readonly hash: Hex }[];
  /** Szkic manifestu zgodny z `parseManifest` (status końcowy: patrz `adminTransferStatus`). */
  readonly manifest: {
    readonly chainId: number;
    readonly gitCommitSha: string;
    readonly solcVersion: string;
    readonly sourcesHash: Hex;
    readonly usdc: Address;
    readonly contracts: Deployment["contracts"];
    readonly roles: {
      readonly adminSafe: Address;
      readonly guardian: Address;
      readonly registrar: Address;
      readonly reputationGovernor: Address;
      readonly reportPublisher: Address;
      readonly reviewer: Address;
    };
  };
  readonly adminTransferStatus: "ADMIN_TRANSFER_PENDING";
}

export interface DeployClients {
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient;
}

export interface DeployOptions {
  /** Podmiana ładowania artefaktów (testy). */
  readonly artifacts?: (name: ContractName) => LoadedArtifact;
  readonly solcVersion?: string;
  readonly sourcesHash?: Hex;
}

const ROLE = {
  PAUSER: "PAUSER_ROLE",
  REGISTRAR: "REGISTRAR_ROLE",
  GOVERNOR: "REPUTATION_GOVERNOR_ROLE",
  PUBLISHER: "REPORT_PUBLISHER_ROLE",
  REVIEWER: "REVIEWER_ROLE",
} as const;

type Contracts = Deployment["contracts"];

export async function deployAll(
  clients: DeployClients,
  config: DeployConfig,
  options: DeployOptions = {},
): Promise<Deployment> {
  const { publicClient, walletClient } = clients;
  const account = walletClient.account;
  if (account === undefined) throw new Error("walletClient bez konta wdrażającego");
  const deployer = account.address;

  const actualChainId = await publicClient.getChainId();
  if (actualChainId !== config.chainId) {
    throw new DeployConfigError([
      `chainId węzła (${String(actualChainId)}) różni się od konfiguracji (${String(config.chainId)})`,
    ]);
  }
  const issues = validateDeployConfig(config, deployer);
  if (issues.length > 0) throw new DeployConfigError(issues);

  const load = options.artifacts ?? ((name: ContractName) => loadArtifact(name));
  const art = Object.fromEntries(CONTRACT_NAMES.map((n) => [n, load(n)])) as Record<
    ContractName,
    LoadedArtifact
  >;
  const transactions: { label: string; hash: Hex }[] = [];

  const wait = async (label: string, hash: Hex): Promise<void> => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success")
      throw new Error(`Transakcja „${label}” nie powiodła się (${hash})`);
    transactions.push({ label, hash });
  };

  const deploy = async (name: ContractName, args: readonly unknown[]): Promise<Address> => {
    const hash = await walletClient.deployContract({
      abi: art[name].abi,
      bytecode: art[name].bytecode,
      args,
      account,
      chain: null,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (
      receipt.status !== "success" ||
      receipt.contractAddress === null ||
      receipt.contractAddress === undefined
    ) {
      throw new Error(`Wdrożenie ${name} nie powiodło się (${hash})`);
    }
    transactions.push({ label: `deploy ${name}`, hash });
    return getAddress(receipt.contractAddress);
  };

  const call = async (
    address: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[],
    label: string,
  ): Promise<void> => {
    const hash = await walletClient.writeContract({
      address,
      abi,
      functionName,
      args,
      account,
      chain: null,
    });
    await wait(label, hash);
  };

  const readRole = async (address: Address, abi: Abi, constant: string): Promise<Hex> =>
    (await publicClient.readContract({ address, abi, functionName: constant })) as Hex;

  const delay = config.adminTransferDelaySeconds;
  const registry = await deploy("CampaignRegistry", [delay, deployer]);
  const router = await deploy("DonationRouter", [config.usdc, registry, delay, deployer]);
  const reputation = await deploy("ReputationSBT", [
    router,
    delay,
    deployer,
    [...config.tierUris],
    config.suspendedUri,
  ]);
  const impact = await deploy("ImpactRegistry", [registry, delay, deployer]);
  const contracts: Contracts = { registry, router, reputation, impact };

  const grant = async (
    contract: Address,
    name: ContractName,
    constant: string,
    holder: Address,
  ): Promise<void> => {
    const abi = art[name].abi;
    const role = await readRole(contract, abi, constant);
    await call(contract, abi, "grantRole", [role, holder], `grant ${constant} @ ${name}`);
  };

  await grant(registry, "CampaignRegistry", ROLE.REGISTRAR, config.roles.registrar);
  await grant(registry, "CampaignRegistry", ROLE.PAUSER, config.roles.guardian);
  await grant(router, "DonationRouter", ROLE.PAUSER, config.roles.guardian);
  await grant(reputation, "ReputationSBT", ROLE.GOVERNOR, config.roles.reputationGovernor);
  await grant(impact, "ImpactRegistry", ROLE.PUBLISHER, config.roles.reportPublisher);
  await grant(impact, "ImpactRegistry", ROLE.REVIEWER, config.roles.reviewer);

  for (const [name, address] of [
    ["CampaignRegistry", registry],
    ["DonationRouter", router],
    ["ReputationSBT", reputation],
    ["ImpactRegistry", impact],
  ] as const) {
    await call(
      address,
      art[name].abi,
      "beginDefaultAdminTransfer",
      [config.adminSafe],
      `beginDefaultAdminTransfer(${name})`,
    );
  }

  const deployment: Deployment = {
    chainId: config.chainId,
    deployer,
    contracts,
    transactions,
    manifest: {
      chainId: config.chainId,
      gitCommitSha: config.gitCommitSha,
      solcVersion: options.solcVersion ?? "0.8.28",
      sourcesHash: options.sourcesHash ?? computeSourcesHash(),
      usdc: config.usdc,
      contracts,
      roles: { adminSafe: config.adminSafe, ...config.roles },
    },
    adminTransferStatus: "ADMIN_TRANSFER_PENDING",
  };

  const problems = await verifyDeployment(publicClient, deployment, config, options);
  if (problems.length > 0)
    throw new Error(`Weryfikacja po wdrożeniu nie przeszła:\n- ${problems.join("\n- ")}`);
  return deployment;
}

/**
 * Odczytuje stan łańcucha i porównuje z konfiguracją (nie ufa wynikom transakcji). Zwraca listę rozbieżności.
 * `expectAdminAccepted: true` — po `acceptDefaultAdminTransfer` przez Safe: admin == Safe i brak oczekującego transferu.
 */
export async function verifyDeployment(
  publicClient: PublicClient,
  deployment: Deployment,
  config: DeployConfig,
  options: DeployOptions & { readonly expectAdminAccepted?: boolean } = {},
): Promise<string[]> {
  const load = options.artifacts ?? ((name: ContractName) => loadArtifact(name));
  const problems: string[] = [];
  const { registry, router, reputation, impact } = deployment.contracts;
  const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

  const read = (
    address: Address,
    name: ContractName,
    functionName: string,
    args: readonly unknown[] = [],
  ): Promise<unknown> =>
    publicClient.readContract({ address, abi: load(name).abi, functionName, args });

  const targets: [string, Address, ContractName][] = [
    ["registry", registry, "CampaignRegistry"],
    ["router", router, "DonationRouter"],
    ["reputation", reputation, "ReputationSBT"],
    ["impact", impact, "ImpactRegistry"],
  ];

  for (const [label, address, name] of targets) {
    const code = await publicClient.getCode({ address });
    if (code === undefined || code === "0x") problems.push(`${label}: brak kodu pod adresem`);

    const defaultAdmin = (await read(address, name, "defaultAdmin")) as Address;
    const [pending, schedule] = (await read(address, name, "pendingDefaultAdmin")) as [
      Address,
      number,
    ];
    const delay = (await read(address, name, "defaultAdminDelay")) as number;
    if (delay !== config.adminTransferDelaySeconds)
      problems.push(
        `${label}: opóźnienie admina ${String(delay)} ≠ ${String(config.adminTransferDelaySeconds)}`,
      );
    if (options.expectAdminAccepted === true) {
      if (!eq(defaultAdmin, config.adminSafe))
        problems.push(`${label}: admin to ${defaultAdmin}, oczekiwano Safe`);
      if (!eq(pending, "0x0000000000000000000000000000000000000000"))
        problems.push(`${label}: nadal oczekuje transfer admina`);
    } else {
      if (!eq(defaultAdmin, deployment.deployer))
        problems.push(`${label}: przed akceptacją adminem ma pozostać wdrażający`);
      if (!eq(pending, config.adminSafe) || schedule === 0)
        problems.push(`${label}: brak zaplanowanego transferu admina do Safe`);
    }
  }

  const hasRole = async (
    address: Address,
    name: ContractName,
    constant: string,
    holder: Address,
  ): Promise<boolean> => {
    const role = (await read(address, name, constant)) as Hex;
    return (await read(address, name, "hasRole", [role, holder])) as boolean;
  };
  const expectations: [string, Address, ContractName, string, Address][] = [
    ["registry.REGISTRAR", registry, "CampaignRegistry", ROLE.REGISTRAR, config.roles.registrar],
    ["registry.PAUSER", registry, "CampaignRegistry", ROLE.PAUSER, config.roles.guardian],
    ["router.PAUSER", router, "DonationRouter", ROLE.PAUSER, config.roles.guardian],
    [
      "reputation.GOVERNOR",
      reputation,
      "ReputationSBT",
      ROLE.GOVERNOR,
      config.roles.reputationGovernor,
    ],
    ["impact.PUBLISHER", impact, "ImpactRegistry", ROLE.PUBLISHER, config.roles.reportPublisher],
    ["impact.REVIEWER", impact, "ImpactRegistry", ROLE.REVIEWER, config.roles.reviewer],
  ];
  for (const [label, address, name, constant, holder] of expectations) {
    if (!(await hasRole(address, name, constant, holder)))
      problems.push(`${label}: brak roli u ${holder}`);
  }
  // Wdrażający nie zachowuje ról operacyjnych (poza tymczasowym adminem).
  for (const [label, address, name, constant] of expectations) {
    if (await hasRole(address, name, constant, deployment.deployer))
      problems.push(`${label}: wdrażający zachował rolę`);
  }

  // Powiązania niezmienne.
  if (!eq((await read(router, "DonationRouter", "usdc")) as string, config.usdc))
    problems.push("router.usdc ≠ konfiguracja");
  if (!eq((await read(router, "DonationRouter", "REGISTRY")) as string, registry))
    problems.push("router.REGISTRY ≠ registry");
  if (!eq((await read(reputation, "ReputationSBT", "ROUTER")) as string, router))
    problems.push("reputation.ROUTER ≠ router");
  if (!eq((await read(impact, "ImpactRegistry", "REGISTRY")) as string, registry))
    problems.push("impact.REGISTRY ≠ registry");

  // Stan początkowy: żadnych wpłat, żadnej pauzy.
  if ((await read(router, "DonationRouter", "paused")) as boolean)
    problems.push("router jest wstrzymany po wdrożeniu");
  return problems;
}
