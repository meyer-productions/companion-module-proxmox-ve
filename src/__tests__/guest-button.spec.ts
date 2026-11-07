import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Colors, guestButtonStyle, layoutName } from '../guest-button.js'
import { ButtonImages } from '../button-images.js'
import type { Guest } from '../proxmox-client.js'

const guest: Guest = {
	vmid: 101,
	type: 'qemu',
	name: 'icf02-OBS-Split',
	label: 'OBS Split',
	node: 'pve1',
	status: 'running',
	hastate: '',
	lock: '',
	uptime: 100,
	cpu: 0.1,
	mem: 1,
	maxmem: 2,
}

describe('layoutName', () => {
	it('keeps short names on one line at full size', () => {
		assert.deepEqual(layoutName('PCO'), { text: 'PCO', size: 14 })
	})

	it('splits long names at a space or after a dash when that allows a larger font', () => {
		assert.equal(layoutName('Backup Server').text, 'Backup\nServer')
		assert.equal(layoutName('icf02-OBS-Split').text, 'icf02-\nOBS-Split')
		assert.ok(layoutName('icf02-OBS-Split').size > layoutName('icf02OBSSplit').size)
	})

	it('splits names that do not fit even at the minimum size in the middle', () => {
		assert.deepEqual(layoutName('mediaserverprod01'), { text: 'mediaserv\nerprod01', size: 11 })
	})

	it('respects explicit line breaks', () => {
		assert.equal(layoutName('OBS\nRecord').text, 'OBS\nRecord')
	})
})

describe('guestButtonStyle', () => {
	it('running guest: green, RUNNING band, name below the badge', () => {
		const style = guestButtonStyle({ guest, badge: 'start', runningTask: undefined, stopArmed: false })
		assert.equal(style.bgcolor, Colors.running)
		assert.equal(style.png64, ButtonImages.start.running)
		assert.equal(style.text, '\nOBS Split')
		assert.equal(style.show_topbar, false)
	})

	it('running task wins over status, HA problem colors red', () => {
		const style = guestButtonStyle({
			guest: { ...guest, hastate: 'error' },
			badge: 'reboot',
			runningTask: 'reboot',
			stopArmed: false,
		})
		assert.equal(style.png64, ButtonImages.reboot.task_reboot)
		assert.equal(style.bgcolor, Colors.problem)
	})

	it('armed stop and unknown guest', () => {
		const armed = guestButtonStyle({ guest, badge: 'stop', runningTask: undefined, stopArmed: true })
		assert.equal(armed.png64, ButtonImages.stopArmed)
		assert.equal(armed.bgcolor, Colors.armed)
		const unknown = guestButtonStyle({ guest: undefined, badge: 'start', runningTask: undefined, stopArmed: false })
		assert.equal(unknown.png64, ButtonImages.start.unknown)
	})
})
