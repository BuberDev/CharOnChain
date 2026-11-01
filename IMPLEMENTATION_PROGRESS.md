# IMPLEMENTATION_PROGRESS — CharOnChain

**Ostatnia aktualizacja:** 2026-11-01 · **Gałąź:** `claude/brave-lamport-s08wbe` (bazowana na `main` @ `1111f81`) · **Środowisko:** Arbitrum Sepolia/lokalnie. **Brak wdrożeń mainnet. Brak realnych środków. Aplikacja NIE jest gotowa do przyjmowania darowizn** (wymagane: audyt kontraktów, opinia prawna, bramki z `docs/05` §6).

## 1. Podsumowanie

| Faza | Stan |
|---|---|
| 1. Audyt dokumentacji | **Wykonany** — `docs/10-AUDIT-REPORT-PHASE1.md` (14 ustaleń DOC-01..14, mapa architektury i zależności) |
| 1b. Zmiana wymagań: AA = P0 | **Wykonane w dokumentacji:** `docs/11`, `docs/adr/ADR-007` (PROPOSED, bez danych pierwotnych dostawców), `docs/12` (propozycja), aktualizacje README/PRD/02/03/04/05/06/08/09/DECISIONS. Kontrakty bez zmian. **Implementacji AA jeszcze nie ma** (epik E6 czeka na ADR-007) |
| 2. Skille i design | `frontend-design` i **Taste zainstalowany za zgodą właściciela** (poza repo, `~/.claude/skills/`), oba `SKILL.md` przeczytane i **użyte**: kroki 1–4 (brief, inwentarz, kierunki), potem budowa, `lint.mjs`, `inspect.mjs` w przeglądarce, krytyka. Właściciel wybrał **kierunek B „Kwit”**. Dowody: `design-evidence/COC-003A/` (zrzuty 320/360/390/768/1280/1440, `review.md`, `a11y.md`, `design-brief.md`) |
| 3. Implementacja | COC-001, 002, 004, 010..015, 020..024, 030, 031, 034 (część TS) oraz COC-003/003A **IN_REVIEW** — lokalnie zweryfikowane; workflow CI **nie** był uruchomiony na GitHubie. Kontrakty działają na Hardhat 3/EDR (forge niedostępny). Indexer (rdzeń) i SIWE (rdzeń) istnieją, ale nie są podpięte do prawdziwego RPC ani do warstwy HTTP. Brak: API HTTP, pętli workera, produkcyjnego weryfikatora EIP-1271/6492, AA, wdrożenia na Sepolia |
| 4. Testy | Jednostkowe **323**, kontrakty Solidity **98** (unit, fuzz, invarianty), testy na łańcuchu w procesie **21** (wdrożenie + weryfikator podpisów), integracyjne na Postgresie 16 **221**, E2E Playwright **73**, axe **83** — wszystkie zielone (sekcja 3). Testy mutacyjne kontraktów (32/33) i SQL (46/47). Nie wykonano: `forge` (Foundry), CI na GitHubie, wdrożenie Sepolia, czytnik ekranu, audyt |

## 2. Status zadań

