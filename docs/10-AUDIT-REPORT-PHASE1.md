# Raport audytu Fazy 1 — CharOnChain

**Data:** 2026-10-31 · **Zakres:** pełny przegląd repozytorium (17 plików, stan `main` @ `1111f81`) · **Status:** raport wewnętrzny, **nie** zastępuje audytu niezależnego ani opinii prawnej.

> Konwencja: ustalenia `DOC-xx` dotyczą spójności specyfikacji. Zgodnie z `CLAUDE.md` pkt 1 sprzeczności w komponentach finansowych są **zgłaszane z propozycją**, a nie rozstrzygane jednostronnie. Propozycje trafiają do `docs/DECISIONS.md` jako `PROPOSED`.

## 0. Stan repozytorium

Repozytorium zawiera wyłącznie specyfikację. **Nie istnieje żaden kod:** brak kontraktów (jest tylko szkic `ICharOnChain.sol`), monorepo, migracji, CI, testów, `package.json`, `foundry.toml`. Wszystkie zadania backlogu mają stan `TODO`. Zmiana wymagań dotycząca Account Abstraction (AA) nie ma więc wpływu na „istniejącą implementację” — wpływa wyłącznie na specyfikację i plan (sekcja 6).

## 1. Inwentarz

| Plik | Rola | Uwagi |
|---|---|---|
| `README.md` | indeks, decyzje zamknięte, zakres, stop-gates | zawierał wykluczenie „smart accounts/gas sponsoring” (zmienione, p. 6) |
| `CLAUDE.md` | 20 stałych zasad pracy | źródło reguł BLOCKED dla UI (pkt 16–20) |
| `START-HERE-CLAUDE.md` | procedura startu | nakazuje: przegląd → sprzeczności → plan → **tylko COC-001** |
| `docs/01-PRD.md` | wizja, P0, ligi, journeys | `§5.C` zawierał „gas sponsoring poza MVP” |
| `docs/02-SMART-CONTRACTS.md` | semantyka SC-1.0, INV-01..10 | **zgodna z AA bez zmian** (p. 6.1) |
| `contracts/src/interfaces/ICharOnChain.sol` | normatywne ABI | bez zmian |
| `docs/03-DATABASE-AND-API.md` | schemat, RLS, API, SIWE, indexer | SIWE wymaga rozszerzenia o ERC-6492 |
| `docs/04-UX-AND-ACCEPTANCE.md` | 18 ekranów, AC-01..35 | checkout zakłada ETH i `approve` jako osobny krok |
| `docs/05-SECURITY-AND-QA.md` | threat model, testy, gates | brak zagrożeń specyficznych dla AA |
| `docs/06-CLAUDE-CODE-BACKLOG.md` | 38 zadań COC, prompty A–D | dodano epik E6 |
| `docs/07-REFERENCES.md` | referencje | brak standardów AA |
| `docs/08`, `docs/09` | design system, Visual QA, AC-36..43 | wymagają Taste + frontend-design |
| `docs/DECISIONS.md`, `docs/DESIGN-DECISIONS.md` | ADR-001..006, 101..109; szablon decyzji wizualnych | AA było na liście „P1” |
| `.DS_Store`, `.vscode/settings.json` | **śmieci** | usunięte z indeksu, dodano `.gitignore` |

## 2. Mapa architektury (po zmianie AA)

```
Użytkownik ── Beginner: Google/Apple/e-mail/passkey ──► dostawca embedded wallet (signer, recovery)
           └─ Advanced: MetaMask/Rabby/WalletConnect (wagmi) ─────────┐
                                                                      ▼
Next.js (App Router, TS strict, wagmi/viem) ──► UserOperation (ERC-4337) ──► bundler ──► EntryPoint
   │  SIWE (1271 + 6492) ► API ► sesja HttpOnly          ▲ paymaster data (ERC-7677)        │
   │                                                     │                                   ▼
   │                         Paymaster Policy Service (CharOnChain, fail-closed)   konto użytkownika
   │                              │ allowlist, budżety, limity, kill switch                   │
   │                              ▼                                                            ▼
   │                     Supabase Postgres (RLS)                       USDC.approve → DonationRouter.donate
   │                              ▲                                          │ safeTransferFrom
   └──────────────────────────────┤                                          ▼
            Indexer (viem): DonationReceived + UserOperationEvent   Safe organizacji (2-of-3+)
            reorgi, idempotencja (chain,tx,logIndex), rekoncyliacja  ← CampaignRegistry, ReputationSBT, ImpactRegistry
```

Źródła prawdy bez zmian: **łańcuch** dla kwot i reputacji, Postgres dla redakcji i procesu. Nowość: **ledger sponsorowania** (Postgres) jest księgą kosztów platformy, nie źródłem prawdy o darowiznach.

## 3. Mapa zależności zadań

