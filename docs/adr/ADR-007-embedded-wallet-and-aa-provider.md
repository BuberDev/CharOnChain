# ADR-007 — Dostawca embedded wallets i infrastruktury Account Abstraction

**Status:** `PROPOSED — DRAFT` (2026-10-31). **Nie jest decyzją.** Wymaga: (1) weryfikacji kryteriów na źródłach pierwotnych, (2) spike'u na Arbitrum Sepolia (COC-070), (3) akceptacji właściciela.
**Powiązane:** `docs/11-ACCOUNT-ABSTRACTION.md` (§4 kryteria M1–M9), ADR-008/009/010/110.

## 1. Kontekst

AA, embedded wallets i sponsorowanie gasu są P0 (decyzja właściciela 2026-10-31). Kontrakty SC-1.0 pozostają bez zmian. Wybieramy gotowe, sprawdzone rozwiązanie — **bez własnego bundlera i bez własnej infrastruktury kluczy**.

## 2. Ograniczenie jakościowe tego dokumentu

Strony `privy.io`, `docs.privy.io`, `thirdweb.com`, `portal.thirdweb.com` oraz dokumentacje standardów były w tej sesji **niedostępne** (blokada sieci). Poniższe dane pochodzą z **wyników wyszukiwarki i agregatorów** i są oznaczone:

- **[S2]** — źródło wtórne (snippet wyszukiwarki/agregator), nieczytane w całości;
- **[?]** — brak danych, do weryfikacji;
- **[K]** — sprzeczne dane w różnych źródłach.

Nie podaję tabeli kosztów z liczbami ani oceny punktowej, ponieważ wejścia są sprzeczne lub brakuje ich — wynik byłby fałszywie precyzyjny.

## 3. Warianty

| | **A — modułowy** | **B — zintegrowany** | Poza porównaniem |
|---|---|---|---|
| Uwierzytelnianie + signer | Privy (embedded wallet) | thirdweb in-app wallet | Dynamic, Web3Auth, Turnkey, Openfort, Coinbase i inni — rozważyć tylko jeśli A i B nie spełnią bramek M1–M9 |
| Konto smart | standardowe, audytowane (np. Safe/Kernel — wybór w spike) | konto thirdweb (ERC-4337) | |
| Bundler + paymaster | niezależny dostawca (np. klasa Pimlico/Alchemy — wybór w spike) | hostowany przez thirdweb | |
| Klient w aplikacji | wagmi + viem (+ biblioteka AA) | SDK thirdweb v5 + adapter do wagmi/viem [?] | |

Użytkownik prosił o porównanie Privy i thirdweb; A i B to ich najbardziej realistyczne konfiguracje względem wymogu M3 (kontrola polityki sponsorowania).

## 4. Porównanie względem kryteriów

| Kryterium | A (Privy + niezależny bundler/paymaster) | B (thirdweb) |
|---|---|---|
| M1 Arbitrum One/Sepolia | [?] Privy wspiera łańcuchy EVM; Arbitrum One/Sepolia do potwierdzenia | [S2] w dokumentacji figuruje chain id 42161; Sepolia [?] |
| M2 ERC-4337, 1271/6492 | [S2] Smart accounts przez integracje zewnętrzne (bundler/paymaster konfigurowane); 6492 [?] | [S2] konta ERC-4337 wbudowane; 6492 [?] |
| M3 kontrola polityki | **mocna strona architektury:** standard ERC-7677 + nasz PDP przed podpisem; szczegóły u wybranego paymastera [?] | [S2] reguły sponsorowania; czy PDP widzi pełną operację i jest fail-closed (webhook/verifier) — [?] |
| M4 non-custodial, recovery, eksport | [?] model kluczy (TEE/sharding), eksport i odzyskiwanie do potwierdzenia | [S2] rozróżnienie „self-recovery” i „managed recovery”; eksport [?] |
| M5 Next.js + wagmi + viem | [?] istnieje oficjalna integracja z wagmi (do potwierdzenia) | [?] adapter/EIP-1193 do potwierdzenia |
| M6 bez kluczy sesyjnych | [?] | [?] |
| M7 logowanie G/A/e-mail/passkey | [?] szeroki zestaw metod (do potwierdzenia) | [?] |
| M8 bezpieczeństwo, RODO | [?] — po przejęciu przez Stripe (czerwiec 2025) [S2] zweryfikować warunki, DPA, rezydencję danych | [?] |
| M9 testnet | [?] | [?] |
| EIP-7702 (SHOULD) | [S2] podpisywanie autoryzacji i transakcje typu 4 wspierane | [S2] tryb EIP-7702 jako domyślny dla in-app wallets na łańcuchach go obsługujących; aktywność na Arbitrum [?] |
| Vendor lock-in | niższy: bundler/paymaster wymienne niezależnie od auth; signer/konto zależne od Privy | wyższy: jedna firma dla wallet+bundler+paymaster; wyjście wymaga migracji konta |
| Złożoność integracji | wyższa (więcej elementów) | niższa (jeden SDK) |
| Koszt | [K] progi MAU i ceny sprzeczne między źródłami (np. darmowy próg 499 vs 1000 MAU) | [K] stawki za aktywny portfel i próg darmowy sprzeczne (1000 vs 10 000) |

