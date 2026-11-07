import type { CompanionAdvancedFeedbackResult } from '@companion-module/base'
import { ButtonImages, type ButtonBadge, type ButtonState } from './button-images.js'
import type { Guest, PowerAction } from './proxmox-client.js'

/** Button palette: dark = stopped/idle, green = running, amber = task running, red = problem. */
export const Colors = {
	idle: 0x1c1c1c,
	running: 0x1b5e20,
	task: 0x9a6700,
	problem: 0x7f0000,
	armed: 0xd50000,
	white: 0xffffff,
} as const

export const HA_PROBLEM_STATES = new Set(['error', 'fence', 'recovery'])

const MAX_SIZE = 14
const MIN_SIZE = 7
/** Usable text width in pixels and average character width relative to the font size (bold sans serif). */
const TEXT_WIDTH = 66
const CHAR_WIDTH = 0.6
/** Largest size per number of lines that still fits between badge and status band. */
const SIZE_BY_LINES = [MAX_SIZE, MAX_SIZE, 11, 8]

function longestLine(lines: string[]): number {
	return Math.max(...lines.map((line) => line.length), 1)
}

function sizeFor(lines: string[]): number {
	const byWidth = Math.floor(TEXT_WIDTH / (CHAR_WIDTH * longestLine(lines)))
	const byLines = SIZE_BY_LINES[lines.length] ?? MIN_SIZE
	return Math.max(MIN_SIZE, Math.min(MAX_SIZE, byWidth, byLines))
}

function fits(lines: string[], size: number): boolean {
	return longestLine(lines) * CHAR_WIDTH * size <= TEXT_WIDTH
}

/**
 * Lays out a guest name for the area between badge and status band: keeps explicit line breaks, otherwise
 * tries a split into two lines (at a space, or after "-"/"_") when that allows a larger font, and scales
 * the font down for long names. A name that does not fit even at the minimum size is split in the middle,
 * so Companion never wraps it at an arbitrary character.
 */
export function layoutName(label: string): { text: string; size: number } {
	const name = label.trim() || '?'
	if (name.includes('\n')) {
		const lines = name.split('\n').map((line) => line.trim())
		return { text: lines.join('\n'), size: sizeFor(lines) }
	}

	let best = { text: name, size: sizeFor([name]) }
	for (let i = 1; i < name.length - 1; i++) {
		const char = name[i]
		let lines: string[] | undefined
		if (char === ' ') lines = [name.slice(0, i).trim(), name.slice(i + 1).trim()]
		else if (char === '-' || char === '_') lines = [name.slice(0, i + 1), name.slice(i + 1)]
		if (!lines || !lines[0] || !lines[1]) continue
		const size = sizeFor(lines)
		if (size > best.size) best = { text: lines.join('\n'), size }
	}

	if (!fits(best.text.split('\n'), best.size)) {
		const middle = Math.ceil(name.length / 2)
		const lines = [name.slice(0, middle), name.slice(middle)]
		best = { text: lines.join('\n'), size: sizeFor(lines) }
	}
	return best
}

export type GuestButtonInput = {
	guest: Guest | undefined
	badge: ButtonBadge
	runningTask: PowerAction | undefined
	stopArmed: boolean
}

/** Full button look for a guest: image with badge + status band, name in the middle, state color. */
export function guestButtonStyle({
	guest,
	badge,
	runningTask,
	stopArmed,
}: GuestButtonInput): CompanionAdvancedFeedbackResult {
	const name = layoutName(guest?.label ?? '?')
	let state: ButtonState = 'unknown'
	let bgcolor: number = Colors.idle

	if (guest) {
		if (runningTask) {
			state = `task_${runningTask}`
			bgcolor = Colors.task
		} else if (guest.status === 'running') {
			state = 'running'
			bgcolor = Colors.running
		} else if (guest.status === 'stopped') {
			state = 'stopped'
		}
		if (HA_PROBLEM_STATES.has(guest.hastate)) bgcolor = Colors.problem
	}

	const armed = badge === 'stop' && stopArmed
	return {
		// The leading empty line moves the name below the badge (text is centered on the whole button).
		text: `\n${name.text}`,
		size: name.size,
		color: Colors.white,
		bgcolor: armed ? Colors.armed : bgcolor,
		alignment: 'center:center',
		png64: armed ? ButtonImages.stopArmed : ButtonImages[badge][state],
		pngalignment: 'center:center',
		show_topbar: false,
	}
}
