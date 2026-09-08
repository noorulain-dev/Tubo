import { randomBytes } from "node:crypto";

// Prints a fresh 32-byte base64 key for INTEGRATION_ENCRYPTION_KEY.
console.log(randomBytes(32).toString("base64"));