**Uwaga o EIP-7702 na Arbitrum:** wtórne źródło ([Etherspot](https://etherspot.io/blog/arbitrum-adds-native-eip-7702-fusaka-cell-proofs-cz-x-yzi-oracle-and-tethers-wdk/)) podaje natywne wsparcie od ArbOS 40; przegląd notatek wydań Nitro na GitHubie **nie potwierdził** aktywacji. Ścieżką główną jest ERC-4337 (ADR-010).

## 5. Model kosztów (do wypełnienia po weryfikacji)

```
Koszt miesięczny(MAU) = Opłata_wallet(MAU)             # dostawca embedded wallet  [K]
                      + Opłata_AA(ops)                  # bundler/paymaster, jeśli osobno  [?]
                      + Σ koszt_gazu_sponsorowanego     # rzeczywisty, zależny od aktywności
                      + infrastruktura PDP/indexer/RPC
koszt_gazu_sponsorowanego = N_ops × gaz_per_op × cena_gazu × kurs
N_ops = MAU_darczyńców × (darowizny/mies. + claim + deploy konta)
```

`gaz_per_op` mierzymy **sami** w benchmarku (COC-015/078) — nie zgadujemy. Scenariusze: 1 000 / 10 000 / 100 000 MAU; założenia konwersji (odsetek MAU dokonujący darowizny, liczba darowizn) muszą być jawne i zatwierdzone przez właściciela.

## 6. Hipoteza robocza i warunki

Ze względu na **M3** (polityka sponsorowania pod naszą kontrolą), **M4** (non-custodial z odzyskiwaniem bez zmiany adresu) i ryzyko **lock-in** wstępnie bardziej obiecująca jest architektura **modułowa (A)** za wewnętrznym interfejsem `WalletProvider` (`docs/11` §3), tak aby wymiana dostawcy nie dotykała kontraktów ani logiki produktu.

**To jest hipoteza, nie rekomendacja ostateczna.** Wariant **B** wygrywa, jeśli spike wykaże jednocześnie: (a) PDP/verifier po stronie CharOnChain z pełnym wglądem w operację i domyślnym odrzuceniem, (b) eksport i odzyskiwanie spełniające M4, (c) wyraźnie niższy koszt całkowity oraz akceptowalną przenośność.

## 7. Plan weryfikacji (COC-070)

1. Przeczytać źródła pierwotne dla M1–M9 i wypełnić tabelę §4 (hosty z `IMPLEMENTATION_PROGRESS.md`).
2. Spike na Arbitrum Sepolia dla A i B (właściciel zakłada konta testowe i klucze API; sekrety wyłącznie w env): rejestracja, konto, sponsorowana darowizna na mock USDC, odmowa operacji spoza allowlisty, odzyskanie konta, eksport, awaria dostawcy (AC-44..61).
3. Zmierzyć gaz/op i opóźnienia; policzyć koszt dla 3 scenariuszy.
4. Zebrać dowody bezpieczeństwa (M8), warunki RODO/DPA, status prawny (ADR-110).
5. Przedstawić właścicielowi tabelę z danymi pierwotnymi i rekomendację.

## 8. Konsekwencje

- Niezależnie od wyniku: `WalletProvider`, PDP i wszystkie niezmienniki INV-AA zostają. Zmienia się tylko adapter.
- Wynik wpływa na: manifest środowiska (COC-002), `packages/wallet` (COC-071), konfigurację sekretów, listę hostów egress, zakres audytu (COC-060/063).
- **Zasada konsekwencji dla UI:** dopóki ADR-007 nie jest zaakceptowany, ekrany Beginner są projektowane na `WalletProvider` (mocki), bez zależności od SDK dostawcy.

## 9. Odrzucone alternatywy

Własny bundler/paymaster/kontrakty kont/przechowywanie kluczy (zakaz właściciela); konto platformy „pool” (custody); relayer z podpisem darowizny (łamie atrybucję i INV-07); sponsorowanie bez PDP (łamie M3).