Statusy: `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `BLOCKED`, `DONE`. Brak `DONE` bez uruchomionych testów i spełnionych kryteriów; każde zadanie czeka na review właściciela (`START-HERE`).

| ID | Status | PR/commit | Testy uruchomione | AC pass | Blockers | Next |
|---|---|---|---|---|---|---|
| COC-001 | IN_REVIEW | `cc5a517` | `pnpm check` na świeżym klonie: exit 0 | „1 komenda, lint/tsc/build/test, brak sekretów” — lokalnie spełnione | CI GitHub niewykonany; job Foundry niezweryfikowany | review |
| COC-002 | IN_REVIEW | `2d47ef2` | 93 testy `packages/shared` (+ mutacje: 5 wstrzykniętych błędów, wszystkie wykryte) | **AC-16** (progi lig, XP), **AC-04** (limit i końcówka celu — lustro reguł; kontrakt jest źródłem prawdy), AC-10 (tylko natywne USDC) w warstwie TS | stała USDC z dokumentacji sprawdzona co do **formatu** (EIP-55) i zgodności z docs, **nie** zweryfikowana on-chain (brak dostępu do sieci) | review → COC-016 (manifest dla Sepolia) |
| COC-003 | IN_REVIEW | `9e490dd` (tokeny, komponenty, 4 ekrany) | tokeny i kontrast: skrypt; `lint.mjs` Taste 0 FAIL; `inspect.mjs` na finalnym buildzie (`design-evidence/COC-003A/review.md`); jednostkowe UI/web: kwoty, słowniki PL/EN, formatowanie; E2E Playwright; axe | **AC-36** PASS, **AC-37** PASS, **AC-41** PASS (DEMO, brak zdjęć/donorów/„verified”) | preview czeka na uwagi właściciela (AC-38); brak prawdziwych zdjęć (ADR-115) | uwagi właściciela → runda 4 krytyki |
| COC-003A | IN_REVIEW | `c9d7870` (zrzuty, skrypty) | zrzuty 320/360/390/768/1280/1440 PL oraz EN, stany, reduced-motion; `a11y.mjs`: **83 kontrole, 0 naruszeń**; E2E: **73 zielone**, 1 pominięty z założenia | **AC-39** PASS (renderowane), **AC-40** PASS automatycznie / ręczna niepełna (brak czytnika ekranu), AC-42 **PARTIAL** (brak zrzutów „przed”), **AC-43 niezbadane** (test z ≥ 5 osobami po stronie właściciela) | AC-38/42/43 → COC-047 nie może być DONE | uwagi właściciela; test z użytkownikami; czytnik ekranu |
| COC-004 | IN_REVIEW | `467bee3` | 44 testy jednostkowe + 13 integracyjnych na Postgresie 16 (mutacje: 3 wstrzyknięte błędy, wszystkie wykryte); CLI uruchomione ręcznie na świeżej bazie | „local migrations i rollback test przechodzą” — spełnione (zrzut katalogu przed/po zgodny) | **brak lokalnego stosu Supabase** (Docker niedostępny, brak konta/projektu); job CI `database` niewykonany na GitHubie | review → COC-020..022 |
| COC-010 | IN_REVIEW | `1001c85` | scaffold Hardhat 3 / EDR + forge-std v1.17.0 (commit pinned) + mock USDC/konto kontraktowe/token reentrancyjny; `foundry.toml` dla `forge` (**niewykonany lokalnie**) | „compile/fmt, testy uruchamialne” — kompilacja i testy tak; `forge fmt` nie uruchomiono | brak Foundry/solc natywnego (hosty zablokowane) — obejście: solc-js 0.8.28 + EDR; job CI `contracts-foundry` (continue-on-error) zweryfikuje `forge` | pierwszy zielony `forge test` w CI |
| COC-011 | IN_REVIEW | `1001c85` | 20 testów (unit + fuzz + INV-05 fuzz) | **AC-01..06** (część rejestru), **AC-30**, INV-05/08 | decyzje do potwierdzenia: metadane zamrożone po `CLOSED` | review |
| COC-012 | IN_REVIEW | `1001c85` | 23 testy + 8 invariantów (handler) + 6 AA | **AC-04..08, 12/15** (kontrakt), **AC-29**, INV-01..04, 06..10 | EVM cancun/PUSH0/MCOPY na Arbitrum niezweryfikowane | review |
| COC-013 | IN_REVIEW | `1001c85` | 21 testów (progi, claim, transfery, burn, zawieszenie, ERC-5192, konto kontraktowe) | **AC-16..21, 28**, INV-06 | `claim` dla zawieszonego portfela dozwolone (do potwierdzenia) | review |
| COC-014 | IN_REVIEW | `1001c85` | 18 testów (role rozdzielone, wersje, przejścia decyzji, hash SHA-256 z niezależnym Pythonem) | **AC-22..24** (warstwa kontraktu), INV-09 | `ImpactRegistry` wymaga istnienia kampanii (dodatek do spec) | review |
| COC-015 | IN_REVIEW (częściowo) | `1001c85`, `3a34ceb` | fuzz 256, invarianty 64×64, mutacje **32/33**, Slither 0.11.6 (ustalenia info/low, wyjaśnione), skan opcodów, tabela gazu: `packages/contracts/AUDIT-NOTES.md` | „0 unresolved test failures, raport gazu, lista ryzyk” — spełnione wewnętrznie | **długi przebieg fuzz/invariant**, test na prawdziwym EntryPoint/paymasterze, audyt zewnętrzny (COC-060) niewykonane | długi przebieg przed audytem |
| COC-016 | IN_REVIEW (część lokalna) | (ten commit) | 14 testów `deploy.chain.test.ts` (`pnpm test:chain`) na łańcuchu w procesie (EDR): wdrożenie 4 kontraktów, role, transfer admina do Safe (przed i po akceptacji, z przewinięciem czasu), pełny przepływ kampania→darowizna→claim SBT→pauza guardiana, odmowa mainnetu w CLI; mutacje 4/4 zabite | wdrożenie lokalne + weryfikacja stanu z łańcucha (nie z wyników transakcji), manifest zgodny z `parseManifest` | **wdrożenie na Sepolia niewykonane**: wymaga RPC, klucza wdrażającego z testnetowym ETH, adresów Safe i ról od właściciela; test „Safe 2-of-3” (DOC-12) i weryfikacja w eksploratorze oraz **potwierdzenie opcodów cancun na Arbitrum** czekają na pierwsze wdrożenie | właściciel: `deploy.sepolia.json` + `pnpm --filter @charonchain/contracts run deploy:sepolia` (domyślnie plan bez transakcji; `--execute` wysyła) |
| COC-021 | IN_REVIEW | `770cb0a` | 32 testy DB (`chain-projection.db.test.ts`) na Postgresie 16, w tym równość SQL↔TS dla progów lig; mutacje: 5 wstrzykniętych błędów, wszystkie wykryte | DOC-01 rozstrzygnięte jako `amount_raw > 0` (ADR-112); journal zdarzeń z historią reorgów, projekcja donacji/statystyk, RLS deny-by-default | brak indexera, który to zasila (COC-031); polityki RLS dla ról aplikacji w COC-023 | review |
| COC-020 | IN_REVIEW | `0db0435` | 39 testów DB (mutacje 11/12, ocalały = równoważny) | **AC-01** (publikacja dopiero po potwierdzonym evencie), **AC-02**, **AC-03**/INV-05, 4-eyes | brak | review |
| COC-022 | IN_REVIEW | `2fe345b` | 31 testów DB (mutacje 17/17; atomowe zużycie nonce testowane 10 klientami równolegle) | **AC-22/24** (baza), **AC-23**, **AC-26** (nonce/sesje, część DB) | polityka retencji plików prywatnych i zgłoszeń czeka na decyzję prawną (kolumna `retention_until` jest, usuwania nie ma) | review |
| COC-023 | IN_REVIEW | `659b1dd` | 33 testy negatywne RLS: gość, właściciel, menedżer, reporter, inny tenant, recenzent, admin, indexer, auth, anon/authenticated (mutacje 18/18) | **AC-25** (brak wycieku między tenantami, deny-by-default), **AC-30** (baza) | role `app_*` tworzone przez migrację wymagają `CREATEROLE`; Supabase: do potwierdzenia na prawdziwym projekcie (brak dostępu) | review |
| COC-024 | IN_REVIEW | `730bf11`, `1f9931f` | testy jednostkowe SIWE i sesji + 12 testów DB (`login.db.test.ts`) | **AC-26** (nonce 128 bit, SHA-256 w bazie, atomowe zużycie, TTL, domena/URI/chain, rotacja sesji) | weryfikator EIP-1271/6492 jest **wstrzykiwany** (fail-closed), implementacja produkcyjna to COC-073; brak warstwy HTTP/cookies (COC-032/033) | review → COC-032 |
| COC-025 | TODO | — | — | — | Storage wymaga projektu Supabase (nie tworzymy zdalnych zasobów) | — |
| COC-030, 031 | IN_REVIEW | (ten commit) | 20 testów DB (`indexer.db.test.ts`, fałszywy łańcuch z hashami, reorgi, zakodowane prawdziwym ABI) + test lustra ABI; mutacje 4/4 zabite (ponowne wejście w tym samym bloku, granica potwierdzeń, mapowanie statusu wpłaty, okno nakładania) | CLAUDE.md pkt 6 (suma w bazie = projekcja z journala, nigdy źródło prawdy), idempotencja, reorg w trakcie skanu, anomalie zamiast zgadywania, uzgadnianie z getterami (cursor → ERROR) | `createViemRpc` **niesprawdzony na prawdziwym węźle**; brak pętli workera/metryk (COC-035); ABI zdarzeń to lustro kontraktów (test pilnuje zgodności z artefaktem) | review → COC-032 |
| COC-034 | IN_REVIEW | `80b5038` | testy RFC 8785 (wektory z RFC, surogaty, kolejność kluczy UTF-16) | kanonizacja + `contentSha256` po stronie TS | część API (zapis raportu) czeka na COC-033 | review |
| COC-032 | IN_REVIEW (logika, bez tras HTTP) | `b20e869` + (ten commit) | 23 testy DB (`packages/api`) na roli `app_api` + 6 testów migracji 0006 (`public-views.db.test.ts`); mutacje 13/13 zabite po uzupełnieniach (8 API + 5 migracja) | publiczne odczyty z widoków whitelistowych, kwoty jako ciągi (także > 2^53), keyset bez duplikatów i luk, izolacja sieci, 404 nieodróżnialne, błędy bez SQL i wartości, RLS dla `organization_private`; **migracja 0006**: dowód transakcji (`txHash`, `logIndex`, `blockNumber`) w `public_donations` i `public_indexer_status`; **AC-33 (druga połowa)**: każda odpowiedź z sumami niesie `projection {state: OK/STALE/ERROR/UNAVAILABLE, final}` — sumy są oznaczane, nie ukrywane ani pokazywane jako pewne | **trasy Next.js nie są podpięte** (brak puli połączeń `app_api` i konfiguracji środowiska); brak rate limit i nagłówków bezpieczeństwa; `raisedRaw` to projekcja; UI musi użyć `projection.final` (CLAUDE.md pkt 12) | podpiąć w `apps/web` po decyzji o hostingu DB |
| COC-035 | IN_REVIEW (logika + proces, bez prawdziwego RPC/ujścia alarmów) | (ten commit) | 18 testów jednostkowych (ocena alarmów, metryki Prometheus, lustro ABI zdarzeń OZ, konfiguracja procesu) + 11 testów DB (`worker.db.test.ts`) na fałszywym łańcuchu; mutacje 9/10 zabite (ocalały = redundantny warunek `ORPHANED`, bo osierocone mają `canonical=false`) | **AC-33**: symulacja awarii RPC → alarmy WORKER_FAILURE/RPC_FAILURE bez wycieku sekretu z komunikatu błędu; niezgodność z getterami → RECONCILE_MISMATCH + status ERROR + alarm o statusie; zdarzenia bezpieczeństwa (role, transfer admina, pauza) w journalu i alarmach; deduplikacja; ponowna próba przy niedostępnym ujściu; backoff | proces `src/main.ts` (`pnpm --filter @charonchain/indexer run start`) **nie był uruchomiony** na prawdziwym węźle; ujście alarmów = stdout JSON (webhook/on-call: decyzja właściciela); druga połowa AC-33 („nie pokazuj niezweryfikowanych sum jako finalnych”) wymaga widoku statusu indexera dla API (migracja 0006) | wybór dostawcy alarmów, ADR-109 (liczba potwierdzeń) |
| COC-033 | TODO | — | — | — | API zapisu admin/org (CSRF, rate limit, audit) | — |
| COC-040..047 | BLOCKED | — | — | — | UI: wybór kierunku + 003A | — |
| COC-050..052 | TODO | — | — | — | zależności | — |
| COC-060..062 | TODO (P0-GATE) | — | — | — | audyt zewnętrzny, opinia prawna | — |
| COC-070 | BLOCKED | — | — | — | hosty dostawców zablokowane; konta testowe/klucze API od właściciela | weryfikacja M1–M9, spike |
| COC-071..078 | TODO | — | — | — | po 070 | — |
| COC-079 | TODO (dokument gotowy: `docs/12`) | — | — | — | implementacja niedozwolona bez ADR-111 | — |
| COC-063 | TODO (P0-GATE) | — | — | — | po 078 | — |

## 3. Wyniki testów

Wpisy wyłącznie z rzeczywistych uruchomień (2026-10-31).

| Zakres | Polecenie | Wynik |
|---|---|---|
| COC-001, świeży klon | `pnpm install --frozen-lockfile` + `pnpm check` | exit 0 |
| Całość (stan końcowy tej sesji) | `pnpm check` (format, ESLint 10 `strictTypeChecked` + Next, typecheck 6 pakietów, Vitest, build 2×Next.js + indexer + pakiety) | **exit 0** (powtórzone na świeżym klonie po push — patrz dziennik) |
| Jednostkowe (bez bazy) | `pnpm test` | **323/323**: repo-hygiene 8 · straże kontraktów 19 · shared: usdc, tiers, networks, manifest, canonical-json · database: migrations 29, target 15 · auth: siwe, session · indexer: abi · ui 10 · web: kwoty 34, słowniki PL/EN 34 |
| Integracyjne (prawdziwy Postgres 16.15, lokalny klaster) | `TEST_DATABASE_URL=… pnpm test:db` | **221/221**: runner 13 · COC-021 32 · COC-020 39 · COC-022 31 · COC-023 33 · auth/login 12 · indexer 20 · monitoring/worker 11 · api/public 23 · widoki publiczne i rollback 0006 6 (w tym SQL↔TS dla lig, rollback każdej migracji do stanu poprzedniej) |
| Testy mutacyjne (ręczne) | wstrzyknięcie błędów i weryfikacja czerwonych testów | shared: próg ligi, wyjątek końcówki celu, zaokrąglanie zamiast odrzucenia, „każdy token = natywne USDC”, brak reguły publisher≠reviewer — **wszystkie wykryte**; database: brak weryfikacji sum kontrolnych, brak blokady, niepełny `down.sql` — **wszystkie wykryte**. Pliki przywrócone identycznie |
| CLI (ręcznie, skompilowany) | `up`, `up` ponownie, `status`, `down`, `seed`; odmowy: local+zdalny host, production bez potwierdzenia, production `down` | działa; hasło nigdy w wyjściu (`***`) |
| Lint — sondy | wymuszone błędy (`any`, floating promise, hook warunkowy, `<img>` bez `alt`) | wykrywane |
| Kontrast WCAG | skrypt liczący względną luminancję dla par z 3 kierunków | wyniki w `docs/DESIGN-DECISIONS.md` §3; m.in. mięta `#53D5AE` na papierze `#F6F9FC` = **1,73:1 (FAIL)** |
| Kontrakty (Hardhat 3 / EDR, solc-js 0.8.28, forge-std v1.17.0) | `pnpm test:contracts` | **98/98**: rejestr 20 · router 23 · SBT 21 · impact 18 · AA 6 · invarianty 8 · opcody 2 (fuzz 256 przebiegów, invarianty 64×64) |
| Indexer: monitoring (COC-035) | `pnpm test` + `pnpm test:db` | 18 testów jednostkowych (`monitoring.test.ts`, `config.test.ts`) i 11 DB (`worker.db.test.ts`) |
| Łańcuch w procesie (EDR): skrypt wdrożenia COC-016 + weryfikator COC-073 | `pnpm test:chain` | **21/21**: wdrożenie 14 · weryfikator ERC-1271/6492 7 (buduje kontrakty) |
| Testy mutacyjne kontraktów | `node packages/contracts/scripts/mutation-test.mjs` | **32/33** zabite; ocalały S7 = martwa obrona w głąb (nieosiągalna) |
| Testy mutacyjne SQL (0003/0004/0005, ręczne) | wstrzyknięcie błędów w migracje | 11/12 + 17/17 + 18/18 zabite; ocalały = mutant równoważny (redundantny warunek) |
| Slither 0.11.6 | przez `scripts/solc-cli-shim.mjs` (offline) | tylko ustalenia informacyjne/niskie, wyjaśnione (`AUDIT-NOTES.md`) |
| Foundry (`forge fmt/build/test`, fuzz, invariant) | — | **NIE uruchomiono** — Foundry niedostępne; te same pliki `*.t.sol` przeszły w EDR; job CI `contracts-foundry` zweryfikuje `forge` |
| E2E Playwright (zbudowana aplikacja, Chromium) | `pnpm test:e2e` | **73 zielone, 1 pominięty z założenia** (menu mobilne tylko poniżej `lg`), projekty `desktop` 1440 i `mobile` 390: walidacja kwot zgodna z regułami kontraktu, stany checkoutu (sukces tylko po potwierdzeniu, porażki = środki bez zmian), przełącznik języka, 404, pusta zbiórka, odznaka, menu mobilne, reduced-motion, axe na 6 ekranach, brak poziomego przewijania na 10 ekranach, kolizja KPI |
| Dostępność (axe-core 4.14.0 + kontrole własne) | `node tools/visual-qa/a11y.mjs` | **83 kontrole, 0 naruszeń** (17 stron × 390/1440, stany, reduced-motion, reflow 320 px, odstępy tekstu WCAG 1.4.12; fokus, cele ≥ 24 px); szczegóły i **czego nie sprawdzono**: `design-evidence/COC-003A/a11y.md` |
| Visual QA (Chromium, zrzuty) | `tools/visual-qa/capture-all.sh` | 320/360/390/768/1280/1440 (PL), EN, stany, reduced-motion; **overflowX = 0 na wszystkich**; inspektor Taste i krytyka: `design-evidence/COC-003A/review.md` |
| Taste `lint.mjs` (statyczny) | `node …/lint.mjs apps/web/src apps/web/app packages/ui/src` | **0 FAIL, 1 WARN** (myślniki); gradienty to maski kształtu i są oznaczone `taste-skill-ignore` z uzasadnieniem |
| Testy mutacyjne UI/web (ręczne) | wstrzyknięcie błędów | `progressBasisPoints` (brak ograniczenia do 100%, zaokrąglanie w górę), podpowiedź kwoty, normalizacja przecinka — wszystkie wykryte; E2E wykrywa „6,579.5” w polu oraz kolizję KPI |
| CI na GitHubie | — | **NIE uruchomiono** (push na gałąź nie wyzwala workflow; wymaga PR lub push na `main`) |

