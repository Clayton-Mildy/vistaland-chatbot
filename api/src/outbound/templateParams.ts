/**
 * WhatsApp rejects template variables with line breaks, tabs or long runs of spaces, and caps
 * their length. Flattens whitespace to single spaces and clips with an ellipsis at max chars.
 */
export function templateParam(text: string, max = 500): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
