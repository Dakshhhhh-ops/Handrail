/**
 * Bounded versions of lz-string's decompressors.
 *
 * LZ output can be thousands of times larger than its input, so a short share
 * link or live message can expand into gigabytes and crash the tab. These are
 * the same algorithm as lz-string's _decompress (MIT licence, pieroxy), with a
 * cap on input length and on output length: past either, they give up and
 * return null.
 */
const URI_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';
const URI_INDEX: Record<string, number> = Object.fromEntries([...URI_ALPHABET].map((ch, i) => [ch, i]));

export const MAX_INPUT = 300_000;
export const MAX_OUTPUT = 5_000_000;

function decompress(length: number, resetValue: number, next: (index: number) => number, maxOutput: number): string | null {
  const dictionary: string[] = ['0', '1', '2'];
  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  const result: string[] = [];
  let total = 0;
  const data = { val: next(0), position: resetValue, index: 1 };

  const read = (bitsCount: number): number => {
    let bits = 0;
    const maxpower = 2 ** bitsCount;
    let power = 1;
    while (power !== maxpower) {
      const resb = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = resetValue;
        data.val = next(data.index++);
      }
      bits |= (resb > 0 ? 1 : 0) * power;
      power <<= 1;
    }
    return bits;
  };

  let c: string;
  switch (read(2)) {
    case 0: c = String.fromCharCode(read(8)); break;
    case 1: c = String.fromCharCode(read(16)); break;
    default: return '';
  }
  dictionary[3] = c;
  let w = c;
  result.push(c);
  total += c.length;

  for (;;) {
    if (data.index > length) return '';
    let code = read(numBits);
    switch (code) {
      case 0:
        dictionary[dictSize++] = String.fromCharCode(read(8));
        code = dictSize - 1;
        enlargeIn--;
        break;
      case 1:
        dictionary[dictSize++] = String.fromCharCode(read(16));
        code = dictSize - 1;
        enlargeIn--;
        break;
      case 2:
        return result.join('');
    }
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
    let entry: string;
    if (dictionary[code] !== undefined && code > 2) entry = dictionary[code];
    else if (code === dictSize) entry = w + w.charAt(0);
    else return null;

    total += entry.length;
    if (total > maxOutput) return null;
    result.push(entry);
    dictionary[dictSize++] = w + entry.charAt(0);
    enlargeIn--;
    w = entry;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  }
}

export function decompressFromEncodedURIComponent(input: string, maxOutput = MAX_OUTPUT): string | null {
  if (!input || input.length > MAX_INPUT) return null;
  const s = input.replace(/ /g, '+');
  return decompress(s.length, 32, (i) => URI_INDEX[s.charAt(i)] ?? 0, maxOutput);
}

export function decompressFromUTF16(input: string, maxOutput = MAX_OUTPUT): string | null {
  if (!input || input.length > MAX_INPUT) return null;
  return decompress(input.length, 16384, (i) => input.charCodeAt(i) - 32, maxOutput);
}
