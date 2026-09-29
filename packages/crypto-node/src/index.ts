import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";

import type {
  ContentDigest,
  CryptoProvider,
  CryptoSignature,
  KeyMetadata,
  SigningKeyRef,
  VerificationKey,
} from "@climatechain/core";

const ED25519 = "Ed25519" as const;

interface StoredKey {
  metadata: KeyMetadata;
  publicKeyObject: KeyObject;
  privateKeyObject?: KeyObject;
}

export interface GenerateEd25519KeyOptions {
  keyId: string;
  controller: string;
  createdAt: string;
  validFrom?: string;
}

export interface GeneratedKeyPair {
  signingKey: SigningKeyRef;
  verificationKey: VerificationKey;
}

function cloneMetadata(metadata: KeyMetadata): KeyMetadata {
  return {
    ...metadata,
    verificationKey: { ...metadata.verificationKey },
  };
}

function signingRef(keyId: string): SigningKeyRef {
  return {
    keyId,
    suite: "classical",
    algorithm: ED25519,
  };
}

export class InMemoryNodeCryptoProvider implements CryptoProvider {
  private readonly keys = new Map<string, StoredKey>();

  async hash(
    data: Uint8Array,
    algorithm: "SHA-256",
  ): Promise<ContentDigest> {
    if (algorithm !== "SHA-256") {
      throw new Error("Unsupported hash algorithm: " + algorithm);
    }

    return {
      algorithm,
      value: createHash("sha256").update(data).digest("base64url"),
    };
  }

  generateEd25519Key(
    options: GenerateEd25519KeyOptions,
  ): GeneratedKeyPair {
    if (this.keys.has(options.keyId)) {
      throw new Error("Key already exists: " + options.keyId);
    }

    const pair = generateKeyPairSync("ed25519");
    const encoded = pair.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64url");

    const verificationKey: VerificationKey = {
      keyId: options.keyId,
      suite: "classical",
      algorithm: ED25519,
      encoding: "spki-der-base64url",
      publicKey: encoded,
    };

    const metadata: KeyMetadata = {
      keyId: options.keyId,
      suite: "classical",
      algorithm: ED25519,
      controller: options.controller,
      createdAt: options.createdAt,
      validFrom: options.validFrom ?? options.createdAt,
      verificationKey,
    };

    this.keys.set(options.keyId, {
      metadata,
      publicKeyObject: pair.publicKey,
      privateKeyObject: pair.privateKey,
    });

    return {
      signingKey: signingRef(options.keyId),
      verificationKey: { ...verificationKey },
    };
  }

  rotateEd25519Key(options: {
    previousKeyId: string;
    newKeyId: string;
    controller: string;
    rotatedAt: string;
  }): GeneratedKeyPair {
    const previous = this.keys.get(options.previousKeyId);
    if (!previous) {
      throw new Error("Unknown previous key: " + options.previousKeyId);
    }
    if (!previous.privateKeyObject) {
      throw new Error("Previous key is already inactive: " + options.previousKeyId);
    }

    previous.metadata = {
      ...previous.metadata,
      validUntil: options.rotatedAt,
      supersededBy: options.newKeyId,
    };
    delete previous.privateKeyObject;

    return this.generateEd25519Key({
      keyId: options.newKeyId,
      controller: options.controller,
      createdAt: options.rotatedAt,
      validFrom: options.rotatedAt,
    });
  }

  revokeKey(keyId: string, revokedAt: string): void {
    const stored = this.keys.get(keyId);
    if (!stored) {
      throw new Error("Unknown key: " + keyId);
    }

    stored.metadata = {
      ...stored.metadata,
      revokedAt,
    };
    delete stored.privateKeyObject;
  }

  async sign(
    payload: Uint8Array,
    key: SigningKeyRef,
  ): Promise<CryptoSignature> {
    const stored = this.keys.get(key.keyId);
    if (!stored || !stored.privateKeyObject) {
      throw new Error("Signing key is unavailable: " + key.keyId);
    }

    if (
      key.suite !== stored.metadata.suite ||
      key.algorithm !== stored.metadata.algorithm
    ) {
      throw new Error("Signing key metadata mismatch: " + key.keyId);
    }

    const signature = nodeSign(
      null,
      Buffer.from(payload),
      stored.privateKeyObject,
    );

    return {
      suite: stored.metadata.suite,
      algorithm: stored.metadata.algorithm,
      keyId: stored.metadata.keyId,
      encoding: "base64url",
      value: signature.toString("base64url"),
    };
  }

  async verify(
    payload: Uint8Array,
    signature: CryptoSignature,
    key: VerificationKey,
  ): Promise<boolean> {
    if (
      signature.keyId !== key.keyId ||
      signature.suite !== key.suite ||
      signature.algorithm !== key.algorithm ||
      key.suite !== "classical" ||
      key.algorithm !== ED25519 ||
      key.encoding !== "spki-der-base64url"
    ) {
      return false;
    }

    try {
      const publicKey = createPublicKey({
        key: Buffer.from(key.publicKey, "base64url"),
        format: "der",
        type: "spki",
      });

      return nodeVerify(
        null,
        Buffer.from(payload),
        publicKey,
        Buffer.from(signature.value, "base64url"),
      );
    } catch {
      return false;
    }
  }

  async describeKey(keyId: string): Promise<KeyMetadata | undefined> {
    const stored = this.keys.get(keyId);
    return stored ? cloneMetadata(stored.metadata) : undefined;
  }

  async verificationKey(
    keyId: string,
  ): Promise<VerificationKey | undefined> {
    const metadata = await this.describeKey(keyId);
    return metadata ? { ...metadata.verificationKey } : undefined;
  }
}