## 4. Blokady i akcje po stronie właściciela

1. **Przegląd preview przez właściciela** (AC-38): kierunek B „Kwit” wybrany; do akceptacji: home, zbiórka, checkout, profil (`design-evidence/COC-003A/`, `docs/DESIGN-DECISIONS.md`). Uwagi odblokowują COC-040..047. Decyzje UI do podjęcia: ADR-114 (słownictwo Beginner w EN), ADR-115 (zdjęcia autentyczne i zgody), ADR-116 (obramowanie pola kwoty), a także logo i ostateczny dobór krojów/palety. **Test z ≥ 5 osobami spoza Web3 (AC-43/AC-63)** i test z czytnikiem ekranu wymagają Twojego udziału.
2. **Hosty do dopuszczenia** (Network access środowiska; zmiana może wymagać nowej sesji): `foundry.paradigm.xyz`, `github.com` (releases), `binaries.soliditylang.org`, `privy.io`, `docs.privy.io`, `thirdweb.com`, `portal.thirdweb.com`, `docs.pimlico.io`, `developers.circle.com`, `eips.ethereum.org`, `viem.sh`, `docs.arbitrum.io`, `docs.erc4337.io`. Stan na 2026-10-31: niedostępne (DNS/403). Bez nich: brak Foundry (COC-010+) i brak danych pierwotnych do ADR-007.
3. **Konta testowe u dostawców** (spike COC-070); klucze wyłącznie jako sekrety środowiska, nigdy w repo.
4. **Decyzje:** DOC-01 (ADR-112), DOC-05 (ADR-113), ADR-007/008/009/010, ADR-109, budżety paymastera, propozycje reguł 21–24 dla `CLAUDE.md` (`docs/10` §9), licencja repo, `CODEOWNERS`.
5. **Supabase:** lokalny stos wymaga Dockera, a projekt zdalny — Twojej decyzji i konta. Nie tworzyłem żadnych zasobów Supabase.
6. **Mainnet:** żadnych wdrożeń ani finansowania paymastera realnymi środkami bez Twojej wyraźnej zgody.

