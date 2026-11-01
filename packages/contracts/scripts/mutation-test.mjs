/* global process, console */
/**
 * Ręczne testy mutacyjne kontraktów SC-1.0 (COC-015): do pojedynczego pliku źródłowego wstrzykujemy jeden błąd,
 * uruchamiamy cały zestaw i oczekujemy, że przynajmniej jeden test padnie ("mutant zabity"). Mutant, który
 * przeżył, oznacza lukę w testach albo zmianę równoważną — każdy taki przypadek trzeba wyjaśnić.
 * Użycie: node scripts/mutation-test.mjs [filtr-nazwy]
 * Pliki źródłowe są zawsze przywracane (także po błędzie).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const filter = process.argv[2];

/** @type {{ id: string, file: string, find: string, replace: string, why: string }[]} */
const mutants = [
  {
    id: "R1",
    file: "src/DonationRouter.sol",
    find: "if (amountRaw > remaining) revert CapExceeded();",
    replace: "",
    why: "brak kontroli limitu (INV-03, AC-04)",
  },
  {
    id: "R2",
    file: "src/DonationRouter.sol",
    find: "if (block.timestamp >= campaign.endAt) revert CampaignExpired();",
    replace: "",
    why: "brak kontroli końca okna (AC-05)",
  },
  {
    id: "R3",
    file: "src/DonationRouter.sol",
    find: "if (block.timestamp < campaign.startAt) revert CampaignNotStarted();",
    replace: "",
    why: "brak kontroli startu okna",
  },
  {
    id: "R4",
    file: "src/DonationRouter.sol",
    find: "if (campaign.status != 1) revert CampaignNotActive();",
    replace: "",
    why: "wpłata do wstrzymanej/zamkniętej kampanii (AC-06, INV-08)",
  },
  {
    id: "R5",
    file: "src/DonationRouter.sol",
    find: "amountRaw != remaining) revert BelowMinimumDonation();",
    replace: "amountRaw == remaining) revert BelowMinimumDonation();",
    why: "odwrócony wyjątek końcówki celu (AC-04)",
  },
  {
    id: "R6",
    file: "src/DonationRouter.sol",
    find: "_USDC.safeTransferFrom(msg.sender, campaign.beneficiary, amountRaw);",
    replace: "_USDC.safeTransferFrom(msg.sender, address(this), amountRaw);",
    why: "router trzyma środki (INV-01/02)",
  },
  {
    id: "R7",
    file: "src/DonationRouter.sol",
    find: "external nonReentrant whenNotPaused {",
    replace: "external whenNotPaused {",
    why: "brak ochrony przed reentrancją",
  },
  {
    id: "R8",
    file: "src/DonationRouter.sol",
    find: "external nonReentrant whenNotPaused {",
    replace: "external nonReentrant {",
    why: "pauza routera nie działa (AC-15)",
  },
  {
    id: "R9",
    file: "src/DonationRouter.sol",
    find: "totalDonatedRaw[msg.sender] += amountRaw;",
    replace: "",
    why: "brak licznika darczyńcy (INV-04)",
  },
  {
    id: "R10",
    file: "src/DonationRouter.sol",
    find: "raisedRaw[campaignId] = raised + amountRaw;",
    replace: "",
    why: "brak licznika kampanii (INV-03)",
  },
  {
    id: "R11",
    file: "src/DonationRouter.sol",
    find: "function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {",
    replace: "function unpause() external {",
    why: "każdy może wznowić router (guardian nie może odblokować)",
  },
  {
    id: "R12",
    file: "src/DonationRouter.sol",
    find: "if (tokenDecimals != USDC_DECIMALS) revert InvalidTokenDecimals();",
    replace: "",
    why: "akceptacja tokenu o złej liczbie miejsc",
  },
  {
    id: "R13",
    file: "src/DonationRouter.sol",
    find: "if (amountRaw == 0) revert BelowMinimumDonation();",
    replace: "",
    why: "wpłata zero (przy remaining==0 nie złapie CapExceeded? sprawdza min)",
  },
  {
    id: "C1",
    file: "src/CampaignRegistry.sol",
    find: "function resumeCampaign(uint64 campaignId) external onlyRole(DEFAULT_ADMIN_ROLE) {",
    replace: "function resumeCampaign(uint64 campaignId) external {",
    why: "każdy wznawia kampanię",
  },
  {
    id: "C2",
    file: "src/CampaignRegistry.sol",
    find: ") external onlyRole(REGISTRAR_ROLE) returns (uint64 campaignId) {",
    replace: ") external returns (uint64 campaignId) {",
    why: "każdy tworzy kampanię (AC-30)",
  },
  {
    id: "C3",
    file: "src/CampaignRegistry.sol",
    find: "function closeCampaign(uint64 campaignId) external onlyRole(DEFAULT_ADMIN_ROLE) {",
    replace: "function closeCampaign(uint64 campaignId) external {",
    why: "każdy zamyka kampanię",
  },
  {
    id: "C4",
    file: "src/CampaignRegistry.sol",
    find: "if (startAt >= endAt || endAt <= block.timestamp) revert InvalidTimeRange();",
    replace: "if (startAt > endAt) revert InvalidTimeRange();",
    why: "puste/przeterminowane okno",
  },
  {
    id: "C5",
    file: "src/CampaignRegistry.sol",
    find: "if (campaign.status == STATUS_CLOSED) revert AlreadyClosed();\n        if (campaign.status != STATUS_PAUSED) revert InvalidStatusTransition();",
    replace:
      "if (campaign.status != STATUS_PAUSED && campaign.status != STATUS_CLOSED) revert InvalidStatusTransition();",
    why: "CLOSED wraca do ACTIVE (AC-06)",
  },
  {
    id: "C6",
    file: "src/CampaignRegistry.sol",
    find: "if (!hasRole(PAUSER_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {\n            revert Unauthorized();\n        }\n        Campaign storage campaign = _load(campaignId);\n        if (campaign.status == STATUS_CLOSED) revert AlreadyClosed();",
    replace:
      "Campaign storage campaign = _load(campaignId);\n        if (campaign.status == STATUS_CLOSED) revert AlreadyClosed();",
    why: "każdy wstrzymuje kampanię",
  },
  {
    id: "S1",
    file: "src/ReputationSBT.sol",
    find: "function transferFrom(address, address, uint256) public pure override {\n        revert Soulbound();\n    }",
    replace: "function transferFrom(address, address, uint256) public pure override {}",
    why: "transferFrom nie reweruje (AC-18)",
  },
  {
    id: "S2",
    file: "src/ReputationSBT.sol",
    find: "function approve(address, uint256) public pure override {\n        revert Soulbound();\n    }",
    replace: "function approve(address, uint256) public pure override {}",
    why: "approve dozwolone (AC-18)",
  },
  {
    id: "S3",
    file: "src/ReputationSBT.sol",
    find: "if (ROUTER.totalDonatedRaw(msg.sender) < USDC_UNIT) revert NotEligible();",
    replace: "if (ROUTER.totalDonatedRaw(msg.sender) <= USDC_UNIT) revert NotEligible();",
    why: "próg claim 1 USDC wyłączny (AC-17)",
  },
  {
    id: "S4",
    file: "src/ReputationSBT.sol",
    find: "if (totalRaw >= 100 * USDC_UNIT) return 2;",
    replace: "if (totalRaw >= 101 * USDC_UNIT) return 2;",
    why: "zły próg Bronze (AC-16)",
  },
  {
    id: "S5",
    file: "src/ReputationSBT.sol",
    find: "if (_suspended[wallet]) return 0;\n        return _tierFor",
    replace: "return _tierFor",
    why: "zawieszenie nie zeruje poziomu (AC-21)",
  },
  {
    id: "S6",
    file: "src/ReputationSBT.sol",
    find: "if (_ownerOf(tokenId) != address(0)) revert AlreadyClaimed();",
    replace: "",
    why: "drugi claim (INV-06)",
  },
  {
    id: "S7",
    file: "src/ReputationSBT.sol",
    find: "if (from != address(0) && to != address(0)) revert Soulbound();",
    replace: "",
    why: "brak obrony w głąb w _update (nie musi być wykrywalna: transferFrom i tak reweruje)",
  },
  {
    id: "S8",
    file: "src/ReputationSBT.sol",
    find: "onlyRole(REPUTATION_GOVERNOR_ROLE) {\n        if (wallet == address(0)) revert ZeroAddress();",
    replace: "{\n        if (wallet == address(0)) revert ZeroAddress();",
    why: "każdy zawiesza reputację",
  },
  {
    id: "I1",
    file: "src/ImpactRegistry.sol",
    find: "if (role == REPORT_PUBLISHER_ROLE && hasRole(REVIEWER_ROLE, account)) revert RolesMustBeSeparate();",
    replace: "",
    why: "publisher może być reviewerem (AC-23)",
  },
  {
    id: "I2",
    file: "src/ImpactRegistry.sol",
    find: "if (version != latestVersion[campaignId] + 1) revert InvalidReportVersion();",
    replace: "if (version <= latestVersion[campaignId]) revert InvalidReportVersion();",
    why: "przeskoki wersji raportu",
  },
  {
    id: "I3",
    file: "src/ImpactRegistry.sol",
    find: "if (msg.sender == report.publisher) revert Unauthorized();",
    replace: "",
    why: "autor recenzuje własny raport (AC-23, druga warstwa)",
  },
  {
    id: "I4",
    file: "src/ImpactRegistry.sol",
    find: "if (decision == DECISION_REVOKED) revert InvalidReviewDecision(); // nie ma czego odwoływać",
    replace: "",
    why: "odwołanie niezatwierdzonego raportu",
  },
  {
    id: "I5",
    file: "src/ImpactRegistry.sol",
    find: "} else {\n            revert AlreadyReviewed(); // REJECTED / REVOKED: stan ostateczny\n        }",
    replace: "}",
    why: "REJECTED/REVOKED nie są ostateczne",
  },
  {
    id: "I6",
    file: "src/ImpactRegistry.sol",
    find: "if ((decision == DECISION_REJECTED || decision == DECISION_REVOKED) && reasonHash == bytes32(0)) {\n            revert ReasonRequired();\n        }",
    replace: "",
    why: "odrzucenie/odwołanie bez powodu",
  },
];

