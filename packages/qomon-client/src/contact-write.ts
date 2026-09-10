import type { QomonContact } from './types.js';

/**
 * Guarded contact-write wrapper (data-model §4, qomon-api-reference §6 gap 14).
 *
 * Qomon has three contact-write paths and two are hazardous for a money-linked
 * pipeline:
 *  - `POST /contacts/upsert` is asynchronous, returns no id, and DROPS records
 *    silently when a form reference is invalid ("errors will not be logged").
 *  - `PATCH /contacts/{id}` behaves as a full replace: any omitted field is
 *    cleared.
 *
 * This wrapper exposes only the safe operations: the synchronous create (which
 * yields an id in one round trip) and a field-complete replace that refuses to
 * run unless the caller supplied a whole object. The async upsert is not
 * reachable through it.
 */

export class IncompleteContactError extends Error {
  constructor(readonly missing: string[]) {
    super(
      `replaceContact needs a field-complete object (PATCH is a full replace); missing/blank: ${missing.join(', ')}`,
    );
    this.name = 'IncompleteContactError';
  }
}

export interface ContactWriteTransport {
  createContact(contact: QomonContact): Promise<QomonContact>;
  replaceContact(id: number, contact: QomonContact): Promise<QomonContact>;
  getContact(id: number): Promise<QomonContact>;
}

/** Fields we insist are present on a full replace so a PATCH cannot blank a
 *  donor's identity or address out from under an issued receipt. */
const REQUIRED_FOR_REPLACE: Array<keyof QomonContact> = [
  'firstname',
  'surname',
  'mail',
  'address',
];

export class GuardedContactWriter {
  constructor(private readonly transport: ContactWriteTransport) {}

  async createContact(contact: QomonContact): Promise<{ id: number }> {
    const created = await this.transport.createContact(stripId(contact));
    if (typeof created.id !== 'number') {
      throw new Error('Qomon contact create did not return an id');
    }
    return { id: created.id };
  }

  async replaceContact(
    id: number,
    contact: QomonContact,
  ): Promise<QomonContact> {
    const missing = REQUIRED_FOR_REPLACE.filter((k) => {
      const v = contact[k];
      return v === undefined || v === null || v === '';
    }).map(String);
    if (missing.length > 0) throw new IncompleteContactError(missing);
    return this.transport.replaceContact(id, { ...contact, id });
  }

  getContact(id: number): Promise<QomonContact> {
    return this.transport.getContact(id);
  }
}

function stripId(contact: QomonContact): QomonContact {
  const { id: _id, ...rest } = contact;
  void _id;
  return rest;
}
