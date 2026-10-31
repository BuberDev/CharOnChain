# CharOnChain — specyfikacja MVP (v1.1 — design quality update)

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
10. [`CLAUDE.md`](CLAUDE.md) — stałe instrukcje dla Claude Code.
11. [`START-HERE-CLAUDE.md`](START-HERE-CLAUDE.md) — inicjalizacja oraz proces frontendowy.

## Jakość UI — wymaganie obowiązkowe

Żadne zadanie frontendowe nie może zostać uznane za ukończone bez realnego użycia **`design-taste-frontend` (Taste Skill)** i **`frontend-design` (Anthropic)**, przeglądu art direction, screenshotów przeglądarki i spełnienia **AC-36..43**. Szczegóły w `docs/08` i `docs/09`; jeśli skille lub browser są niedostępne, zadanie UI ma status `BLOCKED`, a nie fałszywe `DONE`.

## Decyzje zamknięte dla MVP

- **Sieć:** Arbitrum Sepolia (testy, chain ID 421614), Arbitrum One (produkcja, 42161).
- **Waluta darowizn:** wyłącznie **natywne USDC Circle** na danej sieci; na Arbitrum One `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`; **nie** USDC.e. Testnet: adres tokenu podawany konfiguracyjnie po weryfikacji, zero wymyślonych stałych adresów.
- **Przepływ:** w tej samej transakcji `transferFrom(darczyńca, Safe fundacji, kwota)`; kontrakt nie przechowuje darowizn; **0% obowiązkowej opłaty platformy**.
- **Kampanie:** wyłącznie zweryfikowane organizacje; limit kwotowy (`hard cap`), termin rozpoczęcia i zakończenia, odbiorca przypisany nieodwracalnie do kampanii.
- **Reputacja:** 1 USDC nominalnie = 10 XP (liczone od sumy, z zaokrągleniem w dół); poziomy wyznaczane ze skumulowanych kwalifikujących się wpłat on-chain. 6 lig, próg Diamond 100 000 USDC.
- **NFT:** opcjonalnie odbierany przez darczyńcę ERC-721 + ERC-5192 (Soulbound), jeden na portfel; brak tokena spekulacyjnego.
- **Raporty wpływu:** dokumenty publiczne + on-chain kotwiczenie skrótu i zdarzenie zatwierdzenia; brak twierdzenia, że blockchain dowodzi dostarczenia pomocy w świecie fizycznym.
- **Dane:** Supabase Postgres i Storage; IPFS wyłącznie do publicznych metadanych NFT / bezpiecznych publicznych materiałów.
- **Logowanie:** SIWE ERC-4361 (również EIP-1271 dla portfeli kontraktowych), opcjonalny anonimowy podgląd.
- **Zarządzanie:** multisig Safe 2-of-3 lub silniejszy dla ról administracyjnych; osobny guardian tylko do awaryjnego pauzowania.

## Zakres poza MVP

USDT0, ETH, WBTC, natywny BTC, fiat, escrow, DAO, marketplace NFT, smart accounts/gas sponsoring, automatyczne zwroty, matching, wielołańcuchowość, masowe otwieranie zbiórek przez osoby prywatne.

## Twarde stop-gates

**Nie wolno wdrażać realnych darowizn do mainnetu bez:** zewnętrznego przeglądu/audytu kontraktów, niezależnej oceny prawnej (w tym MiCA i lokalnych zasad zbiórek), polityk AML/sankcji, wdrożonej weryfikacji organizacji, ćwiczenia procedur awaryjnych oraz testu integracyjnego z realnym Safe i natywnym USDC.

## Referencje pierwotne

- [Arbitrum — chain IDs](https://docs.arbitrum.io/chain-info)
- [Circle — natywne USDC na Arbitrum](https://www.circle.com/blog/usdc-on-arbitrum-now-available)
- [EIP-5192 — Soulbound](https://eips.ethereum.org/EIPS/eip-5192)
- [EIP-4361 — SIWE](https://eips.ethereum.org/EIPS/eip-4361)
- [OpenZeppelin — access control](https://docs.openzeppelin.com/contracts/5.x/access-control)
- [OpenZeppelin — ERC-721](https://docs.openzeppelin.com/contracts/5.x/api/token/erc721)
- [ESMA — transfer services under MiCA](https://www.esma.europa.eu/document/guidelines-transfer-services-crypto-assets-under-mica)
