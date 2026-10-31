# Backlog implementacyjny dla Claude Code — CharOnChain MVP

## Sposób pracy

Każde zadanie to odrębny PR (lub krótszy podział PR, jeśli istotnie duży). Przed kodowaniem Claude czyta `README.md`, `CLAUDE.md` oraz odpowiednie dokumenty. Każdy PR zawiera testy i raport mapowania do `AC-xx`. W sprawach pieniędzy/bezpieczeństwa nie wprowadzać zmian produktu „dla wygody” bez zgody właściciela. W zadaniach frontendowych obowiązkowe skille Taste + Design oraz AC-36..43 (docs/08 i docs/09).

### Priorytety

- `P0`: konieczne do pełnego demonstratora MVP na Arbitrum Sepolia.
- `P0-GATE`: konieczne do realnego uruchomienia; audyt/regulacje wykonywane przez odpowiednich specjalistów, a nie zastępowane przez Claude.
- `P1`: po bezpiecznym MVP.

### Epik E0 — fundament

| ID | P | Zależności | Zadanie i rezultat | Kryterium zakończenia |
|---|---|---|---|---|
| COC-001 | P0 | — | Monorepo pnpm z `apps/web`, `apps/indexer`, `apps/admin`, `packages/contracts`, `packages/database`, `packages/ui`; CI i env.example | setup 1 komendą, lint/tsc/build/test pass, brak sekretów |
| COC-002 | P0 | 001 | Konfiguracja sieci, address manifest, TypeScript shared BigInt + tier math | chain 42161/421614, native USDC tylko verified mainnet, testy progów |
| COC-003 | P0 | 001 | **Skill preflight Taste + Design**, trzy art directions, dokument decyzji, tokeny, Tailwind/shadcn, a11y | oba `SKILL.md` realnie użyte, 3 warianty, AC-36/37, decyzje i tokens |
| COC-003A | P0 | 003 | **Design-first review gate**: preview home/campaign/checkout z autentycznymi danymi demo | zatwierdzony spójny prototyp RWD, AC-38, artefakty wizualne |
| COC-004 | P0 | 001 | Supabase setup, migration runner, seed dla local/staging, bezpieczne env | local migrations i rollback test przechodzą |

### Epik E1 — Solidity / Foundry

| ID | P | Zależności | Zadanie i rezultat | Kryterium zakończenia |
|---|---|---|---|---|
| COC-010 | P0 | 001,002 | Foundry + mock native USDC 6 decimals, role scaffolding, fixtures | compile/fmt, 100% wymaganych testów bazowych uruchamialne |
| COC-011 | P0 | 010 | `CampaignRegistry.sol` zgodny ze spec, statusy, immutable terms | AC-01..06, AC-30, INV-05/08, fuzz |
| COC-012 | P0 | 011 | `DonationRouter.sol`: direct transfer, cap, events, counters, pause | AC-04..15, AC-29, INV-01..04,06..10 |
| COC-013 | P0 | 012 | `ReputationSBT.sol` ERC721 + ERC5192, claim/burn, dynamic tiers | AC-16..21, AC-28, INV-06 i negative approval tests |
| COC-014 | P0 | 011 | `ImpactRegistry.sol`, append-only publication/review/version | AC-22..24, test oddzielnych ról i review revocation |
| COC-015 | P0 | 011..014 | Invariant/fuzz suite, gas benchmark, Slither, role attack tests | 0 unresolved test failures, raport pokrycia/gas, ręczna lista znanych ryzyk |
| COC-016 | P0 | 015 | Deploy scripts local + Arbitrum Sepolia, manifest/verification | test Safe 2-of-3, onchain integration, explorer verified |

### Epik E2 — Postgres / auth / storage

| ID | P | Zależności | Zadanie i rezultat | Kryterium zakończenia |
|---|---|---|---|---|
| COC-020 | P0 | 004 | Migrations encji organizations, members, campaign draft/revision/review | typy, FK, partial unique, status constraints, seeds |
| COC-021 | P0 | 004 | Migrations chain_events, donations, stats, indexer_cursors | unique chain/tx/log; raw numeric; no public writes |
| COC-022 | P0 | 004 | Migrations reports, asset/private KYB, audit, abuse, sessions | wersjonowanie i retencja, audyt zdarzeń |
| COC-023 | P0 | 020..022 | RLS i testy negatywne dla owner/org/reviewer/admin/guest | AC-25, brak cross-tenant leakage, deny-by-default |
| COC-024 | P0 | 020,023 | SIWE EIP-4361 auth, nonce, EIP-1271, cookies, rate limiting | AC-26, replay fail, role checks server-side |
| COC-025 | P0 | 022,023 | Supabase Storage buckets, validation MIME/size, EXIF, scan hook | private documents inaccessible to outsiders, AC-25 |

### Epik E3 — Indexer / public APIs