## 5. Odstępstwa od specyfikacji i decyzje implementacyjne

| Data | Decyzja | Uzasadnienie |
|---|---|---|
| 2026-10-31 | AA przeniesione z „poza MVP/P1” do P0 | polecenie właściciela |
| 2026-10-31 | Kontrakty SC-1.0 bez zmian | `docs/02` §9; zachowanie niezmienników |
| 2026-10-31 | `CLAUDE.md` i `donations.amount_raw` (DOC-01) **nie zmienione** | komponent finansowy / zasady repo — czeka na decyzję |
| 2026-10-31 | Untracked `.DS_Store`, `.vscode/settings.json`; dodany `.gitignore` | higiena repo (DOC-10) |
| 2026-10-31 | TypeScript **6.0.3**, nie 7.0.2 | `typescript-eslint` 8.72.1: peer `typescript <6.1.0`; `CLAUDE.md` pkt 4 |
| 2026-10-31 | ESLint **10.14.0** mimo ostrzeżeń peer wtyczek Next | reguły `react-hooks`, `@next/next`, `jsx-a11y/alt-text` zweryfikowane sondami; ryzyko: pozostałe reguły niesprawdzone — przy problemach zejść do ESLint 9 |
| 2026-10-31 | `contracts/` (spec) vs `packages/contracts` (implementacja) | DOC-14, odwracalne |
| 2026-10-31 | `apps/web` to preview UI na danych DEMO (bez backendu/logowania/AA); `apps/admin` nadal placeholder | COC-003/003A; nie wolno prezentować jako działającego produktu (README, baner DEMO na każdej stronie, `noindex`) |
| 2026-10-31 | Nowy pakiet **`packages/shared`** (poza listą z COC-001) | COC-002 wymaga wspólnej matematyki BigInt/lig/sieci dla aplikacji i indexera; nie pasuje do `ui` ani `database` |
| 2026-10-31 | Parser kwot USDC **odrzuca** nadmiarowe miejsca dziesiętne zamiast zaokrąglać; brak zer wiodących, przecinka, `.5`, `5.` | zaokrąglanie pieniędzy po cichu jest niedopuszczalne; normalizacja wejścia należy do UI |
| 2026-10-31 | Manifest: reguły `reportPublisher ≠ reviewer` (AC-23) i `guardian ≠ adminSafe` (`docs/02` §1) wymuszane w schemacie; rola nie może wskazywać kontraktu/tokenu | zgodne z `docs/02` §5; sekcja AA bez pól dostawcy (nie zgadujemy przed ADR-007) |
| 2026-10-31 | Mainnet jako domyślna sieć tylko przy `APP_ENV=production` | `CLAUDE.md` pkt 3 |
| 2026-10-31 | Migracje własnym runnerem (`NNNN_nazwa.up/down.sql`), nie Supabase CLI | potrzebny test rollbacku; format zostaje kompatybilny z ręcznym przeniesieniem do `supabase/migrations`. Decyzja odwracalna przy adopcji Supabase CLI |
| 2026-10-31 | Baza testowa: lokalny klaster Postgres 16 systemu (tylko `localhost`), rola `charonchain_test` z `CREATEDB`, bazy tymczasowe usuwane po testach | Docker niedostępny; URL i hasło poza repo |
| 2026-10-31 | Taste zainstalowany **globalnie** (`-g --copy`), nie w repo; telemetria instalacji wyłączona; historia losowań przekierowana do scratchpada | `docs/08` §1: nie kopiować cudzych skilli do repo |
| 2026-10-31 | Kierunek **B „Kwit”** (wybór właściciela); hero **bez zdjęcia** (slot „karta przycięta”) | brak zatwierdzonych materiałów; AC-41 i `CLAUDE.md` pkt 20; skutek: limit oceny „design ≤ 6,5” w `critique.md` (ADR-115) |
| 2026-10-31 | Sygnatura ruchu „drukowanie kwitu” (CSS, raz) zamiast „wolnego przenikania” | autoodtwarzanie wymagałoby kontrolki pauzy (WCAG 2.2.2); przy `prefers-reduced-motion` brak ruchu |
| 2026-10-31 | Pakiety konsumowane przez bundler (`shared`, `ui`, `apps/web`) używają importów względnych **bez rozszerzenia**; `database`/`indexer` (Node) zachowują `.js` | Turbopack (Next 16.4.3) nie mapuje `./x.js` → `./x.ts` w pakietach workspace |
| 2026-10-31 | Własna kontrola dostępności (`tools/visual-qa/a11y.mjs`) jako część repo, poza `pnpm check` | wymaga przeglądarki i działającego serwera; w CI osobny job `e2e` (axe w testach Playwright) |
| 2026-10-31 | Polskie słownictwo Beginner bez „gas/approve/seed/sieć” na ścieżce głównej (test jednostkowy); EN do przeglądu | `docs/04` zasada językowa; ADR-114 |
| 2026-10-31 | Pole kwoty ma obramowanie 2 px (`ink-soft`) mimo zasady „kształt zamiast ramek” | WCAG 1.4.11, granica 1,14:1 bez obramowania (ADR-116) |
| 2026-10-31 | Test bazy: role `anon`/`authenticated` tworzone lokalnie; `charonchain_test` jest ich członkiem | migracje 0002 warunkowo odbierają uprawnienia tym rolom (Supabase je ma, lokalny Postgres nie); bez ról test RLS byłby pusty |
| 2026-11-01 | Kontrakty testowane przez **Hardhat 3 / EDR** (te same `*.t.sol` co dla `forge`), kompilator **solc-js 0.8.28** z npm, `forge-std` v1.17.0 przypięty do commitu | `foundry.paradigm.xyz` i `binaries.soliditylang.org` zablokowane; `forge` uruchomi CI (`contracts-foundry`, na razie nieblokujący) |
| 2026-11-01 | EVM **cancun** | OpenZeppelin 5.6.1 używa `mcopy`; kompilator emituje MCOPY/PUSH0; **obsługa na Arbitrum niezweryfikowana** — pierwszy test Sepolia (COC-016) |
| 2026-11-01 | Doprecyzowania SC-1.0 (ADR-117 PROPOSED): metadane zamrożone po `CLOSED`; `ImpactRegistry` wymaga istniejącej kampanii; przejścia decyzji raportu; `claim` dozwolone dla zawieszonego portfela; błędy dodatkowe (`InvalidHash`, `InvalidStatusTransition`, `ReputationNotSuspended`, `ReportNotFound`, `ReasonRequired`, `RolesMustBeSeparate`) | spec nie rozstrzyga; wybrano wariant bezpieczniejszy/zgodny z zasadą najmniejszych uprawnień |
| 2026-11-01 | Zależność `forge-std` przypięta do pełnego commita GitHub (polityka „dokładne wersje” rozszerzona o `github:…#<sha40>`) | brak wersji npm zgodnej z Foundry |
| 2026-11-01 | Baza: `donations.campaign_id` NOT NULL + złożony FK do `campaigns`; guardy `SECURITY DEFINER`; role `app_api`/`app_indexer`/`app_auth` (NOLOGIN), tożsamość przez `set_config('app.wallet')`; `registry_number` poza widokiem publicznym | zasada „RLS nie może osłabić kontroli”; `docs/03` zostawia publiczność numeru rejestru „wg polityki” (do decyzji) |
| 2026-11-01 | Konwencja `chain_events.args` (klucze jak w ABI, liczby jako ciągi, adresy małymi literami) | wymagana przez wyzwalacze „publikacja tylko po potwierdzonym evencie”; musi ją zachować indexer (COC-030) |

