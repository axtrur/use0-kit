import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { PackResource, PackSignature } from "./types.js";

function canonicalPackPayload(pack: PackResource): string {
  return JSON.stringify({
    id: pack.id,
    name: pack.name,
    version: pack.version,
    resources: [...pack.resources].sort()
  });
}

export function computePackDigest(pack: PackResource): string {
  return createHash("sha256").update(canonicalPackPayload(pack)).digest("hex");
}

export function signPack(pack: PackResource, keyId: string, secret: string): PackSignature {
  const digest = computePackDigest(pack);
  const value = createHmac("sha256", secret).update(digest).digest("hex");
  return {
    algorithm: "hmac-sha256",
    keyId,
    digest,
    value,
    signedAt: new Date().toISOString()
  };
}

export function verifyPackSignature(pack: PackResource, secret: string): boolean {
  if (!pack.signature || pack.signature.algorithm !== "hmac-sha256") {
    return false;
  }
  const actualDigest = computePackDigest(pack);
  if (actualDigest !== pack.signature.digest) {
    return false;
  }
  const expectedValue = createHmac("sha256", secret).update(actualDigest).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expectedValue, "hex"), Buffer.from(pack.signature.value, "hex"));
  } catch {
    return false;
  }
}

export function signerEnvVar(keyId: string): string {
  return `USE0_KIT_SIGNER_${keyId.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
}

export function lookupSignerSecret(keyId: string): string | undefined {
  return process.env[signerEnvVar(keyId)];
}
