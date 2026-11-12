/**
 * Générateur de QR code **hors ligne** (aucun service externe).
 *
 * Le composant `QRCode` s'appuyait sur `api.qrserver.com` : sans réseau, le
 * secours affichait du texte, pas un QR code — impossible à scanner (F11). Ce
 * module encode lui-même le QR (mode octet, versions 1 à 10, niveaux de
 * correction L/M/Q/H) et fournit une matrice de modules prête à dessiner sur
 * un canvas.
 *
 * Portée volontairement limitée : les URL de partage et codes de parrainage
 * tiennent en quelques dizaines de caractères, donc la version 10 (271 octets
 * en niveau M) suffit largement.
 */

const ECC_CODEWORDS_PER_BLOCK: Record<Level, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
};

const NUM_ERROR_CORRECTION_BLOCKS: Record<Level, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
};

export type Level = 'L' | 'M' | 'Q' | 'H';

const FORMAT_BITS: Record<Level, number> = { L: 1, M: 0, Q: 3, H: 2 };

/** Alignement des motifs de repérage (nombres d'alignement par version). */
const ALIGNMENT_POSITIONS: number[][] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

function getBit(value: number, index: number): number {
  return ((value >>> index) & 1) !== 0 ? 1 : 0;
}

/** Codage Reed-Solomon (polynôme générateur de degré `degree`). */
function reedSolomonDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = multiplier(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = multiplier(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    for (let i = 0; i < divisor.length; i += 1) result[i] ^= multiplier(divisor[i], factor);
  }
  return result;
}

/** Multiplication dans GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1. */
function multiplier(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

export interface QrOptions {
  /** Niveau de correction d'erreur (M par défaut : bon compromis). */
  level?: Level;
  /** Version imposée (1-10). Par défaut : la plus petite qui convient. */
  version?: number;
}

export interface QrCode {
  size: number;
  /** `true` = module noir. Indexé `[y][x]`. */
  modules: boolean[][];
  version: number;
  level: Level;
}

/** Encode `text` en QR code. Lève une erreur si le texte est trop long. */
export function encodeQr(text: string, options: QrOptions = {}): QrCode {
  const level: Level = options.level || 'M';
  const bytes = toUtf8(text);

  let version = options.version || 0;
  if (!version) {
    for (let candidate = 1; candidate <= 10; candidate += 1) {
      if (bytes.length <= dataCapacity(candidate, level)) {
        version = candidate;
        break;
      }
    }
  }
  if (!version) throw new Error('Texte trop long pour un QR code.');

  const size = version * 4 + 17;
  const modules: (boolean | null)[][] = Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null));
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  drawFunctionPatterns(modules, isFunction, version, level);
  const codewords = addEccAndInterleave(buildDataCodewords(bytes, version, level), version, level);
  drawCodewords(modules, isFunction, codewords);

  // Masquage : on retient celui qui produit le meilleur score de contraste.
  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    applyMask(modules, isFunction, mask);
    drawFormatBits(modules, isFunction, level, mask);
    const score = penalty(modules);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
    applyMask(modules, isFunction, mask); // annulation (XOR)
  }
  applyMask(modules, isFunction, bestMask);
  drawFormatBits(modules, isFunction, level, bestMask);

  return {
    size,
    modules: modules.map((row) => row.map((cell) => cell === true)),
    version,
    level,
  };
}

function toUtf8(text: string): number[] {
  const out: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return out;
}

function numRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCapacity(version: number, level: Level): number {
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const ecc = ECC_CODEWORDS_PER_BLOCK[level][version];
  const blocks = NUM_ERROR_CORRECTION_BLOCKS[level][version];
  return rawCodewords - ecc * blocks;
}

function buildDataCodewords(bytes: number[], version: number, level: Level): number[] {
  const capacityBits = dataCapacity(version, level) * 8;
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push(getBit(value, i));
  };
  push(0b0100, 4); // mode octet
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);

  // Terminateur + remplissage.
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
    codewords.push(value);
  }
  return codewords;
}

function addEccAndInterleave(data: number[], version: number, level: Level): number[] {
  const blocks = NUM_ERROR_CORRECTION_BLOCKS[level][version];
  const eccLen = ECC_CODEWORDS_PER_BLOCK[level][version];
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);

  const numShortBlocks = blocks - (rawCodewords % blocks);
  const shortBlockLen = Math.floor(rawCodewords / blocks);
  const divisor = reedSolomonDivisor(eccLen);

  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  for (let i = 0, index = 0; i < blocks; i += 1) {
    const length = shortBlockLen - eccLen + (i < numShortBlocks ? 0 : 1);
    const chunk = data.slice(index, index + length);
    index += length;
    dataBlocks.push(chunk);
    eccBlocks.push(reedSolomonRemainder(chunk, divisor));
  }

  const result: number[] = [];
  const maxLength = shortBlockLen - eccLen + 1;
  for (let i = 0; i < maxLength; i += 1) {
    for (let j = 0; j < blocks; j += 1) {
      if (i < dataBlocks[j].length) result.push(dataBlocks[j][i]);
    }
  }
  for (let i = 0; i < eccLen; i += 1) {
    for (let j = 0; j < blocks; j += 1) result.push(eccBlocks[j][i]);
  }
  return result;
}

function drawFunctionPatterns(
  modules: (boolean | null)[][],
  isFunction: boolean[][],
  version: number,
  level: Level
): void {
  const size = modules.length;
  // Motifs de synchronisation.
  for (let i = 0; i < size; i += 1) {
    setFunction(modules, isFunction, 6, i, i % 2 === 0);
    setFunction(modules, isFunction, i, 6, i % 2 === 0);
  }
  // Repères d'angle.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(modules, isFunction, x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  // Repères d'alignement.
  const positions = ALIGNMENT_POSITIONS[version] || [];
  const last = positions.length - 1;
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = 0; j < positions.length; j += 1) {
      // On saute les trois repères d'angle déjà dessinés.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          setFunction(modules, isFunction, positions[j] + dx, positions[i] + dy, distance !== 1);
        }
      }
    }
  }
  // Réservation des zones de format et de version.
  drawFormatBits(modules, isFunction, level, 0);
  drawVersionBits(modules, isFunction, version);
}

