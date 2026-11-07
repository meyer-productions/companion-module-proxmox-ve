import type {
	CompanionButtonStyleProps,
	CompanionPresetDefinitions,
	CompanionPresetSection,
} from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'
import type { ButtonBadge } from './button-images.js'
import { Icons } from './icons.js'
import { singleLine } from './display-names.js'
import { Colors, guestButtonStyle } from './guest-button.js'
import type { Guest } from './proxmox-client.js'
import { slugify } from './variables.js'

/** Node tile: small badge on top, two short lines of text below. */
function nodeStyle(text: string): CompanionButtonStyleProps {
	return {
		text,
		size: 10,
		color: Colors.white,
		bgcolor: Colors.idle,
		alignment: 'center:bottom',
		png64: Icons.server,
		pngalignment: 'center:top',
	}
}

/** Information tile: no icon and no top bar, so the whole button is available for text. */
function infoStyle(text: string): CompanionButtonStyleProps {
	return {
		text,
		size: 8,
		color: Colors.white,
		bgcolor: Colors.idle,
		alignment: 'center:center',
		show_topbar: false,
	}
}

/**
 * Base style of an action button. The "guestButton" feedback replaces all of it at runtime (image with fixed
 * status band, scaled name, state color); this is only the look in the preset list and before the first poll.
 */
function guestButtonBase(guest: Guest, badge: ButtonBadge): CompanionButtonStyleProps {
	const style = guestButtonStyle({ guest, badge, runningTask: undefined, stopArmed: false })
	return {
		text: style.text ?? '',
		size: style.size ?? 10,
		color: Colors.white,
		bgcolor: style.bgcolor ?? Colors.idle,
		alignment: 'center:center',
		png64: style.png64,
		pngalignment: 'center:center',
		show_topbar: false,
	}
}

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const sections: CompanionPresetSection<ModuleSchema>[] = []
	const v = (name: string): string => `$(${self.label}:${name})`

	// ------------------------------------------------------------- cluster overview and nodes
	const clusterIds: string[] = []
	presets.cluster_overview = {
		type: 'simple',
		name: 'Cluster overview (press = refresh)',
		style: infoStyle(
			`Proxmox ${v('pve_version')}\nvia ${v('active_host')}\n\nRunning\n${v('guest_running_count')} / ${v('guest_count')}`,
		),
		steps: [{ down: [{ actionId: 'refresh', options: {} }], up: [] }],
		feedbacks: [],
	}
	clusterIds.push('cluster_overview')

	for (const node of self.nodes) {
		const id = `node_${slugify(node.name)}`
		presets[id] = {
			type: 'simple',
			name: `Node: ${node.name}`,
			style: nodeStyle(`${node.name}\n${v(`node_${slugify(node.name)}_status`)}`),
			steps: [{ down: [], up: [] }],
			feedbacks: [
				{ feedbackId: 'nodeOnline', options: { node: node.name }, style: { bgcolor: Colors.running } },
				{
					feedbackId: 'nodeOnline',
					options: { node: node.name },
					style: { bgcolor: Colors.problem },
					isInverted: true,
				},
			],
		}
		clusterIds.push(id)
	}
	sections.push({ id: 'cluster', name: 'Cluster & nodes', definitions: clusterIds })

	// ------------------------------------------------------------- per guest
	for (const guest of self.guests) {
		const vmid = String(guest.vmid)
		const title = `${singleLine(guest.label)} (${vmid})`
		const ids: string[] = []

		presets[`status_${vmid}`] = {
			type: 'simple',
			name: `${title}: info tile`,
			// Name comes from a variable, so a changed display name updates existing buttons immediately.
			style: infoStyle(`${v(`vm_${vmid}_label`)}\n${v(`vm_${vmid}_info`)}`),
			steps: [{ down: [], up: [] }],
			feedbacks: [
				{ feedbackId: 'guestStatus', options: { vmid, state: 'running' }, style: { bgcolor: Colors.running } },
				{ feedbackId: 'guestTaskRunning', options: { vmid }, style: { bgcolor: Colors.task } },
				{ feedbackId: 'guestHaError', options: { vmid }, style: { bgcolor: Colors.problem } },
			],
		}
		ids.push(`status_${vmid}`)

		const addAction = (badge: Exclude<ButtonBadge, 'server'>, name: string): void => {
			const id = `${badge}_${vmid}`
			const action =
				badge === 'shutdown'
					? { actionId: 'shutdown' as const, options: { vmid, timeout: 0, forceStop: false } }
					: badge === 'stop'
						? { actionId: 'stop' as const, options: { vmid, confirm: true } }
						: { actionId: badge, options: { vmid } }
			presets[id] = {
				type: 'simple',
				name: `${title}: ${name}`,
				style: guestButtonBase(guest, badge),
				steps: [{ down: [action], up: [] }],
				feedbacks: [{ feedbackId: 'guestButton', options: { vmid, badge } }],
			}
			ids.push(id)
		}
		addAction('start', 'start')
		addAction('shutdown', 'shutdown')
		addAction('reboot', 'reboot')
		addAction('stop', 'stop (hard, press twice)')

		sections.push({ id: `guest_${vmid}`, name: title, definitions: ids })
	}

	self.setPresetDefinitions(sections, presets)
}
