# IMPLEMENTATION_PROGRESS — CharOnChain

**Ostatnia aktualizacja:** 2026-10-31 · **Gałąź:** `claude/brave-lamport-s08wbe` (bazowana na `main` @ `1111f81`) · **Środowisko:** Arbitrum Sepolia/lokalnie. **Brak wdrożeń mainnet. Brak realnych środków. Aplikacja NIE jest gotowa do przyjmowania darowizn** (wymagane: audyt kontraktów, opinia prawna, bramki z `docs/05` §6).

## 1. Podsumowanie

| Faza | Stan |
|---|---|
| 1. Audyt dokumentacji | **Wykonany** — `docs/10-AUDIT-REPORT-PHASE1.md` (14 ustaleń DOC-01..14, mapa architektury i zależności) |
| 1b. Zmiana wymagań: AA = P0 | **Wykonane w dokumentacji:** `docs/11`, `docs/adr/ADR-007` (PROPOSED, bez danych pierwotnych dostawców), `docs/12` (propozycja), aktualizacje README/PRD/02/03/04/05/06/08/09/DECISIONS. Kontrakty bez zmian. **Implementacji AA jeszcze nie ma** (epik E6 czeka na ADR-007) |
| 2. Skille i design | `frontend-design` i **Taste zainstalowany za zgodą właściciela** (poza repo, `~/.claude/skills/`), oba `SKILL.md` przeczytane; kroki 1–4 procedury Taste wykonane. Trzy kierunki wizualne zapisane w `docs/DESIGN-DECISIONS.md` — **oczekują na wybór właściciela**. Brak preview, screenshotów i inspekcji w przeglądarce (jeszcze nie wykonane) |
| 3. Implementacja | COC-001, COC-002, COC-004 **IN_REVIEW** (lokalnie zweryfikowane; workflow CI nie był jeszcze uruchomiony na GitHubie). Kontrakty zablokowane (brak Foundry) |
| 4. Testy | 145 testów jednostkowych + 13 integracyjnych na prawdziwym Postgresie 16 — wszystkie zielone (sekcja 3). Foundry/E2E/visual QA: nie uruchomiono |

## 2. Status zadań

