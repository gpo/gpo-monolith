import type { QomonContact } from '@gpo/qomon-client';

/**
 * `Contact.addresses` (mirror-sweep.ts) caches `[]` or a single-element
 * array wrapping the raw Qomon contact address object. This is the one
 * place that shape gets read back out — shared by receipt issuance (which
 * requires a complete one) and the contribution detail view (which just
 * shows whatever's on file).
 */
export function addressFrom(addresses: unknown): QomonContact['address'] | undefined {
  return Array.isArray(addresses) ? (addresses[0] as QomonContact['address']) : undefined;
}

export interface FormattedAddress {
  line1: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

/** Best-effort display formatting — does not require completeness the way
 *  issuance does (see `MissingAddressError` in receipts/issue.ts). */
export function formatAddress(addresses: unknown): FormattedAddress | null {
  const address = addressFrom(addresses);
  if (!address) return null;
  return {
    line1: [address.housenumber, address.street].filter(Boolean).join(' ').trim(),
    city: address.city ?? '',
    province: address.state ?? '',
    postalCode: address.postalcode ?? '',
    country: address.country ?? '',
  };
}
