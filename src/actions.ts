import type { CompanionInputFieldDropdown } from '@companion-module/base'
import type ModuleInstance from './main.js'

export type ActionsSchema = {
	start: { options: { vmid: string } }
	shutdown: { options: { vmid: string; timeout: number; forceStop: boolean } }
	reboot: { options: { vmid: string } }
	stop: { options: { vmid: string; confirm: boolean } }
	refresh: { options: Record<string, never> }
}

export function guestField(self: ModuleInstance): CompanionInputFieldDropdown<'vmid'> {
	const choices = self.getGuestChoices()
	return {
		type: 'dropdown',
		id: 'vmid',
		label: 'VM / container',
		tooltip: 'Selected by VMID, so it keeps working when HA moves the guest to another node.',
		choices,
		default: choices[0]?.id ?? '',
		allowCustom: true,
		regex: '/^\\d+$/',
		minChoicesForSearch: 1,
	}
}

export function UpdateActions(self: ModuleInstance): void {
	self.setActionDefinitions({
		start: {
			name: 'Start',
			description: 'Starts the VM/container (HA managed guests: requests state "started")',
			options: [guestField(self)],
			callback: async (action) => {
				await self.runPowerAction(String(action.options.vmid), 'start')
			},
		},
		shutdown: {
			name: 'Shutdown (clean)',
			description: 'Shuts the guest down via ACPI / guest agent (HA managed guests: requests state "stopped")',
			options: [
				guestField(self),
				{
					type: 'number',
					id: 'timeout',
					label: 'Timeout (seconds, 0 = Proxmox default)',
					min: 0,
					max: 3600,
					default: 0,
				},
				{
					type: 'checkbox',
					id: 'forceStop',
					label: 'Hard stop if the timeout is reached',
					default: false,
				},
			],
			callback: async (action) => {
				const params: Record<string, number> = {}
				const timeout = Number(action.options.timeout)
				if (timeout > 0) params.timeout = Math.round(timeout)
				if (action.options.forceStop) params.forceStop = 1
				await self.runPowerAction(String(action.options.vmid), 'shutdown', params)
			},
		},
		reboot: {
			name: 'Reboot (clean)',
			description: 'Reboots the guest via ACPI / guest agent',
			options: [guestField(self)],
			callback: async (action) => {
				await self.runPowerAction(String(action.options.vmid), 'reboot')
			},
		},
		stop: {
			name: 'Stop (hard)',
			description:
				'Stops the guest immediately, like pulling the power plug. With confirmation the first press only arms ' +
				'the action, a second press within 3 seconds executes it.',
			options: [
				guestField(self),
				{
					type: 'checkbox',
					id: 'confirm',
					label: 'Require second press within 3 seconds',
					default: true,
				},
			],
			callback: async (action) => {
				const vmid = String(action.options.vmid)
				if (action.options.confirm && !self.consumeStopArm(vmid)) {
					self.armStop(vmid)
					return
				}
				await self.runPowerAction(vmid, 'stop')
			},
		},
		refresh: {
			name: 'Refresh status',
			description: 'Polls the cluster immediately and updates dropdowns, presets and variables',
			options: [],
			callback: async () => {
				await self.poll()
			},
		},
	})
}