Statusy: `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `BLOCKED`, `DONE`. Brak `DONE` bez uruchomionych testów i spełnionych kryteriów; każde zadanie czeka na review właściciela (`START-HERE`).

| ID | Status | PR/commit | Testy uruchomione | AC pass | Blockers | Next |
|---|---|---|---|---|---|---|
| COC-001 | IN_REVIEW | `cc5a517` | `pnpm check` na świeżym klonie: exit 0 | „1 komenda, lint/tsc/build/test, brak sekretów” — lokalnie spełnione | CI GitHub niewykonany; job Foundry niezweryfikowany | review |
| COC-002 | IN_REVIEW | `2d47ef2` | 93 testy `packages/shared` (+ mutacje: 5 wstrzykniętych błędów, wszystkie wykryte) | **AC-16** (progi lig, XP), **AC-04** (limit i końcówka celu — lustro reguł; kontrakt jest źródłem prawdy), AC-10 (tylko natywne USDC) w warstwie TS | stała USDC z dokumentacji sprawdzona co do **formatu** (EIP-55) i zgodności z docs, **nie** zweryfikowana on-chain (brak dostępu do sieci) | review → COC-016 (manifest dla Sepolia) |
| COC-003 | IN_PROGRESS | `71688ac` (decyzje) | kontrast WCAG par kolorów policzony skryptem; brak testów przeglądarkowych | AC-37 (3 warianty + rekomendacja przed implementacją): spełnione dokumentem; AC-36: Taste + frontend-design użyte w krokach 1–4 | **czeka na wybór kierunku przez właściciela**; kroki 6–10 Taste (build, inspekcja, krytyka screenshotów) niewykonane | wybór → tokeny → COC-003A (preview home/campaign/checkout + UX-19, UX-22) |
| COC-003A | BLOCKED | — | — | — | po wyborze kierunku | — |
| COC-004 | IN_REVIEW | `467bee3` | 44 testy jednostkowe + 13 integracyjnych na Postgresie 16 (mutacje: 3 wstrzyknięte błędy, wszystkie wykryte); CLI uruchomione ręcznie na świeżej bazie | „local migrations i rollback test przechodzą” — spełnione (zrzut katalogu przed/po zgodny) | **brak lokalnego stosu Supabase** (Docker niedostępny, brak konta/projektu); job CI `database` niewykonany na GitHubie | review → COC-020..022 |
| COC-010 | BLOCKED | — | — | — | brak Foundry/solc (hosty zablokowane) | — |
| COC-011..016 | TODO | — | — | — | po 010 | — |
| COC-020..025 | TODO | — | — | — | po 004 (gotowe do startu po review) | — |
| COC-030..035 | TODO | — | — | — | po 012/021 | — |
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
| Całość (stan po COC-004) | `pnpm check` (format, ESLint 10 `strictTypeChecked` + Next, typecheck 6 pakietów, Vitest, build 2×Next.js + indexer + pakiety) | **exit 0** |
| Jednostkowe (bez bazy) | `pnpm test` | **145/145**: repo-hygiene 8 · shared: usdc 46, tiers 12, networks 19, manifest 16 · database: migrations 29, target 15 |
| Integracyjne (prawdziwy Postgres 16.15, lokalny klaster) | `TEST_DATABASE_URL=… pnpm test:db` | **13/13**: up/status/idempotencja, up→down→up (zrzut katalogu), nieprawidłowe kroki, wykrycie zmiany migracji i brakujących plików, atomowość przy błędzie, równoległość (blokada doradcza), domeny `app.*`, wyzwalacz, lint RLS, seedy |
| Testy mutacyjne (ręczne) | wstrzyknięcie błędów i weryfikacja czerwonych testów | shared: próg ligi, wyjątek końcówki celu, zaokrąglanie zamiast odrzucenia, „każdy token = natywne USDC”, brak reguły publisher≠reviewer — **wszystkie wykryte**; database: brak weryfikacji sum kontrolnych, brak blokady, niepełny `down.sql` — **wszystkie wykryte**. Pliki przywrócone identycznie |
| CLI (ręcznie, skompilowany) | `up`, `up` ponownie, `status`, `down`, `seed`; odmowy: local+zdalny host, production bez potwierdzenia, production `down` | działa; hasło nigdy w wyjściu (`***`) |
| Lint — sondy | wymuszone błędy (`any`, floating promise, hook warunkowy, `<img>` bez `alt`) | wykrywane |
| Kontrast WCAG | skrypt liczący względną luminancję dla par z 3 kierunków | wyniki w `docs/DESIGN-DECISIONS.md` §3; m.in. mięta `#53D5AE` na papierze `#F6F9FC` = **1,73:1 (FAIL)** |
| Foundry (`forge fmt/build/test`, fuzz, invariant) | — | **NIE uruchomiono** — Foundry niedostępne w sesji |
| Playwright / axe / screenshoty 360–1440 | — | **NIE uruchomiono** — UI jeszcze nie zbudowane |
| CI na GitHubie | — | **NIE uruchomiono** (push na gałąź nie wyzwala workflow; wymaga PR lub push na `main`) |

## 4. Blokady i akcje po stronie właściciela

