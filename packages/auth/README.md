# @charonchain/auth

Uwierzytelnianie SIWE po stronie serwera (COC-024; część COC-073): `docs/03` §5, AC-26, AC-55. Pakiet **serwerowy** (używa `node:crypto` i `pg`) — nie importować w kodzie klienta.

- **Nonce:** 128 bitów, TTL 5 min, w bazie tylko SHA-256; zużycie **atomowe** funkcją SQL `app.consume_siwe_nonce` (10 równoległych prób → 1 sukces, testowane).
- **Wiadomość:** walidacja domeny (ścisła), URI z allowlisty, sieci z allowlisty, formatu nonce, czasu (issuedAt, expirationTime ≤ 10 min, tolerancja zegara 60 s), adresu EIP-55. Treść oświadczenia mówi wprost, że podpis nie jest zgodą na płatność.
- **Podpis:** najpierw tani ECDSA (EOA, bez sieci), potem wstrzykiwany `ContractSignatureVerifier` dla kont kontraktowych (EIP-1271 / ERC-6492, `eth_call` na sieci z wiadomości). Awaria RPC lub brak weryfikatora = odmowa (fail-closed). **Implementacja produkcyjnego weryfikatora (viem `verifyMessage` z allowlistą RPC, limitem czasu/gazu, allowlistą fabryk 6492) to COC-073 — niezrobiona; test z prawdziwym kontem 1271/6492 wymaga EDR/dostawcy AA.**
- **Kolejność logowania:** walidacja → podpis → zużycie nonce → sesja. Błędny podpis nie spala nonce.
- **Sesje:** token 256 bitów, w bazie tylko hash; cookie `HttpOnly; Secure; SameSite=Lax`; rotacja z wykrywaniem ponownego użycia starego tokenu; odwołanie; `app.session_wallet`.
- **Poza zakresem (do zrobienia w warstwie HTTP, COC-033):** rate limiting, CSRF, endpointy `/api/v1/auth/*`, ustawienie `app.wallet` w transakcjach żądań.
- Rola bazy dla tego kodu: `app_auth` (migracja 0005).