```
E0: 001 ─► 002, 003 ─► 003A, 004
E1: 001,002 ─► 010 ─► 011 ─► 012 ─► 013 ─► 015 ─► 016        (014 po 011)
E2: 004 ─► 020,021,022 ─► 023 ─► 024 ─► 025
E3: 012,021 ─► 030 ─► 031 ─► 035;  032, 033, 034
E4: 003A,032 ─► 040 ─► 041 ─► 042..045 ─► 046 ─► 047
E5: 016,031,047 ─► 050 ─► 051 ─► 052 ─► 060 ‖ 061 ─► 062
E6 (NOWY, P0): 001,002 ─► 070 ─► 071 ─► 072 ‖ 073 ‖ 074 ─► 075 ‖ 076 ‖ 077 ─► 078 ─► 063 (gate)
```

**Ścieżka krytyczna (zaktualizowana):** `001 → 002 → 070 → 071 → 072 → 076 → 078 → 063 → (060+061) → 062` obok dotychczasowych gałęzi kontraktów i UI. Szczegóły: `docs/06`, epik E6.

## 4. Weryfikacja skilli i narzędzi (stan rzeczywisty tej sesji)

| Element | Stan | Konsekwencja |
|---|---|---|
| Skill `frontend-design` (Anthropic) | **dostępny** (`/mnt/skills/public/frontend-design`), `SKILL.md` przeczytany | można stosować |
| Skill `design-taste-frontend` (Taste) | **niedostępny** (brak w katalogu skilli i na dysku) | wg `CLAUDE.md` pkt 17 i `docs/08` §1.4: **zadania UI BLOCKED** do czasu instalacji za zgodą właściciela. Repo źródłowe jest osiągalne przez git |
| Node 22.23 / pnpm 10.28 / npm registry | dostępne | COC-001 możliwe |
| Chromium + Playwright | preinstalowane | visual QA możliwe po odblokowaniu UI |
| Foundry (`forge`, `anvil`), `solc` | **niedostępne** — hosty zablokowane polityką sieci (`foundry.paradigm.xyz`, `github.com/.../releases`, `binaries.soliditylang.org`) | COC-010+ (kontrakty) BLOCKED |
| Docker daemon | niedostępny | brak lokalnego Supabase przez CLI |
| Strony dostawców AA i standardów (`privy.io`, `thirdweb.com`, `eips.ethereum.org`, `viem.sh`, `docs.pimlico.io`, `docs.arbitrum.io`, …) | **niedostępne** (DNS/polityka) | ADR-007 oparty wyłącznie na źródłach wtórnych — oznaczone jako niezweryfikowane |

## 5. Sprzeczności, luki i ryzyka w specyfikacji