| ID | P | Zależności | Zadanie i rezultat | Kryterium zakończenia |
|---|---|---|---|---|
| COC-030 | P0 | 012,021 | Worker viem event scan, idempotent journal, cursors, retry | AC-13, restart/duplicate safe |
| COC-031 | P0 | 030 | Reorg detection, backfill, projections, reconciliation RPC | AC-14, AC-33, sum getters vs db zero diff |
| COC-032 | P0 | 020,021,030 | Public read APIs campaigns, organizations, donations, status | pagination, input schema, privacy, raw USDC strings |
| COC-033 | P0 | 022,024,023 | Admin/org write API: draft, reviews, publish intent Safe calldata | 4-eyes, AC-01/02/03/23, audit log, RLS |
| COC-034 | P0 | 022,030 | Impact report API, public JSON canonicalization, hash/version | AC-22/24, RFC8785 fixtures + storage URI |
| COC-035 | P0 | 031 | Metrics/alerting for indexer lag, bad RPC, reorg, role/pause events | AC-33, error simulation emits alert |

### Epik E4 — Web application

| ID | P | Zależności | Zadanie i rezultat | Kryterium zakończenia |
|---|---|---|---|---|
| COC-040 | P0 | 003A,032 | Home, catalog, campaign detail, org detail, Trust Center | UX-01,02,03,06,17; accessibility and SEO |
| COC-041 | P0 | 012,002,040 | Wallet connect, approve/donate checkout state machine | UX-04,05, AC-07..12/35, test 360px |
| COC-042 | P0 | 024,031,013 | Donor profile, chain stats, claim/burn SBT, optional public profile | UX-08..10, AC-16..21/27/28 |
| COC-043 | P0 | 023,025,033 | Organization portal: applications, drafts, previews, submit | UX-11..13, AC-01/02/03/25 |
| COC-044 | P0 | 034,043 | Reports UI, moderation workflow, public impact explorer | UX-07/14, AC-22..24 |
| COC-045 | P0 | 033,035,044 | Admin dashboard: 4-eyes, Safe calldata, abuse reports, monitoring | UX-15/16, AC-23/30/33 |
| COC-046 | P0 | 040..045 | PL/EN copy, WCAG pass, mobile/Playwright critical flows | AC-31/32/35, all QA fixtures |
| COC-047 | P0 | 040..046 | **Visual QA and polish**: Taste + Design, live browser screenshots, two critique rounds, a11y | AC-36..43, 360/390/768/1280/1440, PL/EN, design evidence PASS |

### Epik E5 — End-to-end, pilot, release

| ID | P | Zależności | Zadanie i rezultat | Kryterium zakończenia |
|---|---|---|---|---|
| COC-050 | P0 | 016,031,047 | Test end-to-end Arbitrum Sepolia with actual Safe and mock/test USDC | smoke: org, campaign, approve, donate, NFT, report, reorg |
| COC-051 | P0 | 050 | Load tests, chaos indexer, restore backups, manual security checklist | AC-33/34, RPO/RTO test, incident drill |
| COC-052 | P0 | 051 | Security docs, deploy manifest, operations runbook, admin role approvals | 2-person review, no admin EOA, known risks documented |
| COC-060 | P0-GATE | 052 | Niezależny audyt smart kontraktów (zlecenie i triage) | audyt zewnętrzny; 0 unresolved critical/high |
| COC-061 | P0-GATE | 052 | Analiza regulacyjna, KYB/AML, dokumenty i obowiązki UE/PL | podpisana opinia prawna / gotowe procesy |
| COC-062 | P0-GATE | 060,061 | Go/no-go mainnet, Safe role verify, deploy i test ograniczony | wszystkie release gates, ręczna zgoda właściciela |

**Kolejność krytycznej ścieżki:** 001 -> 003 -> 003A -> 040 -> 047 -> 050 (gałąź UI); 001 -> 010 -> 011 -> 012 -> 013 -> 015 -> 016 -> 030 -> 031 -> 041 -> 050 -> 051 -> 052 -> (060 + 061) -> 062. Zespół może równolegle robić E2 i E4 po ustaleniu interfejsów.

## 2. Zasady estymacji i zależności

Szacunki czasu liczyć dopiero po repo i pierwszych dwóch PR. API, indexer, RLS i kontrakty mogą zajmować znacznie więcej czasu niż marketingowy landing page; nie wyznaczać startu produkcyjnego z harmonogramu developerskiego. W zadaniach bezpieczeństwa nie używać automatycznych auto-merge bez review.

## 3. Gotowe prompty do Claude Code

### Prompt A — inicjalizacja repo (użyć najpierw)

