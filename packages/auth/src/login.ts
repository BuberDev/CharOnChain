/**
 * Pełny przepływ logowania (docs/03 §5): walidacja wiadomości → podpis → ATOMOWE zużycie nonce → sesja.
 * Kolejność ma znaczenie: tani, bezstanowy odrzut najpierw; nonce zużywany dopiero po poprawnym podpisie
 * (obcy nie spali cudzego nonce błędnym podpisem), ale przed utworzeniem sesji (replay nie da drugiej sesji).
 */
import type { ClientBase } from "pg";
import type { Hex } from "viem";

import { consumeNonce, createSession } from "./store";
import {
  hashNonce,
  validateSiweMessage,
  verifySiweSignature,
  type ContractSignatureVerifier,
  type SiweExpectations,
  type SiweFailure,
} from "./siwe";

export type LoginFailure = SiweFailure | "BAD_SIGNATURE" | "NONCE_INVALID";

export type LoginResult =
  | {
      readonly ok: true;
      readonly wallet: string;
      readonly chainId: number;
      readonly token: string;
      readonly expiresAt: Date;
    }
  | { readonly ok: false; readonly code: LoginFailure };

export async function login(
  db: ClientBase,
  input: { message: string; signature: Hex },
  expectations: SiweExpectations,
  contractVerifier?: ContractSignatureVerifier,
): Promise<LoginResult> {
  const validation = validateSiweMessage(input.message, expectations);
  if (!validation.ok) return { ok: false, code: validation.code };
  const { address, chainId, nonce, domain } = validation.message;

  const signatureOk = await verifySiweSignature({
    address,
    message: input.message,
    signature: input.signature,
    chainId,
    ...(contractVerifier === undefined ? {} : { contractVerifier }),
  });
  if (!signatureOk) return { ok: false, code: "BAD_SIGNATURE" };

  const consumed = await consumeNonce(db, {
    nonceHash: hashNonce(nonce),
    domain: domain ?? expectations.domain,
    chainId,
    wallet: address,
  });
  if (!consumed) return { ok: false, code: "NONCE_INVALID" };

  const session = await createSession(db, address);
  return {
    ok: true,
    wallet: address.toLowerCase(),
    chainId,
    token: session.token,
    expiresAt: session.expiresAt,
  };
}