| ID | Waga | Gdzie | Ustalenie | Propozycja (nie wdrożona) |
|---|---|---|---|---|
| DOC-01 | **Wysoka** | `03` §2 `donations` vs `02` §2, PRD §5.B, AC-04 | `CHECK amount_raw >= 1000000` w projekcji **odrzuciłby** legalną końcówkę (0 < kwota < 1 USDC domykająca cap). Indexer nie zapisałby poprawnej darowizny, projekcja rozjechałaby się z łańcuchem | `amount_raw > 0`; minimum egzekwuje kontrakt; dodać fixture „dust finalizujący cap” do COC-021/030 |
| DOC-02 | **Wysoka** (krytyczna przy AA) | `03` §5, `README` | SIWE obsługuje EIP-1271, ale nie ERC-6492. Konto AA przed pierwszą operacją **nie jest wdrożone** — 1271 samo nie zweryfikuje podpisu | dodać ERC-6492 + allowlistę fabryk; rozwiązane w `docs/11` §8 |
| DOC-03 | Średnia | `04` UX-05 | `/donations/[txHash]` zakłada, że użytkownik zna hash tx. W AA zna `userOpHash`; jedna transakcja bundlera zawiera wiele operacji różnych użytkowników | trasa po `userOpHash` lub `txHash`, tabela `user_operations`; `docs/11` §9 |
| DOC-04 | Średnia | `03` §6, `README` | Bufor „12 bloków L2” przy blokach Arbitrum rzędu ułamka sekundy to **sekundy**, nie minuty. Etykieta „potwierdzone na Arbitrum” może sugerować więcej, niż daje bufor (*czas bloku i semantyka tagów `safe/finalized` do weryfikacji w dokumentacji Arbitrum*) | zamknąć ADR-109 przed COC-031; polityka czasowa + znacznik wejścia batcha do L1; UI bez słowa „finalne” |
| DOC-05 | Średnia | `02` §2 Router, PRD §4.3 | Wymóg, by beneficjent był Safe ≥2-of-3, jest **wyłącznie procesowy**; `createCampaign` przyjmie dowolny adres, także EOA | ADR: opcjonalna kontrola on-chain przy `createCampaign` (kod pod adresem, `getThreshold() >= 2`); zmiana dotyka przepływu pieniędzy → decyzja właściciela |
| DOC-06 | Średnia | `README`/PRD §5.C vs polecenie P0 | „gas sponsoring poza MVP”, `claim` „musi opłacić gas” — nieaktualne | zaktualizowane (p. 6) |
| DOC-07 | Średnia | `04` copy, AC-29 | „Sieć Arbitrum pobiera opłatę w ETH” i „opłata płacona przez darczyńcę” są **fałszywe** w trybie Beginner (opłatę pokrywa platforma) → sprzeczność z `CLAUDE.md` pkt 12–13 (prawdziwość komunikatów) | komunikaty zależne od trybu: AC-60 |
| DOC-08 | Średnia | `06` COC-003 | COC-003 zależy tylko od 001, ale jest niewykonalne bez Taste (BLOCKED). Brak jawnej zależności „zgoda właściciela na instalację skilla” | dodano warunek wstępny w backlogu |
| DOC-09 | Średnia | `CLAUDE.md` pkt 8 | „1 portfel = 1 tożsamość”. Dwa tryby i wiele metod logowania mogą dać **dwie tożsamości jednej osoby** (smart account vs MetaMask; Google vs e-mail) | ADR-009; wymaganie wobec dostawcy: łączenie metod logowania **bez zmiany adresu konta**; brak migracji reputacji (zgodnie z pkt 8) |
| DOC-10 | Niska | repo | `.DS_Store` w historii, brak `.gitignore`, `LICENSE`, `CODEOWNERS`; `.vscode` z ustawieniem rozszerzenia Wake | COC-001 |
| DOC-11 | Niska | `07` | Brak referencji do ERC-4337, 7677, 6492, 5792, EIP-7702 | dodane do `docs/11` §14 jako **niezweryfikowane** |
| DOC-12 | Niska | `06` COC-016 | Test „Safe 2-of-3 na Arbitrum Sepolia” zakłada dostępność infrastruktury Safe (UI/Transaction Service) na tej sieci — **niezweryfikowane** | sprawdzić przed COC-016; plan B: Safe kontraktowo bez UI |
| DOC-13 | Niska | całość | Luki specyfikacji: rate limiting (mechanizm), CSRF, biblioteka i18n, stack obserwowalności, feature flags, macierz env/sekretów, treści prawne | doprecyzować w COC-001/004/024 |

**Nie znaleziono** niezgodności matematycznych w ligach (AC-16 zgodne z tabelą PRD; `xp = raw/100000`), ani rozbieżności w zdarzeniach/ABI między `02` a `ICharOnChain.sol`.

## 6. Wpływ zmiany AA (P0) na specyfikację

### 6.1 Kontrakty — **brak wymaganych zmian**

- `donate` używa `safeTransferFrom(msg.sender, beneficiary, amount)`; `02` §2 wprost dopuszcza, że donor może być kontraktem. Konto ERC-4337 jest `msg.sender`, więc `DonationReceived.donor`, `totalDonatedRaw`, XP i `tokenId = uint160(wallet)` wiążą się z **adresem konta**.
- `claim()` używa `_mint` (nie `_safeMint`) „aby możliwe były smart contract wallets” — gotowe na konta AA.
- Zbicie `approve + donate` realizuje **konto** (batch), bez `permit` i bez zmiany routera; spełnia zakaz z `02` §7 (nie implementować własnego `permit`).
- INV-01..10 pozostają prawdziwe. Dodatkowo `docs/11` definiuje INV-AA-01..10 (warstwa poza kontraktami).
- **Odrzucone alternatywy** (łamałyby niezmienniki lub model zaufania): `donateFor(donor,…)`/relayer z podpisem (atrybucja i INV-07), auto-mint SBT w `donate` (ADR-004, „odznaka nie może blokować płatności”), nieskończone `approve` i klucze sesyjne, wspólne „konto platformy” (custody), paymaster sponsorujący dowolne operacje.
- Wymagane **nowe testy** Foundry: donor = konto ERC-4337 i deleg. EOA (EIP-7702, jeśli włączone), `claim` z konta kontraktowego, brak stałego allowance po batchu.

### 6.2 Macierz wpływu na dokumenty

