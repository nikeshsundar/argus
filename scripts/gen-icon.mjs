/**
 * Generates resources/icon.png (256x256) with no image dependencies.
 * Run with: npm run icon
 *
 * The mark is an eye on a dark rounded square - it stays readable when the
 * tray shrinks it to 16px.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const SIZE = 256
const SUPERSAMPLE = 3
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'icon.png')

// --- minimal PNG encoder ---------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([length, typeBuf, data, crc])
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// --- drawing ---------------------------------------------------------------

const mix = (a, b, t) => a + (b - a) * t
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
/** Signed distance to a rounded rectangle; negative inside. */
function sdRoundRect(x, y, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(x - cx) - (halfW - r)
  const qy = Math.abs(y - cy) - (halfH - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/** Coverage of a shape at a point, anti-aliased over roughly one pixel. */
const coverage = (distance) => clamp01(0.5 - distance)

function shade(x, y) {
  const out = [0, 0, 0, 0]

  const paint = (r, g, b, alpha) => {
    if (alpha <= 0) return
    const a = clamp01(alpha)
    out[0] = mix(out[0], r, a)
    out[1] = mix(out[1], g, a)
    out[2] = mix(out[2], b, a)
    out[3] = clamp01(out[3] + a * (1 - out[3]))
  }

  // Dark rounded-square plate with a subtle top-to-bottom gradient.
  const plate = coverage(sdRoundRect(x, y, 128, 128, 122, 122, 58))
  const t = y / SIZE
  paint(mix(28, 12, t), mix(30, 14, t), mix(52, 32, t), plate)

  // Iris.
  const iris = coverage(Math.hypot(x - 128, y - 128) - 66)
  const it = clamp01((x - 62) / 132)
  paint(mix(103, 56, it), mix(232, 189, it), mix(249, 248, it), iris)

  // Pupil.
  paint(11, 13, 26, coverage(Math.hypot(x - 128, y - 128) - 28))

  // Specular highlight.
  paint(255, 255, 255, coverage(Math.hypot(x - 106, y - 104) - 11) * 0.9)

  return out
}

const rgba = Buffer.alloc(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (let sy = 0; sy < SUPERSAMPLE; sy++) {
      for (let sx = 0; sx < SUPERSAMPLE; sx++) {
        const px = x + (sx + 0.5) / SUPERSAMPLE
        const py = y + (sy + 0.5) / SUPERSAMPLE
        const [sr, sg, sb, sa] = shade(px, py)
        r += sr * sa
        g += sg * sa
        b += sb * sa
        a += sa
      }
    }
    const samples = SUPERSAMPLE * SUPERSAMPLE
    const offset = (y * SIZE + x) * 4
    // Un-premultiply so edge pixels keep their colour at low alpha.
    rgba[offset] = a > 0 ? Math.round(r / a) : 0
    rgba[offset + 1] = a > 0 ? Math.round(g / a) : 0
    rgba[offset + 2] = a > 0 ? Math.round(b / a) : 0
    rgba[offset + 3] = Math.round((a / samples) * 255)
  }
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, encodePng(SIZE, SIZE, rgba))
console.log(`wrote ${OUT}`)