const selected = mutants.filter((m) => filter === undefined || m.id.startsWith(filter));
const results = [];

for (const mutant of selected) {
  const path = resolve(root, mutant.file);
  const original = readFileSync(path, "utf8");
  const occurrences = original.split(mutant.find).length - 1;
  if (occurrences !== 1) {
    results.push({ ...mutant, status: `BŁĄD: wzorzec występuje ${String(occurrences)}×` });
    console.log(`${mutant.id}: BŁĄD (wzorzec ×${String(occurrences)})`);
    continue;
  }
  try {
    writeFileSync(path, original.replace(mutant.find, mutant.replace));
    const run = spawnSync("pnpm", ["exec", "hardhat", "test", "solidity"], {
      cwd: root,
      encoding: "utf8",
      timeout: 600_000,
    });
    const out = `${run.stdout}${run.stderr}`;
    const compileError = /Compilation failed|HHE910/.test(out);
    const status = compileError
      ? "NIE KOMPILUJE (nieważny mutant)"
      : run.status === 0
        ? "PRZEŻYŁ"
        : "ZABITY";
    const failing = /(\d+) failing/.exec(out)?.[1] ?? "?";
    results.push({ ...mutant, status, failing });
    console.log(
      `${mutant.id}: ${status}${status === "ZABITY" ? ` (${failing} testów czerwonych)` : ""} — ${mutant.why}`,
    );
  } finally {
    writeFileSync(path, original);
  }
}

const survived = results.filter((r) => r.status === "PRZEŻYŁ");
const invalid = results.filter((r) => r.status !== "PRZEŻYŁ" && r.status !== "ZABITY");
console.log(
  `\nZabite: ${String(results.filter((r) => r.status === "ZABITY").length)}/${String(results.length)}; przeżyły: ${String(survived.length)}; nieważne: ${String(invalid.length)}`,
);
for (const r of [...survived, ...invalid]) console.log(`  ! ${r.id} ${r.status} — ${r.why}`);
process.exit(survived.length === 0 && invalid.length === 0 ? 0 : 1);
