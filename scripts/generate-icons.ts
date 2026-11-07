/**
 * Generates the preset icons (round colored badge with a white glyph) as base64 PNGs into src/icons.ts.
 * Pure Node (zlib), no image libraries: shapes are rasterized with 6x6 supersampling for smooth edges.
 * Run: yarn icons (also builds the full button images, see scripts/generate-buttons.ps1)
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WIDTH = 72
const HEIGHT = 24
const CX = WIDTH / 2
const CY = HEIGHT / 2
const RADIUS = 11
const SAMPLES = 6

/** Shape test in badge units: (0,0) = badge center, 1 = badge radius, y points down. */
type Shape = (u: number, v: number) => boolean

const deg = (d: number): number => (d * Math.PI) / 180

function inTriangle(px: number, py: number, a: number[], b: number[], c: number[]): boolean {
	const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1])
	const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1])
	const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1])
	const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
	const hasPos = d1 > 0 || d2 > 0 || d3 > 0
	return !(hasNeg && hasPos)
}

function inRoundRect(u: number, v: number, x0: number, y0: number, x1: number, y1: number, r: number): boolean {
	if (u < x0 || u > x1 || v < y0 || v > y1) return false
	const cx = Math.min(Math.max(u, x0 + r), x1 - r)
	const cy = Math.min(Math.max(v, y0 + r), y1 - r)
	return (u - cx) ** 2 + (v - cy) ** 2 <= r * r
}

const glyphs: Record<string, Shape> = {
	// ▶ slightly shifted right so it looks optically centered
	start: (u, v) => inTriangle(u, v, [-0.3, -0.5], [-0.3, 0.5], [0.55, 0]),

	// ■
	stop: (u, v) => inRoundRect(u, v, -0.4, -0.4, 0.4, 0.4, 0.08),

	// ⏻ ring with a gap at the top plus a vertical bar
	shutdown: (u, v) => {
		const d = Math.hypot(u, v)
		const angleFromUp = Math.abs(Math.atan2(u, -v))
		const ring = d >= 0.4 && d <= 0.56 && angleFromUp > deg(38)
		const bar = inRoundRect(u, v, -0.08, -0.66, 0.08, -0.05, 0.08)
		return ring || bar
	},

	// ↻ open ring (gap top right) with an arrow head pointing clockwise
	reboot: (u, v) => {
		const d = Math.hypot(u, v)
		const theta = Math.atan2(v, u) // -90° = up, 0° = right
		const ring = d >= 0.38 && d <= 0.54 && !(theta > deg(-90) && theta < deg(-20))
		const head = inTriangle(u, v, [-0.02, -0.74], [-0.02, -0.18], [0.3, -0.46])
		return ring || head
	},

	// server: two stacked units with status LEDs
	server: (u, v) => {
		const led = (cy: number): boolean => (u - 0.3) ** 2 + (v - cy) ** 2 <= 0.075 ** 2
		const unit1 = inRoundRect(u, v, -0.52, -0.5, 0.52, -0.06, 0.08) && !led(-0.28)
		const unit2 = inRoundRect(u, v, -0.52, 0.06, 0.52, 0.5, 0.08) && !led(0.28)
		return unit1 || unit2
	},
}

const badgeColors: Record<string, number> = {
	start: 0x2e7d32,
	shutdown: 0xef6c00,
	reboot: 0x1565c0,
	stop: 0xc62828,
	server: 0x546e7a,
}

/** Variant used while a hard stop is armed: white badge, red glyph. */
const extraIcons: { name: string; glyph: string; badge: number; glyphColor: number }[] = [
	{ name: 'stopArmed', glyph: 'stop', badge: 0xffffff, glyphColor: 0xd50000 },
]

function rgb(color: number): [number, number, number] {
	return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff]
}

function render(glyph: Shape, badgeColor: number, glyphColor: number): Buffer {
	const pixels = Buffer.alloc(WIDTH * HEIGHT * 4)
	const badge = rgb(badgeColor)
	const fg = rgb(glyphColor)
	const ring = rgb(0xffffff)
	for (let y = 0; y < HEIGHT; y++) {
		for (let x = 0; x < WIDTH; x++) {
			let badgeCov = 0
			let glyphCov = 0
			let ringCov = 0
			for (let sy = 0; sy < SAMPLES; sy++) {
				for (let sx = 0; sx < SAMPLES; sx++) {
					const u = (x + (sx + 0.5) / SAMPLES - CX) / RADIUS
					const v = (y + (sy + 0.5) / SAMPLES - CY) / RADIUS
					const d = Math.hypot(u, v)
					if (d > 1) continue
					badgeCov++
					if (d > 0.9) ringCov++
					else if (glyph(u, v)) glyphCov++
				}
			}
			const total = SAMPLES * SAMPLES
			const a = badgeCov / total
			if (a === 0) continue
			// Mix inside the badge: badge color, white glyph, subtle light rim for contrast on any background.
			const g = glyphCov / badgeCov
			const r = (ringCov / badgeCov) * 0.35
			const i = (y * WIDTH + x) * 4
			for (let c = 0; c < 3; c++) {
				const base = badge[c] * (1 - g) + fg[c] * g
				pixels[i + c] = Math.round(base * (1 - r) + ring[c] * r)
			}
			pixels[i + 3] = Math.round(a * 255)
		}
	}
	return pixels
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
	return c >>> 0
})

function crc32(buf: Buffer): number {
	let c = 0xffffffff
	for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4)
	length.writeUInt32BE(data.length)
	const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(typeAndData))
	return Buffer.concat([length, typeAndData, crc])
}

function encodePng(rgba: Buffer): Buffer {
	const header = Buffer.alloc(13)
	header.writeUInt32BE(WIDTH, 0)
	header.writeUInt32BE(HEIGHT, 4)
	header[8] = 8 // bit depth
	header[9] = 6 // RGBA
	const raw = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT)
	for (let y = 0; y < HEIGHT; y++) {
		raw[y * (WIDTH * 4 + 1)] = 0 // filter: none
		rgba.copy(raw, y * (WIDTH * 4 + 1) + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4)
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	])
}

const icons: Record<string, string> = {}
for (const [name, glyph] of Object.entries(glyphs)) {
	icons[name] = encodePng(render(glyph, badgeColors[name], 0xffffff)).toString('base64')
}
for (const extra of extraIcons) {
	icons[extra.name] = encodePng(render(glyphs[extra.glyph], extra.badge, extra.glyphColor)).toString('base64')
}

const lines = [
	'// Generated by scripts/generate-icons.ts (yarn icons) - do not edit by hand.',
	`// ${WIDTH}x${HEIGHT} PNG, round badge with glyph, meant for pngalignment 'center:top'.`,
	'',
	'export const Icons = {',
	...Object.entries(icons).map(([name, data]) => `\t${name}: '${data}',`),
	'} as const',
	'',
]
const target = fileURLToPath(new URL('../src/icons.ts', import.meta.url))
writeFileSync(target, lines.join('\n'))
console.log(`Wrote ${Object.keys(icons).length} icons to ${target}`)

// Badge files for scripts/generate-buttons.ps1 (and for a visual check): --out <dir>
const outIndex = process.argv.indexOf('--out')
if (outIndex > 0 && process.argv[outIndex + 1]) {
	const dir = process.argv[outIndex + 1]
	mkdirSync(dir, { recursive: true })
	for (const [name, data] of Object.entries(icons)) {
		writeFileSync(`${dir}/${name}.png`, Buffer.from(data, 'base64'))
	}
}