## 6. Otwarte problemy i ryzyka

- **CI:** workflow nigdy nie wykonany na GitHubie; job `contracts` (Foundry) i `database` (usługa Postgres) niezweryfikowane tam. Akcje przypięte tagami (`@v4`, `@v1`), nie SHA — przypiąć SHA przed produkcją (łańcuch dostaw).
- **Repo:** brak `LICENSE`, `CODEOWNERS`. pnpm 10 zignorował skrypt budowania `unrs-resolver` (opcjonalny resolver wtyczki importów); lint działa.
- **Baza:** brak ról Supabase w migracjach (celowo); RLS i polityki dopiero w COC-023. Domeny `app.*` implementują konwencje `docs/03`; `donations.amount_raw` (DOC-01) pozostaje niezmienione do decyzji.
- **Stałe USDC:** adres natywnego USDC na Arbitrum One zgodny z README/PRD/docs/02/docs/07 i poprawny formatowo, ale **niepotwierdzony on-chain** w tej sesji; adresu testnetowego brak (zgodnie ze specyfikacją).
- **Design:** preview zbudowany i sprawdzony w przeglądarce, ale: (a) brak prawdziwych zdjęć i wideo (ADR-115) → limit oceny „design ≤ 6,5”; (b) układ ma powtarzalne dwukolumnowe sekcje i puste pola obok wysokich slipów przy 1440 px (P2, `review.md`); (c) pusta zbiórka ma wynik inspektora `few-pictures` (znany wyjątek); (d) brak zrzutów „przed” z rund 1–2 (AC-42 PARTIAL); (e) brak testu z czytnikiem ekranu i z użytkownikami; (f) CSS kwitu opiera się na maskach (`mask`), wymaga sprawdzenia w Safari/Firefox; (g) wersja EN nie jest przejrzana pod kątem słownictwa Beginner. Chrome w `inspect.mjs` bez `--no-sandbox` jako root → wrapper w `CHROME_PATH`.
- **AA:** ADR-007 bez danych pierwotnych; aktywacja EIP-7702 na Arbitrum niepotwierdzona; ścieżką główną ERC-4337.
- Pełna lista: `docs/10` §5–§6 (m.in. DOC-01, DOC-04, DOC-05, ryzyka AA-1..12 w `docs/05` §1a).

