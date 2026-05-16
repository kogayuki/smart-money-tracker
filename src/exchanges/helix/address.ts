import { getDefaultSubaccountId } from "@injectivelabs/sdk-ts";

/**
 * Convert an inj1... address to its default subaccount ID (nonce 0).
 * The Injective indexer streams filter by subaccountId, not raw address.
 */
export function injAddressToSubaccount(injAddress: string): string {
  return getDefaultSubaccountId(injAddress);
}
