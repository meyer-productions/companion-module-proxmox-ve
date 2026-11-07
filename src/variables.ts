import type {
	CompanionVariableDefinition,
	CompanionVariableDefinitions,
	CompanionVariableValue,
} from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { Guest } from './proxmox-client.js'
import { singleLine } from './display-names.js'

export type VariablesSchema = {
	connection_status: string
	active_host: string
	pve_version: string
	guest_count: number
	guest_running_count: number
	last_poll_time: string
	last_action_result: string
	// Generated per guest (vm_<vmid>_status, ...) and per node (node_<slug>_status).
	[key: string]: CompanionVariableValue
}

/** Converts a node name into a slug that is safe for variable IDs, e.g. "PVE-01" -> "pve_01". */
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
}

/** Formats seconds as "3d 4h", "4h 12m" or "12m 5s". */
export function formatUptime(seconds: number): string {
	if (!seconds || seconds <= 0) return ''
	const d = Math.floor(seconds / 86400)
	const h = Math.floor((seconds % 86400) / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	const s = Math.floor(seconds % 60)
	if (d > 0) return `${d}d ${h}h`
	if (h > 0) return `${h}h ${m}m`
	return `${m}m ${s}s`
}

/**
 * Compact multi-line summary for the status tile (without the name, so the button text is
 * "$(label)\n$(info)"). Only lines that carry information for the current state are included.
 */
export function guestInfo(guest: Guest, runningTask: string): string {
	const lines = [guest.node]
	const ha = guest.hastate
	if (guest.status === 'running') {
		lines.push(`CPU ${Math.round(guest.cpu * 100)}%`)
		if (guest.maxmem > 0) lines.push(`RAM ${Math.round((guest.mem / guest.maxmem) * 100)}%`)
		const uptime = formatUptime(guest.uptime)
		const parts = [uptime ? `up ${uptime}` : '', ha === 'started' ? 'HA' : ''].filter((part) => part)
		if (parts.length > 0) lines.push(parts.join(' · '))
		if (ha && ha !== 'started') lines.push(`HA ${ha}`)
	} else {
		lines.push(guest.status)
		if (ha) lines.push(`HA ${ha}`)
	}
	if (guest.lock) lines.push(`lock: ${guest.lock}`)
	if (runningTask) lines.push(runningTask)
	return lines.join('\n')
}

export function guestVariableValues(
	guest: Guest,
	task: string,
	runningTask: string,
): Record<string, CompanionVariableValue> {
	const prefix = `vm_${guest.vmid}`
	return {
		[`${prefix}_info`]: guestInfo(guest, runningTask),
		[`${prefix}_name`]: guest.name,
		[`${prefix}_label`]: guest.label,
		[`${prefix}_status`]: guest.status,
		[`${prefix}_node`]: guest.node,
		[`${prefix}_type`]: guest.type,
		[`${prefix}_uptime`]: formatUptime(guest.uptime),
		[`${prefix}_cpu`]: guest.status === 'running' ? Math.round(guest.cpu * 1000) / 10 : 0,
		[`${prefix}_mem`]:
			guest.maxmem > 0 && guest.status === 'running' ? Math.round((guest.mem / guest.maxmem) * 1000) / 10 : 0,
		[`${prefix}_hastate`]: guest.hastate,
		[`${prefix}_task`]: task,
	}
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions: Record<string, CompanionVariableDefinition> = {
		connection_status: { name: 'Connection status' },
		active_host: { name: 'Node currently used for API requests' },
		pve_version: { name: 'Proxmox VE version' },
		guest_count: { name: 'Number of VMs/containers' },
		guest_running_count: { name: 'Number of running VMs/containers' },
		last_poll_time: { name: 'Time of last successful status poll' },
		last_action_result: { name: 'Result of the last action' },
	}

	for (const guest of self.guests) {
		const label = `${singleLine(guest.label)} (${guest.vmid})`
		const prefix = `vm_${guest.vmid}`
		definitions[`${prefix}_name`] = { name: `${label}: Proxmox name` }
		definitions[`${prefix}_label`] = { name: `${label}: display name (for buttons)` }
		definitions[`${prefix}_status`] = { name: `${label}: status (running/stopped)` }
		definitions[`${prefix}_node`] = { name: `${label}: current node` }
		definitions[`${prefix}_type`] = { name: `${label}: type (qemu/lxc)` }
		definitions[`${prefix}_uptime`] = { name: `${label}: uptime` }
		definitions[`${prefix}_cpu`] = { name: `${label}: CPU usage (%)` }
		definitions[`${prefix}_mem`] = { name: `${label}: memory usage (%)` }
		definitions[`${prefix}_hastate`] = { name: `${label}: HA state (empty if not HA managed)` }
		definitions[`${prefix}_task`] = { name: `${label}: running/last task` }
		definitions[`${prefix}_info`] = { name: `${label}: summary for status tiles (multi-line)` }
	}

	for (const node of self.nodes) {
		definitions[`node_${slugify(node.name)}_status`] = { name: `Node ${node.name}: status (online/offline)` }
	}

	self.setVariableDefinitions(definitions as CompanionVariableDefinitions<VariablesSchema>)
}
