import sharp from 'sharp';

export function sampleFrameIndexes(pages: number) {
  const count = Math.max(1, Math.floor(pages));
  return Array.from(new Set([0, Math.floor((count - 1) / 2), count - 1])).slice(0, 3);
}

export async function perceptualAverageHash(buffer: Buffer | Uint8Array) {
  const pixels = await sharp(buffer).greyscale().resize(8, 8, { fit: 'fill' }).raw().toBuffer();
  const average = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
  let bits = '';
  for (const value of pixels) bits += value >= average ? '1' : '0';
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

export function perceptualHashDistance(left: string, right: string) {
  if (!/^[0-9a-f]{16}$/i.test(left) || !/^[0-9a-f]{16}$/i.test(right)) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    let difference = Number.parseInt(left[index] ?? '0', 16) ^ Number.parseInt(right[index] ?? '0', 16);
    while (difference) {
      distance += difference & 1;
      difference >>= 1;
    }
  }
  return distance;
}
