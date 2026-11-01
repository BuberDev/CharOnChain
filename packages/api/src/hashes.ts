/**
 * Hashe zapisywane on-chain przy tworzeniu kampanii.
 *
 * `orgHash` jest NIEZMIENNY po utworzeniu kampanii (INV-05), a docs/02 nie definiuje, z czego powstaje. Przyjmujemy
 * PROPOZYCJĘ (docs/DECISIONS.md, ADR-120, status PROPOSED): keccak256 z napisu `charonchain:org:v1:<uuid organizacji>`.
 * Nie zawiera danych osobowych ani nazwy prawnej, jest stabilny i niezależny od zmian nazwy. Do czasu decyzji
 * właściciela NIE używać na sieci publicznej.
 */
import { keccak256, toBytes, type Hex } from "viem";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function organizationHash(organizationId: string): Hex {
  const id = organizationId.toLowerCase();
  if (!UUID.test(id)) throw new TypeError("organizationId musi być UUID");
  return keccak256(toBytes(`charonchain:org:v1:${id}`));
}