1. **Wybór kierunku wizualnego** (A „Raport roczny”, B „Kwit” — rekomendowany, C „Trzy dowody”) w `docs/DESIGN-DECISIONS.md`. Odblokowuje COC-003A i resztę UI.
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
| 2026-10-31 | Strony `apps/web`, `apps/admin` to placeholdery techniczne | UI czeka na wybór kierunku |
| 2026-10-31 | Nowy pakiet **`packages/shared`** (poza listą z COC-001) | COC-002 wymaga wspólnej matematyki BigInt/lig/sieci dla aplikacji i indexera; nie pasuje do `ui` ani `database` |
| 2026-10-31 | Parser kwot USDC **odrzuca** nadmiarowe miejsca dziesiętne zamiast zaokrąglać; brak zer wiodących, przecinka, `.5`, `5.` | zaokrąglanie pieniędzy po cichu jest niedopuszczalne; normalizacja wejścia należy do UI |
| 2026-10-31 | Manifest: reguły `reportPublisher ≠ reviewer` (AC-23) i `guardian ≠ adminSafe` (`docs/02` §1) wymuszane w schemacie; rola nie może wskazywać kontraktu/tokenu | zgodne z `docs/02` §5; sekcja AA bez pól dostawcy (nie zgadujemy przed ADR-007) |
| 2026-10-31 | Mainnet jako domyślna sieć tylko przy `APP_ENV=production` | `CLAUDE.md` pkt 3 |
| 2026-10-31 | Migracje własnym runnerem (`NNNN_nazwa.up/down.sql`), nie Supabase CLI | potrzebny test rollbacku; format zostaje kompatybilny z ręcznym przeniesieniem do `supabase/migrations`. Decyzja odwracalna przy adopcji Supabase CLI |
| 2026-10-31 | Baza testowa: lokalny klaster Postgres 16 systemu (tylko `localhost`), rola `charonchain_test` z `CREATEDB`, bazy tymczasowe usuwane po testach | Docker niedostępny; URL i hasło poza repo |
| 2026-10-31 | Taste zainstalowany **globalnie** (`-g --copy`), nie w repo; telemetria instalacji wyłączona; historia losowań przekierowana do scratchpada | `docs/08` §1: nie kopiować cudzych skilli do repo |

## 6. Otwarte problemy i ryzyka

- **CI:** workflow nigdy nie wykonany na GitHubie; job `contracts` (Foundry) i `database` (usługa Postgres) niezweryfikowane tam. Akcje przypięte tagami (`@v4`, `@v1`), nie SHA — przypiąć SHA przed produkcją (łańcuch dostaw).
- **Repo:** brak `LICENSE`, `CODEOWNERS`. pnpm 10 zignorował skrypt budowania `unrs-resolver` (opcjonalny resolver wtyczki importów); lint działa.
- **Baza:** brak ról Supabase w migracjach (celowo); RLS i polityki dopiero w COC-023. Domeny `app.*` implementują konwencje `docs/03`; `donations.amount_raw` (DOC-01) pozostaje niezmienione do decyzji.
- **Stałe USDC:** adres natywnego USDC na Arbitrum One zgodny z README/PRD/docs/02/docs/07 i poprawny formatowo, ale **niepotwierdzony on-chain** w tej sesji; adresu testnetowego brak (zgodnie ze specyfikacją).
- **Design:** żaden kierunek nie został zbudowany ani sprawdzony w przeglądarce. Switzer (kierunek A) ładowany z Fontshare — wymaga self-hostingu, licencji i sprawdzenia polskich znaków. Chrome w `inspect.mjs` bez `--no-sandbox` jako root → wrapper w `CHROME_PATH`.
- **AA:** ADR-007 bez danych pierwotnych; aktywacja EIP-7702 na Arbitrum niepotwierdzona; ścieżką główną ERC-4337.
- Pełna lista: `docs/10` §5–§6 (m.in. DOC-01, DOC-04, DOC-05, ryzyka AA-1..12 w `docs/05` §1a).

## 7. Dziennik zmian

- 2026-10-31 — audyt Fazy 1; dokumentacja AA (P0); ADR-007 (draft); propozycja on-ramp; higiena repo (`7fc2ace`).
- 2026-10-31 — COC-001: szkielet monorepo, CI, `.env.example`, testy higieny repo (`cc5a517`, `f590f48`).
- 2026-10-31 — COC-003 (krok 1): instalacja Taste, trzy kierunki, rejestr decyzji (`71688ac`).
- 2026-10-31 — COC-002: `packages/shared` (`2d47ef2`).
- 2026-10-31 — COC-004: `packages/database`, runner, baseline, testy na Postgresie (`467bee3`).
