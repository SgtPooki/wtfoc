/**
 * AES-256-GCM encryption for session keys at rest.
 * Uses SESSION_KEY_ENCRYPTION_KEY env var (32-byte hex string).
 * Falls back to plaintext encoding if no encryption key is configured (local dev only).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer | null {
	const keyHex = process.env.SESSION_KEY_ENCRYPTION_KEY;
	if (!keyHex) return null;
	const key = Buffer.from(keyHex, "hex");
	if (key.length !== 32) {
		console.error("[crypto] SESSION_KEY_ENCRYPTION_KEY must be 32 bytes (64 hex chars). Session keys will NOT be encrypted.");
		return null;
	}
	return key;
}

/**
 * Encrypt a session key for storage.
 * Returns: IV (12 bytes) + ciphertext + auth tag (16 bytes)
 * If no encryption key is configured, returns plaintext UTF-8 bytes (local dev fallback).
 */
export function encryptSessionKey(sessionKey: string): Uint8Array {
	const key = getEncryptionKey();
	if (!key) {
		// No encryption key — store as plaintext (local dev only)
		return new TextEncoder().encode(sessionKey);
	}

	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const encrypted = Buffer.concat([cipher.update(sessionKey, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();

	// Pack: IV + ciphertext + tag
	return new Uint8Array(Buffer.concat([iv, encrypted, tag]));
}

/**
 * Decrypt a session key from storage.
 * Expects: IV (12 bytes) + ciphertext + auth tag (16 bytes)
 * If no encryption key is configured, treats input as plaintext UTF-8.
 */
export function decryptSessionKey(data: Uint8Array): string {
	const key = getEncryptionKey();
	if (!key) {
		// No encryption key — data is plaintext
		return new TextDecoder().decode(data);
	}

	const buf = Buffer.from(data);
	if (buf.length < IV_LENGTH + TAG_LENGTH + 1) {
		throw new Error("Encrypted session key data too short");
	}

	const iv = buf.subarray(0, IV_LENGTH);
	const tag = buf.subarray(buf.length - TAG_LENGTH);
	const ciphertext = buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH);

	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(tag);
	return decipher.update(ciphertext) + decipher.final("utf8");
}
