import type { SomeCompanionConfigField } from '@companion-module/base'
import type { Guest, TlsMode } from './proxmox-client.js'

export type ModuleConfig = {
	hosts: string
	port: number
	tokenId: string
	tlsMode: TlsMode
	fingerprints: string
	pollInterval: number
	// Generated per guest in the "Button names" section, see renameFields().
	[key: `rename_${number}`]: boolean
	[key: `name_${number}`]: string
}

export type ModuleSecrets = {
	tokenSecret: string
}

export const renameKey = (vmid: number): `rename_${number}` => `rename_${vmid}`
export const nameKey = (vmid: number): `name_${number}` => `name_${vmid}`

/**
 * One row per guest: a "Rename" checkbox and, only while it is checked, a field for the new name.
 * The rows are known only after the first successful poll; Companion asks for the config fields again
 * every time the settings are opened, so new guests appear automatically.
 */
function renameFields(guests: Guest[]): SomeCompanionConfigField[] {
	const header: SomeCompanionConfigField = {
		type: 'static-text',
		id: 'namesInfo',
		label: 'Button names',
		width: 12,
		value:
			guests.length === 0
				? 'The list of VMs/containers appears here after the first successful connection ' +
					'(close and reopen these settings).'
				: 'Check <b>Rename</b> to show a shorter name on the buttons. Changes apply to all existing ' +
					'buttons immediately.',
	}

	const rows: SomeCompanionConfigField[] = []
	for (const guest of guests) {
		rows.push(
			{
				type: 'checkbox',
				id: renameKey(guest.vmid),
				label: `${guest.name} (${guest.vmid}${guest.type === 'lxc' ? ', CT' : ''})`,
				tooltip: 'Rename on buttons',
				width: 5,
				default: false,
			},
			{
				type: 'textinput',
				id: nameKey(guest.vmid),
				label: 'Name on buttons',
				tooltip: 'Optional: \\n forces a line break, e.g. OBS\\nSplit',
				width: 7,
				default: guest.name,
				isVisibleExpression: `$(options:${renameKey(guest.vmid)})`,
			},
		)
	}
	return [header, ...rows]
}

/** Display name of a guest: the configured name if "Rename" is checked, otherwise the Proxmox name. */
export function displayNameFor(guest: Pick<Guest, 'vmid' | 'name'>, config: Partial<ModuleConfig>): string {
	if (!config[renameKey(guest.vmid)]) return guest.name
	const custom = String(config[nameKey(guest.vmid)] ?? '').trim()
	return custom ? custom.replace(/\\n/g, '\n') : guest.name
}

export function GetConfigFields(guests: Guest[] = []): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'Proxmox VE',
			width: 12,
			value:
				'Connects to the Proxmox VE REST API with an <b>API token</b>. ' +
				'Recommended: a dedicated user with a role containing <i>VM.Audit</i>, <i>VM.PowerMgmt</i> and ' +
				'<i>Sys.Audit</i>, and a token with privilege separation. See the module help for the exact commands.',
		},
		{
			type: 'textinput',
			id: 'hosts',
			label: 'Nodes (IP/hostname, comma separated)',
			tooltip:
				'One or more nodes of the same cluster. The module uses the first reachable node and fails over to ' +
				'the next one automatically. Every node can control all guests of the cluster.',
			width: 8,
			default: '',
		},
		{
			type: 'number',
			id: 'port',
			label: 'Port',
			width: 4,
			min: 1,
			max: 65535,
			default: 8006,
		},
		{
			type: 'textinput',
			id: 'tokenId',
			label: 'API token ID',
			tooltip: 'Format: user@realm!tokenname, e.g. companion@pve!companion',
			width: 6,
			default: '',
			regex: '/^[^@\\s]+@[^!\\s]+![A-Za-z][A-Za-z0-9._-]*$/',
		},
		{
			type: 'secret-text',
			id: 'tokenSecret',
			label: 'API token secret',
			tooltip: 'The UUID shown once when the token was created',
			width: 6,
		},
		{
			type: 'dropdown',
			id: 'tlsMode',
			label: 'TLS certificate check',
			tooltip:
				'Proxmox uses certificates of its own cluster CA by default. "Pinned fingerprints" is the secure ' +
				'choice for those. Use "Verify" only with publicly trusted (e.g. ACME) certificates.',
			width: 6,
			choices: [
				{ id: 'fingerprint', label: 'Pinned fingerprints (recommended)' },
				{ id: 'verify', label: 'Verify (trusted certificate, e.g. ACME)' },
				{ id: 'insecure', label: 'Do not verify (insecure)' },
			],
			default: 'fingerprint',
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Status poll interval (seconds)',
			tooltip: 'How often the state of all guests is refreshed (one request for the whole cluster)',
			width: 6,
			min: 1,
			max: 300,
			default: 3,
		},
		{
			type: 'textinput',
			id: 'fingerprints',
			label: 'SHA-256 fingerprints (one per node, comma separated)',
			tooltip:
				'Shown in the Proxmox web UI under Node → System → Certificates → pve-ssl.pem → View Certificate, ' +
				'or with: openssl x509 -noout -fingerprint -sha256 -in /etc/pve/local/pve-ssl.pem',
			width: 12,
			default: '',
			isVisibleExpression: `$(options:tlsMode) == 'fingerprint'`,
		},
		...renameFields(guests),
	]
}
