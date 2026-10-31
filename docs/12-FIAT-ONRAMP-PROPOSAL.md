# Propozycja: regulowany on-ramp fiat → krypto (PRZYSZŁOŚĆ — nie implementować)

**Status:** `PROPOSED` (2026-10-31), **tylko propozycja.** Zakaz implementacji, integracji kont u dostawców i wystawiania UI „Kup USDC” bez wyraźnej zgody właściciela i zakończonej analizy prawnej (ADR-111). W MVP przycisk jest ukryty za flagą i prowadzi do instrukcji ręcznego zasilenia (`docs/11` §7, F3).
**Cel:** osoba bez krypto kupuje USDC kartą/przelewem i dostaje je **bezpośrednio na swoje konto Beginner** w Arbitrum One, nie opuszczając aplikacji w sposób mylący.

## 1. Zasady nienaruszalne

1. **CharOnChain nie dotyka fiata ani środków użytkownika:** całość obsługuje licencjonowany podmiot trzeci (sprzedawca/pośrednik). Platforma nie jest stroną płatności i nie przechowuje kluczy (INV-AA-08).
2. **Adres docelowy** jest ustawiany przez nas i **zablokowany** w sesji u dostawcy (podpisany/niemodyfikowalny); użytkownik widzi go skróconego i porównywalnego.
3. **Tylko natywne USDC w Arbitrum One** (nie USDC.e, nie inne sieci). Testnet: brak on-ramp, wyłącznie faucet.
4. **Brak PII u nas:** KYC/AML wykonuje dostawca; my zapisujemy co najwyżej identyfikator zlecenia i status (minimalizacja danych, `docs/03` §8).
5. Darowizna pozostaje **osobną, świadomą akcją** — zakup nie uruchamia darowizny automatycznie.
6. Żadnych dark patterns; pełne ujawnienie kosztów dostawcy przed przekierowaniem; zakaz sugerowania, że CharOnChain pobiera lub gwarantuje ceny.

## 2. Warianty integracji

| | Opis | Obciążenie zgodnościowe | Ryzyko UX/bezpieczeństwa |
|---|---|---|---|
| **1. Przekierowanie / hostowany widget dostawcy (rekomendowany start)** | użytkownik przechodzi do strony dostawcy; wraca z potwierdzeniem | najniższe (dostawca = podmiot regulowany od A do Z) | phishing/spoofing przekierowań → podpisane URL, allowlista domen, CSP |
| 2. Osadzony SDK/iframe | zakup w ramach aplikacji | wyższe (nadal dostawca regulowany; więcej odpowiedzialności za UX i dane) | wycieki danych, nadużycia iframe |
| 3. Własny on-ramp / przyjmowanie fiata | — | **odrzucone** (wymaga licencji i custody) | — |

Kandydatów do oceny (**bez weryfikacji w tej sesji**, wyłącznie lista do sprawdzenia): dostawcy powiązani z wybranym ekosystemem wallet (np. rozwiązania Stripe, jeśli ADR-007 wybierze Privy — dostępność w PL/UE do potwierdzenia) oraz niezależni, regulowani dostawcy on-ramp. Wybór dopiero po ocenie kryteriów §3.

## 3. Kryteria wyboru dostawcy (do udokumentowania źródłami pierwotnymi)

- Status regulacyjny w UE/PL (licencja/rejestracja CASP lub równoważna; zakres usługi; **do potwierdzenia przez prawnika**).
- Pokrycie PL/UE; metody płatności (karta, SEPA, BLIK itp.); limity; czas realizacji.
- Dostarczanie **natywnego USDC na Arbitrum One** na wskazany adres (w tym adres kontraktowy/niewdrożony smart account — **krytyczne:** bezpieczne dla kont kontrfaktycznych).
- Przejrzyste opłaty i kurs przed zatwierdzeniem; polityka zwrotów/chargebacków.
- KYC/AML/sankcje po stronie dostawcy; DPA/RODO, rezydencja danych.
- Webhooki/statusy zleceń; możliwość zablokowania adresu docelowego; podpisane parametry.
- Historia incydentów, SLA, wsparcie dla użytkownika.

## 4. Projekt integracji (po zatwierdzeniu)

1. Ekran UX-21: przycisk „Kup USDC” (flaga `onramp_enabled`), komunikat o przejściu do zewnętrznego dostawcy i jego warunkach.
2. Backend tworzy **zlecenie** (`onramp_orders`: id, `account_lower`, `provider`, `status`, `provider_order_ref`, timestamps) i generuje podpisany URL z zablokowanym adresem/siecią/tokenem. Zapis tylko przez backend.
3. Webhook dostawcy (weryfikacja podpisu, idempotencja po `provider_order_ref`) aktualizuje status; **saldo pokazujemy z łańcucha**, nie z webhooka.
4. Po wpłacie UX-21 pokazuje stan z indexera; następny krok to dotychczasowa darowizna (F4).
5. Błędy: nieudana płatność, KYC odrzucone, opóźnienie, zły token/sieć u dostawcy — komunikaty „co zrobić teraz”, kontakt do dostawcy.

## 5. Kryteria akceptacji (przyszłe)

- **AC-OR-01:** adres, sieć i token w sesji dostawcy są niezmienialne i zgodne z kontem użytkownika.
- **AC-OR-02:** zlecenie nie wpływa na XP/SBT; XP powstaje wyłącznie z `DonationReceived`.
- **AC-OR-03:** powtórny webhook nie duplikuje zlecenia ani nie zmienia salda.
- **AC-OR-04:** brak PII dostawcy w bazie i logach CharOnChain.
- **AC-OR-05:** użytkownik widzi opłaty dostawcy i warunki przed przekierowaniem; brak „za darmo”.
- **AC-OR-06:** niedostępność dostawcy nie blokuje darowizn z już posiadanych środków.
- **AC-OR-07:** domena przekierowania ∈ allowlista; podmiana parametrów wykrywana i odrzucana.

## 6. Bramki przed jakąkolwiek implementacją

1. Opinia prawna (MiCA/CASP, AML, ochrona konsumentów, RODO) — ADR-111.
2. Wybór dostawcy na podstawie danych pierwotnych i umowa (DPA).
3. Zatwierdzenie właściciela (budżet, zakres krajów).
4. Model zagrożeń rozszerzony o on-ramp (phishing, podmiana adresu, dostawca jako pojedynczy punkt awarii).

## 7. Zależności i szacunek

Zależy od ADR-007 (dostawca wallet), COC-071/075, COC-074 (indexer). Wysiłek implementacyjny wariantu 1: mały-średni; **koszt dominujący to analiza prawna i onboarding dostawcy**, nie kod.
