import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ArtifactKind } from '@gpo/tax-receipts-core';
import type { Artifact, PrismaClient } from '../generated/prisma/index.js';

/**
 * Artifact byte storage (ticket 3.1). The schema's own comment on `Artifact`
 * says the bytes "live in object storage" and are retained >= 6 years, never
 * hard-deleted; this is a local-disk stand-in for that until an object
 * storage ticket lands. `Artifact.uri` is a storage-agnostic pointer (here, a
 * path relative to `storageDir`) so that swap needs no schema or caller
 * change — only this module's `write`/`read`.
 *
 * Content-addressed by sha256: re-storing identical bytes overwrites the
 * same path rather than growing without bound.
 */

export interface ArtifactStoreDeps {
  prisma: PrismaClient;
  storageDir: string;
}

export async function storeArtifact(
  deps: ArtifactStoreDeps,
  input: { kind: ArtifactKind; bytes: Buffer; extension: string },
): Promise<Artifact> {
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const relativePath = path.join(
    input.kind.toLowerCase(),
    `${sha256}.${input.extension}`,
  );
  const fullPath = path.join(deps.storageDir, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, input.bytes);

  return deps.prisma.artifact.create({
    data: {
      kind: input.kind,
      uri: relativePath,
      sha256,
      byteSize: input.bytes.length,
    },
  });
}
