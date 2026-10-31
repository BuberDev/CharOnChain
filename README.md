# CharOnChain — specyfikacja MVP (v1.2 — Account Abstraction jako P0)

**Status:** projekt do implementacji i przeglądu; **nie** jest audytem bezpieczeństwa ani opinią prawną.  
**Data:** 2026-10-31  
**Produkt:** CharOnChain (`charonchain.com` — nazwa/domena do formalnej weryfikacji).  
**Cel:** non-custodial platforma darowizn USDC na Arbitrum One z reputacją darczyńców, niewymienialnymi odznakami oraz raportami wpływu.

## Kolejność lektury

1. [`docs/01-PRD.md`](docs/01-PRD.md) — cele biznesowe, zakres, zasady i metryki.
2. [`docs/02-SMART-CONTRACTS.md`](docs/02-SMART-CONTRACTS.md) — dokładna semantyka kontraktów, ABI, stany, uprawnienia i niezmienniki.
3. [`contracts/src/interfaces/ICharOnChain.sol`](contracts/src/interfaces/ICharOnChain.sol) — źródłowy szkic interfejsów Solidity (specyfikacja, nie implementacja).
4. [`docs/03-DATABASE-AND-API.md`](docs/03-DATABASE-AND-API.md) — Postgres, RLS, indeksator, SIWE, HTTP API i storage.
5. [`docs/04-UX-AND-ACCEPTANCE.md`](docs/04-UX-AND-ACCEPTANCE.md) — ekrany, przepływy, acceptance criteria.
6. [`docs/05-SECURITY-AND-QA.md`](docs/05-SECURITY-AND-QA.md) — model zagrożeń, testy, audyt, bramki produkcyjne.
7. [`docs/06-CLAUDE-CODE-BACKLOG.md`](docs/06-CLAUDE-CODE-BACKLOG.md) — epiki, zadania, zależności, prompty.
8. [`docs/08-DESIGN-SYSTEM-AND-SKILLS.md`](docs/08-DESIGN-SYSTEM-AND-SKILLS.md) — obowiązkowe skille Taste + Design, art direction, komponenty i proces UI.
9. [`docs/09-VISUAL-QA-CHECKLIST.md`](docs/09-VISUAL-QA-CHECKLIST.md) — wizualne testy, screenshoty, AC-36..43 i blokady jakości.
10. [`docs/10-AUDIT-REPORT-PHASE1.md`](docs/10-AUDIT-REPORT-PHASE1.md) — audyt specyfikacji, sprzeczności, mapa zależności, wpływ zmiany AA.
11. [`docs/11-ACCOUNT-ABSTRACTION.md`](docs/11-ACCOUNT-ABSTRACTION.md) — **P0:** tryby Beginner/Advanced, embedded wallets, paymaster, INV-AA, AC-44..63.
12. [`docs/adr/ADR-007-embedded-wallet-and-aa-provider.md`](docs/adr/ADR-007-embedded-wallet-and-aa-provider.md) — porównanie Privy/thirdweb (`PROPOSED`, wymaga weryfikacji i spike'u).
13. [`docs/12-FIAT-ONRAMP-PROPOSAL.md`](docs/12-FIAT-ONRAMP-PROPOSAL.md) — regulowany on-ramp fiat (**wyłącznie propozycja, bez implementacji**).
14. [`CLAUDE.md`](CLAUDE.md) — stałe instrukcje dla Claude Code.
15. [`START-HERE-CLAUDE.md`](START-HERE-CLAUDE.md) — inicjalizacja oraz proces frontendowy.
16. [`IMPLEMENTATION_PROGRESS.md`](IMPLEMENTATION_PROGRESS.md) — status zadań, wyniki testów, blokady, otwarte problemy.

## Jakość UI — wymaganie obowiązkowe

Żadne zadanie frontendowe nie może zostać uznane za ukończone bez realnego użycia **`design-taste-frontend` (Taste Skill)** i **`frontend-design` (Anthropic)**, przeglądu art direction, screenshotów przeglądarki i spełnienia **AC-36..43**. Szczegóły w `docs/08` i `docs/09`; jeśli skille lub browser są niedostępne, zadanie UI ma status `BLOCKED`, a nie fałszywe `DONE`.

## Decyzje zamknięte dla MVP

- **Sieć:** Arbitrum Sepolia (testy, chain ID 421614), Arbitrum One (produkcja, 42161).
- **Waluta darowizn:** wyłącznie **natywne USDC Circle** na danej sieci; na Arbitrum One `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`; **nie** USDC.e. Testnet: adres tokenu podawany konfiguracyjnie po weryfikacji, zero wymyślonych stałych adresów.
- **Przepływ:** w tej samej transakcji `transferFrom(darczyńca, Safe fundacji, kwota)`; kontrakt nie przechowuje darowizn; **0% obowiązkowej opłaty platformy**. W trybie Beginner „darczyńcą” jest adres smart accounta (operacja ERC-4337); kontrakty bez zmian.
- **Dostępność (P0, od v1.2):** dwa tryby — **Beginner** (domyślny: logowanie Google/Apple/e-mail/passkey, automatyczny portfel embedded, smart account, sponsorowanie gasu przez Paymaster, `approve`+`donate` jako jedna autoryzacja) i **Advanced** (MetaMask, Rabby, WalletConnect, pełna kontrola). Szczegóły, niezmienniki i polityka sponsorowania: `docs/11`. Dostawca: ADR-007 (`PROPOSED`).
- **Kampanie:** wyłącznie zweryfikowane organizacje; limit kwotowy (`hard cap`), termin rozpoczęcia i zakończenia, odbiorca przypisany nieodwracalnie do kampanii.
- **Reputacja:** 1 USDC nominalnie = 10 XP (liczone od sumy, z zaokrągleniem w dół); poziomy wyznaczane ze skumulowanych kwalifikujących się wpłat on-chain. 6 lig, próg Diamond 100 000 USDC.
- **NFT:** opcjonalnie odbierany przez darczyńcę ERC-721 + ERC-5192 (Soulbound), jeden na portfel; brak tokena spekulacyjnego.
- **Raporty wpływu:** dokumenty publiczne + on-chain kotwiczenie skrótu i zdarzenie zatwierdzenia; brak twierdzenia, że blockchain dowodzi dostarczenia pomocy w świecie fizycznym.
- **Dane:** Supabase Postgres i Storage; IPFS wyłącznie do publicznych metadanych NFT / bezpiecznych publicznych materiałów.
- **Logowanie:** SIWE ERC-4361 (również EIP-1271 oraz **ERC-6492** dla smart accountów jeszcze niewdrożonych), opcjonalny anonimowy podgląd.
- **Zarządzanie:** multisig Safe 2-of-3 lub silniejszy dla ról administracyjnych; osobny guardian tylko do awaryjnego pauzowania.

## Zakres poza MVP

USDT0, ETH, WBTC, natywny BTC, fiat (w tym on-ramp — wyłącznie propozycja `docs/12`), escrow, DAO, marketplace NFT, automatyczne zwroty, matching, wielołańcuchowość, masowe otwieranie zbiórek przez osoby prywatne, klucze sesyjne/płatności cykliczne, własny bundler lub infrastruktura kluczy, łączenie portfeli i migracja reputacji.

> **Zmiana v1.2:** „smart accounts/gas sponsoring” **opuściły** listę poza-MVP — są P0 (decyzja właściciela 2026-10-31).

## Twarde stop-gates

**Nie wolno wdrażać realnych darowizn do mainnetu bez:** zewnętrznego przeglądu/audytu kontraktów, niezależnej oceny prawnej (w tym MiCA i lokalnych zasad zbiórek), polityk AML/sankcji, wdrożonej weryfikacji organizacji, ćwiczenia procedur awaryjnych oraz testu integracyjnego z realnym Safe i natywnym USDC.

## Uruchomienie lokalne (COC-001)

Wymagania: Node 22 (`.nvmrc`), pnpm 10 (`corepack enable`). Foundry jest potrzebne dopiero od COC-010.

```bash
pnpm install
```

```bash
pnpm check
```

`pnpm check` uruchamia: format, lint, typecheck, testy (Vitest) i build. Kontrakty: `pnpm check:contracts` (wymaga Foundry). Skopiuj `.env.example` do `.env.local`; nie wpisuj kluczy prywatnych, a sekrety trzymaj poza repozytorium. Aplikacje w `apps/` to na razie placeholdery techniczne — nie przyjmują darowizn.

## Referencje pierwotne

- [Arbitrum — chain IDs](https://docs.arbitrum.io/chain-info)
- [Circle — natywne USDC na Arbitrum](https://www.circle.com/blog/usdc-on-arbitrum-now-available)
- [EIP-5192 — Soulbound](https://eips.ethereum.org/EIPS/eip-5192)
- [EIP-4361 — SIWE](https://eips.ethereum.org/EIPS/eip-4361)
- [OpenZeppelin — access control](https://docs.openzeppelin.com/contracts/5.x/access-control)
- [OpenZeppelin — ERC-721](https://docs.openzeppelin.com/contracts/5.x/api/token/erc721)
- [ESMA — transfer services under MiCA](https://www.esma.europa.eu/document/guidelines-transfer-services-crypto-assets-under-mica)