## 7. Dziennik zmian

- 2026-10-31 — audyt Fazy 1; dokumentacja AA (P0); ADR-007 (draft); propozycja on-ramp; higiena repo (`7fc2ace`).
- 2026-10-31 — COC-001: szkielet monorepo, CI, `.env.example`, testy higieny repo (`cc5a517`, `f590f48`).
- 2026-10-31 — COC-003 (krok 1): instalacja Taste, trzy kierunki, rejestr decyzji (`71688ac`).
- 2026-10-31 — COC-002: `packages/shared` (`2d47ef2`).
- 2026-10-31 — COC-004: `packages/database`, runner, baseline, testy na Postgresie (`467bee3`).
- 2026-10-31 — COC-021: journal zdarzeń, projekcje donacji i statystyk, kursory, RLS; 32 testy DB (`770cb0a`).
- 2026-10-31 — COC-003/003A: tokeny i komponenty UI, preview home/zbiórka/checkout/profil (PL/EN), testy jednostkowe i E2E, narzędzia visual QA i dostępności, dowody (`aececb7`, `9e490dd`, `19d2e96`, `c9d7870`). Podczas weryfikacji znalezione i naprawione: błąd podpowiedzi kwoty (cały limit zamiast minimum), błąd formatu wstawianej podpowiedzi („6,579.5”), nakładanie się kwoty KPI, łamanie „USDC”, niezgodność nazwy dostępnej z widocznym tekstem (2.5.3), brak kontrastu granicy pola (1.4.11), teksty PL niezgodne z zasadą językową `docs/04`.
- 2026-11-01 — COC-010..015: kontrakty SC-1.0 i 98 testów (unit/fuzz/invarianty), mutacje 32/33, Slither, notatki przedaudytowe (`1001c85`, `3a34ceb`).
- 2026-11-01 — COC-020, 022, 023: migracje 0003–0005, 103 nowe testy DB, mutacje SQL 46/47 (`0db0435`, `2fe345b`, `659b1dd`).
- 2026-11-01 — COC-024, 034: SIWE (EIP-4361), sesje z hashami, RFC 8785 + `contentSha256` (`730bf11`, `80b5038`, `1f9931f`).
- 2026-11-01 — COC-030/031: rdzeń indexera (journal idempotentny, okno nakładania > potwierdzenia, wykrywanie reorgów, projekcje, anomalie, uzgadnianie z getterami), 20 testów DB na fałszywym łańcuchu, mutacje 4/4. Przy okazji: błąd typowania `canonical-json.ts` (brak `default` w `switch`) wykryty dopiero pełnym `pnpm check` — poprawiony. Nie sprawdzono: prawdziwy węzeł RPC, pętla workera.
- 2026-11-01 — COC-016 (część lokalna): biblioteka wdrożenia (viem), weryfikacja stanu z łańcucha, CLI Sepolia domyślnie w trybie planu i odrzucające mainnet; 14 testów, mutacje 4/4. Sepolia: czeka na właściciela.
- 2026-11-01 — COC-032 (logika): `packages/api` — publiczne odczyty kampanii/wpłat/raportów/organizacji/darczyńców, kursory keyset, standard błędów; 16 testów DB, mutacje 8/8.
- 2026-11-01 — COC-035: zdarzenia bezpieczeństwa OZ w journalu, ocena alarmów, metryki Prometheus, pętla robocza z backoffem i deduplikacją, konfiguracja procesu bez wartości domyślnych dla parametrów bezpieczeństwa. Indexer buduje się teraz jak pozostałe pakiety (`tsc --noEmit`), uruchamiany przez `tsx` (workspace TS).
- 2026-11-01 — migracja 0006 (`public_donations` z dowodem transakcji, `public_indexer_status`), status projekcji w API (AC-33). `catalogSnapshot` w testach obejmuje teraz widoki i uprawnienia (wszystkie wcześniejsze testy rollbacku nadal przechodzą — rollback 0005 przywraca także widoki i granty).
- 2026-11-01 — COC-073 (weryfikator): `createContractSignatureVerifier` (ERC-1271/6492, allowlista sieci i fabryk, limity), mock konta/fabryki w testach kontraktów, wspólny łańcuch w procesie `@charonchain/contracts/testing`; `pnpm test:chain` zastępuje `test:deploy`.
