import crypto from "crypto";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ENCRYPTION_IV_LENGTH = 16;

const encryptPrivateKey = (privateKey: Uint8Array): string => {
  const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    Buffer.from(ENCRYPTION_KEY as string, "hex"),
    iv
  );
  const encryptedPrivateKey = Buffer.concat([
    cipher.update(Buffer.from(privateKey)),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encryptedPrivateKey]).toString("hex");
};

const decryptPrivateKey = (encryptedPrivateKey: string): Uint8Array => {
  const encryptedBuffer = Buffer.from(encryptedPrivateKey, "base64");

  const iv = encryptedBuffer.subarray(0, ENCRYPTION_IV_LENGTH);
  const authTag = encryptedBuffer.subarray(
    ENCRYPTION_IV_LENGTH,
    ENCRYPTION_IV_LENGTH + 16
  );
  const encryptedKey = encryptedBuffer.subarray(ENCRYPTION_IV_LENGTH + 16);

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(ENCRYPTION_KEY as string, "hex"),
    iv
  );
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encryptedKey),
    decipher.final(),
  ]);
  return new Uint8Array(decrypted);
};

export { encryptPrivateKey, decryptPrivateKey };
