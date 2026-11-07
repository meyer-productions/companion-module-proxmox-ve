import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { displayNameFor, GetConfigFields, type ModuleConfig } from '../config.js'
import { singleLine } from '../display-names.js'
import { migrateDisplayNames } from '../upgrades.js'
import { guestInfo } from '../variables.js'
import type { Guest } from '../proxmox-client.js'

const base: Guest = {
	vmid: 101,
	type: 'qemu',
	name: 'icf02-OBS-Split',
	label: 'icf02-OBS-Split',
	node: 'pve1',
	status: 'running',
	hastate: 'started',
	lock: '',
	uptime: 3 * 86400 + 4 * 3600,
	cpu: 0.123,
	mem: 450,
	maxmem: 1000,
}

describe('display names', () => {
	it('uses the custom name only while "Rename" is checked', () => {
		assert.equal(displayNameFor(base, { name_101: 'OBS Split' }), 'icf02-OBS-Split')
		assert.equal(displayNameFor(base, { rename_101: true, name_101: 'OBS Split' }), 'OBS Split')
		assert.equal(displayNameFor(base, { rename_101: true, name_101: '  ' }), 'icf02-OBS-Split')
	})

	it('supports \\n line breaks', () => {
		assert.equal(displayNameFor(base, { rename_101: true, name_101: 'OBS\\nSplit' }), 'OBS\nSplit')
		assert.equal(singleLine('OBS\nSplit'), 'OBS Split')
	})

	it('generates one checkbox and one conditional name field per guest', () => {
		const fields = GetConfigFields([base])
		const checkbox = fields.find((field) => field.id === 'rename_101')
		const name = fields.find((field) => field.id === 'name_101')
		assert.equal(checkbox?.type, 'checkbox')
		assert.equal(name?.type, 'textinput')
		assert.equal(name?.isVisibleExpression, '$(options:rename_101)')
	})

	it('migrates the old free text field (VMID entries only)', () => {
		const config = { displayNames: '101 = OBS Split\nicf03-PCO = PCO\n# x' } as unknown as ModuleConfig & {
			displayNames?: string
		}
		assert.equal(migrateDisplayNames(config), true)
		assert.equal(config.rename_101, true)
		assert.equal(config.name_101, 'OBS Split')
		assert.equal('displayNames' in config, false)
	})
})

describe('guestInfo', () => {
	it('running guest with HA', () => {
		assert.equal(guestInfo(base, ''), 'pve1\nCPU 12%\nRAM 45%\nup 3d 4h · HA')
	})

	it('stopped guest with HA, lock and running task', () => {
		const stopped = { ...base, status: 'stopped', hastate: 'stopped', lock: 'backup', uptime: 0 }
		assert.equal(guestInfo(stopped, 'start…'), 'pve1\nstopped\nHA stopped\nlock: backup\nstart…')
	})

	it('HA problem is shown explicitly', () => {
		assert.equal(guestInfo({ ...base, hastate: 'error', uptime: 0 }, ''), 'pve1\nCPU 12%\nRAM 45%\nHA error')
	})
})
