import type ModuleInstance from './main.js'
import { guestField } from './actions.js'
import { HA_PROBLEM_STATES, guestButtonStyle } from './guest-button.js'
import type { ButtonBadge } from './button-images.js'

export type FeedbacksSchema = {
	guestButton: { type: 'advanced'; options: { vmid: string; badge: string } }
	guestStatus: { type: 'boolean'; options: { vmid: string; state: string } }
	guestTaskRunning: { type: 'boolean'; options: { vmid: string } }
	guestHaError: { type: 'boolean'; options: { vmid: string } }
	stopArmed: { type: 'boolean'; options: { vmid: string } }
	nodeOnline: { type: 'boolean'; options: { node: string } }
}

const BADGES: ButtonBadge[] = ['start', 'shutdown', 'reboot', 'stop', 'server']

export function UpdateFeedbacks(self: ModuleInstance): void {
	const nodeChoices = self.nodes.map((node) => ({ id: node.name, label: node.name }))

	self.setFeedbackDefinitions({
		guestButton: {
			type: 'advanced',
			name: 'Guest button (complete look)',
			description:
				'Sets the whole button: icon on top, status fixed at the bottom, the (display) name scaled to fit ' +
				'in between, and the background color of the current state.',
			options: [
				guestField(self),
				{
					type: 'dropdown',
					id: 'badge',
					label: 'Icon',
					choices: [
						{ id: 'start', label: 'Start' },
						{ id: 'shutdown', label: 'Shutdown' },
						{ id: 'reboot', label: 'Reboot' },
						{ id: 'stop', label: 'Stop (shows "press again" while armed)' },
						{ id: 'server', label: 'Server (status only)' },
					],
					default: 'server',
				},
			],
			callback: (feedback) => {
				const vmid = String(feedback.options.vmid)
				const badge = BADGES.find((b) => b === feedback.options.badge) ?? 'server'
				return guestButtonStyle({
					guest: self.findGuest(vmid),
					badge,
					runningTask: self.getRunningTaskAction(vmid),
					stopArmed: self.isStopArmed(vmid),
				})
			},
		},
		guestStatus: {
			type: 'boolean',
			name: 'Guest status',
			description: 'Active while the VM/container is in the selected state',
			defaultStyle: { bgcolor: 0x1b5e20, color: 0xffffff },
			options: [
				guestField(self),
				{
					type: 'dropdown',
					id: 'state',
					label: 'State',
					choices: [
						{ id: 'running', label: 'Running' },
						{ id: 'stopped', label: 'Stopped' },
					],
					default: 'running',
				},
			],
			callback: (feedback) => {
				const guest = self.findGuest(String(feedback.options.vmid))
				return guest !== undefined && guest.status === feedback.options.state
			},
		},
		guestTaskRunning: {
			type: 'boolean',
			name: 'Guest task running',
			description: 'Active while a start/shutdown/reboot/stop task triggered by this module is still running',
			defaultStyle: { bgcolor: 0x9a6700, color: 0xffffff },
			options: [guestField(self)],
			callback: (feedback) => self.hasRunningTask(String(feedback.options.vmid)),
		},
		guestHaError: {
			type: 'boolean',
			name: 'Guest HA problem',
			description: 'Active while an HA managed guest is in state error, fence or recovery',
			defaultStyle: { bgcolor: 0x7f0000, color: 0xffffff },
			options: [guestField(self)],
			callback: (feedback) => HA_PROBLEM_STATES.has(self.findGuest(String(feedback.options.vmid))?.hastate ?? ''),
		},
		stopArmed: {
			type: 'boolean',
			name: 'Hard stop armed',
			description: 'Active for 3 seconds after the first press of a "Stop (hard)" action with confirmation',
			defaultStyle: { bgcolor: 0xd50000, color: 0xffffff },
			options: [guestField(self)],
			callback: (feedback) => self.isStopArmed(String(feedback.options.vmid)),
		},
		nodeOnline: {
			type: 'boolean',
			name: 'Node online',
			description: 'Active while the cluster node is online',
			defaultStyle: { bgcolor: 0x1b5e20, color: 0xffffff },
			options: [
				{
					type: 'dropdown',
					id: 'node',
					label: 'Node',
					choices: nodeChoices,
					default: nodeChoices[0]?.id ?? '',
					allowCustom: true,
				},
			],
			callback: (feedback) =>
				self.nodes.find((node) => node.name === String(feedback.options.node))?.status === 'online',
		},
	})
}
