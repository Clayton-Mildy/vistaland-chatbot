import { createHmac, timingSafeEqual } from 'crypto';

/**
 * ChakraHQ signs the raw request body: header x-chakra-signature-256 is the lowercase hex
 * HMAC-SHA256 with the webhook secret, with no "sha256=" prefix (unlike Meta's own header).
 */
export function verifyChakraSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
