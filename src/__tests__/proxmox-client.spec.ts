import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
	FingerprintMismatchError,
	isConnectError,
	normalizeFingerprint,
	parseClusterResources,
	splitList,
} from '../proxmox-client.js'
import { nodeFromUpid } from '../main.js'
import { formatUptime, slugify } from '../variables.js'

describe('parseClusterResources', () => {
	it('separates guests and nodes, skips templates and other resource types', () => {
		const { guests, nodes } = parseClusterResources([
			{ id: 'node/pve2', type: 'node', node: 'pve2', status: 'online' },
			{ id: 'node/pve1', type: 'node', node: 'pve1', status: 'offline' },
			{ id: 'qemu/101', type: 'qemu', vmid: 101, name: 'web', node: 'pve1', status: 'running', hastate: 'started' },
			{ id: 'lxc/100', type: 'lxc', vmid: 100, name: 'dns', node: 'pve2', status: 'stopped' },
			{ id: 'qemu/9000', type: 'qemu', vmid: 9000, name: 'tpl', node: 'pve1', status: 'stopped', template: 1 },
			{ id: 'storage/pve1/local', type: 'storage', node: 'pve1', status: 'available' },
		])
		assert.deepEqual(
			guests.map((g) => [g.vmid, g.type, g.node, g.status, g.hastate]),
			[
				[100, 'lxc', 'pve2', 'stopped', ''],
				[101, 'qemu', 'pve1', 'running', 'started'],
			],
		)
		assert.deepEqual(nodes, [
			{ name: 'pve1', status: 'offline' },
			{ name: 'pve2', status: 'online' },
		])
	})

	it('falls back to a generated name', () => {
		const { guests } = parseClusterResources([{ id: 'qemu/5', type: 'qemu', vmid: 5, node: 'n', status: 'stopped' }])
		assert.equal(guests[0].name, 'VM 5')
	})
})

describe('helpers', () => {
	it('normalizes fingerprints', () => {
		assert.equal(normalizeFingerprint('AA:bb:0C'), 'aabb0c')
		assert.equal(normalizeFingerprint(' aa bb-0c '), 'aabb0c')
	})

	it('splits lists', () => {
		assert.deepEqual(splitList(' 10.0.0.1, 10.0.0.2 ;10.0.0.3  '), ['10.0.0.1', '10.0.0.2', '10.0.0.3'])
		assert.deepEqual(splitList(''), [])
	})

	it('detects connect errors (safe to retry POST on another node)', () => {
		assert.equal(isConnectError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), true)
		assert.equal(isConnectError(new TypeError('fetch failed', { cause: { code: 'EHOSTUNREACH' } })), true)
		assert.equal(isConnectError(new FingerprintMismatchError('h', 'AA')), true)
		assert.equal(isConnectError(Object.assign(new Error('x'), { code: 'UND_ERR_HEADERS_TIMEOUT' })), false)
	})

	it('reads the node from a UPID', () => {
		assert.equal(nodeFromUpid('UPID:pve2:0000ABCD:00112233:6543210F:qmstart:101:companion@pve!companion:'), 'pve2')
	})

	it('formats uptime and slugs', () => {
		assert.equal(formatUptime(0), '')
		assert.equal(formatUptime(65), '1m 5s')
		assert.equal(formatUptime(3 * 86400 + 4 * 3600 + 5), '3d 4h')
		assert.equal(slugify('PVE-01'), 'pve_01')
	})
})
