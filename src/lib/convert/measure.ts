// Cheap text measurements, shared by the worker and the UI without pulling in any parser

/** Number of lines, counted like `text.split("\n").length` without the split. */
export function countLines(text: string): number {
  let lines = 1;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) lines++;
  return lines;
}

/** UTF-8 byte length without encoding the text. */
export function utf8Length(text: string): number {
  let bytes = text.length;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) continue;
    if (code < 0x800) bytes += 1;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      // A surrogate pair is 2 chars and 4 bytes
      bytes += 2;
      i++;
    } else bytes += 2;
  }
  return bytes;
}

/** "20 MB" for a size cap in characters. */
export function sizeLabel(chars: number): string {
  return chars >= 1_000_000 ? `${Math.round(chars / 1_000_000)} MB` : `${Math.round(chars / 1_000)} KB`;
}