function drawFormatBits(
  modules: (boolean | null)[][],
  isFunction: boolean[][],
  level: Level,
  mask: number
): void {
  const size = modules.length;
  const data = (FORMAT_BITS[level] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;

  // Copie 1 (autour du repère haut-gauche).
  for (let i = 0; i <= 5; i += 1) setFunction(modules, isFunction, 8, i, getBit(bits, i) === 1);
  setFunction(modules, isFunction, 8, 7, getBit(bits, 6) === 1);
  setFunction(modules, isFunction, 8, 8, getBit(bits, 7) === 1);
  setFunction(modules, isFunction, 7, 8, getBit(bits, 8) === 1);
  for (let i = 9; i < 15; i += 1) setFunction(modules, isFunction, 14 - i, 8, getBit(bits, i) === 1);

  // Copie 2 (bas-gauche et haut-droite).
  for (let i = 0; i < 8; i += 1) setFunction(modules, isFunction, size - 1 - i, 8, getBit(bits, i) === 1);
  for (let i = 8; i < 15; i += 1) setFunction(modules, isFunction, 8, size - 15 + i, getBit(bits, i) === 1);
  // Module toujours noir.
  setFunction(modules, isFunction, 8, size - 8, true);
}

function drawVersionBits(modules: (boolean | null)[][], isFunction: boolean[][], version: number): void {
  if (version < 7) return;
  const size = modules.length;
  let remainder = version;
  for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  const bits = (version << 12) | remainder;
  for (let i = 0; i < 18; i += 1) {
    const bit = getBit(bits, i) === 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(modules, isFunction, a, b, bit);
    setFunction(modules, isFunction, b, a, bit);
  }
}

function setFunction(
  modules: (boolean | null)[][],
  isFunction: boolean[][],
  x: number,
  y: number,
  dark: boolean
): void {
  if (y < 0 || y >= modules.length || x < 0 || x >= modules.length) return;
  modules[y][x] = dark;
  isFunction[y][x] = true;
}

function drawCodewords(modules: (boolean | null)[][], isFunction: boolean[][], codewords: number[]): void {
  const size = modules.length;
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // on saute la colonne de synchronisation
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (isFunction[y][x]) continue;
        const bit = index < codewords.length * 8 ? getBit(codewords[index >>> 3], 7 - (index & 7)) === 1 : false;
        modules[y][x] = bit;
        index += 1;
      }
    }
  }
}

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x, _y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(modules: (boolean | null)[][], isFunction: boolean[][], mask: number): void {
  const fn = MASKS[mask];
  for (let y = 0; y < modules.length; y += 1) {
    for (let x = 0; x < modules.length; x += 1) {
      if (!isFunction[y][x] && fn(x, y)) modules[y][x] = !modules[y][x];
    }
  }
}

/** Score de pénalité (norme ISO/IEC 18004) — plus bas = plus lisible. */
function penalty(modules: (boolean | null)[][]): number {
  const size = modules.length;
  let score = 0;
  const dark = (x: number, y: number) => modules[y][x] === true;

  // Règles 1 et 3 : séries de modules identiques.
  for (let y = 0; y < size; y += 1) {
    let runColor = dark(0, y);
    let runLength = 1;
    for (let x = 1; x < size; x += 1) {
      if (dark(x, y) === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) score += 3 + (runLength - 5);
        runColor = dark(x, y);
        runLength = 1;
      }
    }
    if (runLength >= 5) score += 3 + (runLength - 5);
  }
  for (let x = 0; x < size; x += 1) {
    let runColor = dark(x, 0);
    let runLength = 1;
    for (let y = 1; y < size; y += 1) {
      if (dark(x, y) === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) score += 3 + (runLength - 5);
        runColor = dark(x, y);
        runLength = 1;
      }
    }
    if (runLength >= 5) score += 3 + (runLength - 5);
  }

  // Règle 2 : blocs 2×2.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const color = dark(x, y);
      if (color === dark(x + 1, y) && color === dark(x, y + 1) && color === dark(x + 1, y + 1)) score += 3;
    }
  }

  // Règle 4 : équilibre noir/blanc.
  let darkCount = 0;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (dark(x, y)) darkCount += 1;
  const total = size * size;
  const ratio = Math.floor((Math.abs(darkCount * 20 - total * 10) / total) * 10);
  score += ratio * 10;
  return score;
}

/**
 * Dessine le QR dans le contexte 2D fourni.
 * `moduleSize` peut être fractionnaire : le rendu reste net sur écrans HiDPI.
 */
export function drawQr(
  ctx: CanvasRenderingContext2D,
  qr: QrCode,
  options: { x: number; y: number; size: number; dark?: string; light?: string; margin?: number }
): void {
  const margin = options.margin ?? 2;
  const total = qr.size + margin * 2;
  const cell = options.size / total;
  ctx.fillStyle = options.light || '#ffffff';
  ctx.fillRect(options.x, options.y, options.size, options.size);
  ctx.fillStyle = options.dark || '#111111';
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (!qr.modules[y][x]) continue;
      ctx.fillRect(
        options.x + Math.floor((x + margin) * cell),
        options.y + Math.floor((y + margin) * cell),
        Math.ceil(cell),
        Math.ceil(cell)
      );
    }
  }
}