| Dokument | Zmiana | Status |
|---|---|---|
| `README` | usunięto „smart accounts/gas sponsoring” z poza-MVP; dopisano tryby, SIWE+6492, indeks docs 10–12 | wykonano |
| `01-PRD` | v1.2: tryby, §5.F, journeys, metryki lejka rejestracji | wykonano |
| `02` | §9 analiza zgodności z AA (bez zmian semantyki SC-1.0) | wykonano |
| `03` | §9 rozszerzenia AA (tabele, API, indexer, SIWE) — **propozycja** | wykonano |
| `04` | §7: UX-19..24, AC-44..63, uwagi do AC-11/29 i copy | wykonano |
| `05` | §1a zagrożenia AA-1..12, nowe bramki, E2E | wykonano |
| `06` | epik E6 (COC-070..079, 063), zmiany w COC-002/010/015/024/030/031/041/042/050/052/060 | wykonano |
| `08`, `09` | nowe komponenty i ekrany w macierzy QA | wykonano |
| `DECISIONS` | AA z „P1” → P0; ADR-007..010, 110, 111 jako `PROPOSED` | wykonano |
| `CLAUDE.md` | **bez zmian** — propozycje reguł 21–24 do akceptacji właściciela (p. 9) | czeka |

### 6.3 Nowe powierzchnie ryzyka (wybór)

1. **Paymaster to nowy skarbiec platformy** (depozyt w EntryPoint) i nowa powierzchnia ataku (drenaż, grief, obejście allowlisty przez batch/nested calls/`delegatecall`, złośliwa fabryka kont).
2. **Sponsorowanie gasu obniża koszt farmienia XP** (gas był naturalnym tarciem) — wzmacnia wiersz „NFT farming/collusion” z `05` §1.
3. **Ślepe podpisywanie**: passkey podpisuje hash UserOperation; interfejs musi udowodnić, że hash odpowiada pokazanej kwocie i odbiorcy (AC-54).
4. **Przejęcie logowania społecznościowego = przejęcie konta** (dotyczy środków użytkownika i reputacji, nie środków w tranzycie).
5. **Dostawca embedded wallet jako przetwarzający dane / potencjalnie CASP** — wymaga analizy prawnej (ADR-110).

## 7. Plan realizacji MVP — kolejność

1. **Odblokowane teraz (bez zgód):** dokumentacja AA (zrobione), **COC-001** (monorepo, CI, env.example), COC-002 (konfiguracja sieci, BigInt/tier math, testy progów), COC-004 (Supabase lokalnie — o ile dostępny Postgres), warstwy TS bez Foundry.
2. **BLOCKED — wymaga Twojej akcji:**
   - Foundry/solc → COC-010..016 (kontrakty i testy Foundry, w tym fuzz/invariant).
   - Taste → COC-003/003A/040–047/075 (UI, trzy kierunki wizualne, screenshoty).
   - Hosty dostawców AA/standardów → weryfikacja ADR-007 (COC-070), potem COC-071+.
3. **Wymaga decyzji właściciela:** wybór kierunku wizualnego (po odblokowaniu UI), ADR-007 (dostawca), budżety i limity paymastera, ADR-105 (kto podpisuje Safe), kwestie prawne ADR-101..110.

## 8. Trzy kierunki wizualne

Zgodnie z `CLAUDE.md` pkt 16–18 i `docs/08` §3 propozycja trzech art directions jest częścią COC-003 (zadanie UI) i wymaga **realnego użycia obu skilli**. Ponieważ Taste jest niedostępny, **nie przedstawiam kierunków jako wyniku procesu z obiema metodami** — zadanie jest BLOCKED do czasu zgody na instalację. Po odblokowaniu: 3 kierunki → tokeny → preview home/campaign/checkout **plus ekrany Beginner (UX-19..24)** → Twój wybór → implementacja.

## 9. Decyzje i akcje po stronie właściciela

1. Zgoda na instalację skilla Taste (komenda w `IMPLEMENTATION_PROGRESS.md`).
2. Dopuszczenie hostów w ustawieniach środowiska (lista w `IMPLEMENTATION_PROGRESS.md`). Jeśli zmiana nie działa w tej sesji, może wymagać nowej sesji.
3. Rozstrzygnięcie propozycji DOC-01 i DOC-05 (komponenty finansowe) oraz ADR-109.
4. Akceptacja propozycji reguł dla `CLAUDE.md`:
   - **21.** Każda operacja przesuwająca środki użytkownika wymaga jawnej, świeżej autoryzacji; zakaz kluczy sesyjnych, stałych zgód (ERC-7715) i automatycznych podpisów.
   - **22.** Paymaster działa fail-closed i sponsoruje wyłącznie operacje z allowlisty `docs/11` §6; zmiany polityki wymagają review bezpieczeństwa.
   - **23.** Brak własnego bundlera, własnej infrastruktury kluczy i własnych kontraktów kont; wyłącznie audytowane implementacje.
   - **24.** Komunikaty o opłatach muszą odpowiadać trybowi (Beginner/Advanced) i nie obiecywać „darmowego” sponsorowania bezterminowo.
5. Brak wdrożeń na mainnet i brak finansowania paymastera realnymi środkami bez Twojej wyraźnej zgody (bramka COC-062/063).
