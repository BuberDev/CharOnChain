# @charonchain/contracts

Projekt Foundry dla kontraktów SC-1.0 (`CampaignRegistry`, `DonationRouter`, `ReputationSBT`, `ImpactRegistry`).

- **Specyfikacja (źródło prawdy):** `docs/02-SMART-CONTRACTS.md` oraz `contracts/src/interfaces/ICharOnChain.sol` w katalogu głównym repo.
- Katalog `contracts/` w korzeniu to **specyfikacja**; implementacja powstaje tutaj (COC-010..014). Przy COC-010 interfejs zostanie skopiowany do `src/interfaces/`, a CI doda test, że obie kopie są identyczne (ochrona przed rozjazdem — `docs/10` DOC-14).
- Brak funkcji admin-withdraw, brak proxy/upgrade, niezmienny beneficjent (`CLAUDE.md` pkt 5).
- Kontrakty **nie zmieniają się** z powodu Account Abstraction (`docs/02` §9).