```text
Pracujesz nad CharOnChain. Najpierw przeczytaj README.md, CLAUDE.md,
docs/01-PRD.md, docs/02-SMART-CONTRACTS.md, docs/03-DATABASE-AND-API.md,
docs/04-UX-AND-ACCEPTANCE.md, docs/05-SECURITY-AND-QA.md,
docs/06-CLAUDE-CODE-BACKLOG.md, docs/08-DESIGN-SYSTEM-AND-SKILLS.md,
docs/09-VISUAL-QA-CHECKLIST.md oraz contracts/src/interfaces/ICharOnChain.sol.

Zrealizuj WYŁĄCZNIE COC-001 (monorepo, CI, env.example), zgodnie z DoD.
Nie implementuj logiki darowizn, nie deployuj na mainnet i nie dodawaj kluczy prywatnych.
Najpierw przedstaw plan zmienianych plików i zależności. Następnie zaimplementuj,
uruchom lint/typecheck/build/test i opisz wyniki oraz rzeczywiste ryzyka.
Jeżeli specyfikacja jest sprzeczna, wskaż dokładne miejsce i zaproponuj ADR,
bez jednostronnej zmiany przepływu pieniędzy.
```

### Prompt B — pojedyncze zadanie (szablon)

```text
Zrealizuj zadanie COC-[ID] z docs/06-CLAUDE-CODE-BACKLOG.md.
Przed kodowaniem przeczytaj powiązane sekcje PRD, smart contracts,
DB/API, UX acceptance, design skills/visual QA oraz security docs. Nie implementuj innych tasków.

1. Przedstaw plan, pliki i ryzyka.
2. Zaimplementuj minimalne, bezpieczne rozwiązanie spełniające specyfikację.
3. Dodaj testy pozytywne, negatywne i edge cases; nie używaj float dla USDC.
4. Uruchom testy, lint, typecheck, build (o ile dostępne).
5. Wyślij krótką listę zmian, AC-xx spełnionych, otwartych problemów,
   skutków dla API/DB/deploy i checklistę PR.
Nie deployuj na mainnet. Nie obchodź testów ani uprawnień.
```

### Prompt D — projektowanie UI z Taste + Design (uruchom przed COC-003, potem przy 040–047)

```text
W CharOnChain frontend quality jest twardą bramką. Przeczytaj CLAUDE.md,
docs/04-UX-AND-ACCEPTANCE.md, docs/08-DESIGN-SYSTEM-AND-SKILLS.md
i docs/09-VISUAL-QA-CHECKLIST.md.

Sprawdź w aktualnej sesji rzeczywistą dostępność obu skilli:
- design-taste-frontend (Taste Skill Leonxlnx)
- frontend-design (Anthropic)
Odczytaj ich SKILL.md i faktycznie zastosuj oba procesy.
Jeśli brakuje któregokolwiek, oznacz zadanie UI BLOCKED i podaj
procedurę instalacji; nie twierdź, że ich użyłeś.

Przed kodem przedstaw 3 odmienne art directions dla marki CharOnChain:
fonty, palety, layouty, obrazy, interakcje i argumentacja trust-first.
Zapisz decyzje w docs/DESIGN-DECISIONS.md.
Następnie przygotuj ocenialny preview home, campaign detail i checkout.
Nie implementuj pozostałych ekranów do czasu review tej trójki.
Po implementacji użyj realnej przeglądarki do screenshotów przy
360/390/768/1280/1440, PL/EN, loading/empty/error/success,
wykonaj minimum 2 rundy krytyki i poprawki oraz testy axe/Playwright.
Udokumentuj rzeczywiste wyniki AC-36..43, nie wymyślaj raportów.
Zachowaj wszystkie wymagania prawdziwości danych i bezpieczeństwa darowizn.
```

### Prompt C — audyt wewnętrzny przed zewnętrznym

```text
Przeanalizuj repo CharOnChain bez wykonywania operacji produkcyjnych.
Porównaj implementację z docs/02-SMART-CONTRACTS.md INV-01..INV-10,
docs/04-UX-AND-ACCEPTANCE.md AC-01..AC-35 i release gates.
Zidentyfikuj podatności i odchylenia: krytyczność, ścieżka, scenariusz,
impact, reprodukcja (bez realnych funduszy), proponowana poprawka i test regresji.
Uruchom Foundry unit/fuzz/invariant, testy RLS, indexer reorg/replay i SIWE.
Nie modyfikuj kodu, dopóki nie przedstawisz raportu audytu.
Wyraźnie zaznacz, że to NIE zastępuje niezależnego audytu.
```

## 4. Format raportowania postępów przez Claude Code

| ID | Status | PR/commit | Testy uruchomione | AC pass | Blockers | Next |
|---|---|---|---|---|---|---|
| COC-001 | TODO | — | — | — | — | COC-002 |

Statusy: `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `BLOCKED`, `DONE`. Żadnych deklaracji „DONE” bez uruchomienia testów i kontroli wymaganych kryteriów.
