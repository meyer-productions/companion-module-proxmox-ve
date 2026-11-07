import {
	InstanceBase,
	InstanceStatus,
	type CompanionVariableValue,
	type DropdownChoice,
	type SomeCompanionConfigField,
} from '@companion-module/base'
import { GetConfigFields, displayNameFor, type ModuleConfig, type ModuleSecrets } from './config.js'
import { UpdateVariableDefinitions, guestVariableValues, slugify, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { singleLine } from './display-names.js'
import {
	ProxmoxClient,
	parseClusterResources,
	splitList,
	type ClusterNode,
	type Guest,
	type PowerAction,
	type ProxmoxResult,
} from './proxmox-client.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: ModuleSecrets
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

const STOP_ARM_MS = 3000
/** Tasks still "running" after this time are no longer tracked (e.g. module lost the node in between). */
const TASK_TRACKING_LIMIT_MS = 15 * 60 * 1000

type TrackedTask = {
	upid: string
	node: string
	action: PowerAction
	startedAt: number
	running: boolean
	result: string
}

/** The node that runs a task is the second field of its UPID ("UPID:<node>:..."). */
export function nodeFromUpid(upid: string): string {
	return upid.split(':')[1] ?? ''
}

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig
	secrets!: ModuleSecrets

	guests: Guest[] = []
	nodes: ClusterNode[] = []

	private client: ProxmoxClient | undefined
	private tasks = new Map<number, TrackedTask>()
	private armedStops = new Map<string, ReturnType<typeof setTimeout>>()
	private definitionSignature = ''
	private pveVersion = ''
	private lastActionResult = ''

	private pollTimer: ReturnType<typeof setTimeout> | undefined
	private pollChain: Promise<void> = Promise.resolve()
	/** Incremented on every config change and on destroy; work of an older generation discards its results. */
	private generation = 0
	private destroyed = false

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets): Promise<void> {
		this.updateDefinitions()
		await this.applyConfig(config, secrets)
	}

	async destroy(): Promise<void> {
		this.destroyed = true
		this.generation++
		this.stopPolling()
		for (const timer of this.armedStops.values()) clearTimeout(timer)
		this.armedStops.clear()
		await this.client?.close()
		this.client = undefined
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		await this.applyConfig(config, secrets)
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields(this.guests)
	}

	// ---------------------------------------------------------------- config / connection

	private async applyConfig(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		this.generation++
		this.stopPolling()

		const connectionChanged =
			!this.config ||
			config.hosts !== this.config.hosts ||
			config.port !== this.config.port ||
			config.tokenId !== this.config.tokenId ||
			secrets.tokenSecret !== this.secrets?.tokenSecret
		this.config = config
		this.secrets = secrets

		await this.client?.close()
		this.client = undefined

		if (connectionChanged) {
			// Guests of another cluster must not stay visible in dropdowns, presets or variables.
			this.guests = []
			this.nodes = []
			this.tasks.clear()
			this.pveVersion = ''
			this.updateDefinitions()
		}

		this.setVariableValues({
			connection_status: 'connecting',
			active_host: '',
			pve_version: this.pveVersion,
			last_action_result: this.lastActionResult,
		})

		const hosts = splitList(config.hosts ?? '')
		const fingerprints = splitList(config.fingerprints ?? '')
		const problems: string[] = []
		if (hosts.length === 0) problems.push('at least one node')
		if (!config.tokenId?.trim()) problems.push('the API token ID')
		if (!secrets.tokenSecret?.trim()) problems.push('the API token secret')
		if (config.tlsMode === 'fingerprint' && fingerprints.length === 0) problems.push('the certificate fingerprint(s)')
		if (problems.length > 0) {
			this.updateStatus(InstanceStatus.BadConfig, `Please configure ${problems.join(', ')}.`)
			this.setVariableValues({ connection_status: 'not configured' })
			return
		}

		this.client = new ProxmoxClient({
			hosts,
			port: config.port || 8006,
			tokenId: config.tokenId.trim(),
			tokenSecret: secrets.tokenSecret.trim(),
			tlsMode: config.tlsMode ?? 'fingerprint',
			fingerprints,
		})
		this.updateStatus(InstanceStatus.Connecting)

		await this.poll()
		this.schedulePoll()
	}

	// ---------------------------------------------------------------- polling

	private stopPolling(): void {
		if (this.pollTimer) clearTimeout(this.pollTimer)
		this.pollTimer = undefined
	}

	private schedulePoll(): void {
		this.stopPolling()
		if (this.destroyed || !this.client) return
		const generation = this.generation
		const intervalMs = Math.max(1, Number(this.config.pollInterval) || 3) * 1000
		this.pollTimer = setTimeout(() => {
			void this.poll().finally(() => {
				if (generation === this.generation) this.schedulePoll()
			})
		}, intervalMs)
	}

	/** Polls the cluster once. Polls never overlap; they run one after another. */
	async poll(): Promise<void> {
		const generation = this.generation
		this.pollChain = this.pollChain
			.then(async () => this.doPoll(generation))
			.catch((err: unknown) => this.log('error', `Poll failed: ${err instanceof Error ? err.message : String(err)}`))
		return this.pollChain
	}

	private async doPoll(generation: number): Promise<void> {
		const client = this.client
		if (!client || generation !== this.generation) return

		const result = await client.getClusterResources()
		if (generation !== this.generation) return
		if (result.outcome !== 'ok') {
			this.handleRequestFailure(result)
			return
		}

		const { guests, nodes } = parseClusterResources(result.data)
		for (const guest of guests) guest.label = displayNameFor(guest, this.config)
		this.guests = guests
		this.nodes = nodes

		if (!this.pveVersion) {
			const version = await client.getVersion()
			if (generation !== this.generation) return
			if (version.outcome === 'ok') this.pveVersion = version.data.version
		}

		await this.pollTasks(client, generation)
		if (generation !== this.generation) return

		const signature = JSON.stringify([guests.map((g) => [g.vmid, g.label, g.type]), nodes.map((n) => n.name)])
		if (signature !== this.definitionSignature) {
			this.definitionSignature = signature
			this.updateDefinitions()
		}

		this.publishVariables(result.host)

		if (client.failedHosts.size > 0) {
			const failed = [...client.failedHosts.keys()].join(', ')
			this.updateStatus(InstanceStatus.UnknownWarning, `Using ${result.host}; not reachable: ${failed}`)
		} else {
			this.updateStatus(InstanceStatus.Ok)
		}
		this.checkFeedbacks('guestButton', 'guestStatus', 'guestTaskRunning', 'guestHaError', 'nodeOnline')
	}

	private async pollTasks(client: ProxmoxClient, generation: number): Promise<void> {
		for (const [vmid, task] of this.tasks) {
			if (!task.running) continue
			if (Date.now() - task.startedAt > TASK_TRACKING_LIMIT_MS) {
				task.running = false
				task.result = `${task.action}: unknown (no longer tracked)`
				continue
			}
			const status = await client.getTaskStatus(task.node, task.upid)
			if (generation !== this.generation) return
			if (status.outcome !== 'ok' || status.data.status === 'running') continue

			task.running = false
			const ok = status.data.exitstatus === 'OK'
			task.result = ok ? `${task.action}: OK` : `${task.action}: ${status.data.exitstatus ?? 'failed'}`
			const name = this.findGuest(String(vmid))?.name ?? String(vmid)
			this.setLastActionResult(`${task.action} ${name}: ${ok ? 'OK' : (status.data.exitstatus ?? 'failed')}`)
			if (!ok) this.log('warn', `Task ${task.action} of ${name} (${vmid}) ended with: ${status.data.exitstatus}`)
		}
	}

	private handleRequestFailure(result: Exclude<ProxmoxResult<unknown>, { outcome: 'ok' }>): void {
		const status =
			result.outcome === 'unauthorized' || result.outcome === 'forbidden'
				? InstanceStatus.AuthenticationFailure
				: result.outcome === 'unreachable'
					? InstanceStatus.ConnectionFailure
					: InstanceStatus.UnknownError
		this.updateStatus(status, result.message)
		this.setVariableValues({ connection_status: result.outcome, active_host: '' })
		this.log('debug', `Poll failed (${result.outcome}): ${result.message}`)
	}

	private publishVariables(activeHost: string): void {
		const values: Record<string, CompanionVariableValue> = {
			connection_status: 'ok',
			active_host: activeHost,
			pve_version: this.pveVersion,
			guest_count: this.guests.length,
			guest_running_count: this.guests.filter((g) => g.status === 'running').length,
			last_poll_time: new Date().toLocaleTimeString(),
		}
		for (const guest of this.guests) {
			const task = this.tasks.get(guest.vmid)
			const taskText = task ? (task.running ? `${task.action}…` : task.result) : ''
			Object.assign(values, guestVariableValues(guest, taskText, task?.running ? `${task.action}…` : ''))
		}
		for (const node of this.nodes) {
			values[`node_${slugify(node.name)}_status`] = node.status
		}
		this.setVariableValues(values)
	}

	private setLastActionResult(text: string): void {
		this.lastActionResult = text
		this.setVariableValues({ last_action_result: text })
	}

	private updateDefinitions(): void {
		UpdateActions(this)
		UpdateFeedbacks(this)
		UpdatePresets(this)
		UpdateVariableDefinitions(this)
	}

	// ---------------------------------------------------------------- helpers for actions/feedbacks

	getGuestChoices(): DropdownChoice[] {
		return this.guests.map((guest) => ({
			id: String(guest.vmid),
			label: `${singleLine(guest.label)} (${guest.vmid}${guest.type === 'lxc' ? ', CT' : ''})`,
		}))
	}

	findGuest(vmid: string): Guest | undefined {
		const id = Number.parseInt(vmid, 10)
		return Number.isFinite(id) ? this.guests.find((guest) => guest.vmid === id) : undefined
	}

	getRunningTaskAction(vmid: string): PowerAction | undefined {
		const task = this.tasks.get(Number.parseInt(vmid, 10))
		return task?.running ? task.action : undefined
	}

	hasRunningTask(vmid: string): boolean {
		return this.tasks.get(Number.parseInt(vmid, 10))?.running === true
	}

	isStopArmed(vmid: string): boolean {
		return this.armedStops.has(vmid)
	}

	armStop(vmid: string): void {
		const existing = this.armedStops.get(vmid)
		if (existing) clearTimeout(existing)
		this.armedStops.set(
			vmid,
			setTimeout(() => {
				this.armedStops.delete(vmid)
				this.checkFeedbacks('stopArmed', 'guestButton')
			}, STOP_ARM_MS),
		)
		this.checkFeedbacks('stopArmed', 'guestButton')
	}

	/** Returns true (and disarms) if a stop for this guest was armed. */
	consumeStopArm(vmid: string): boolean {
		const timer = this.armedStops.get(vmid)
		if (!timer) return false
		clearTimeout(timer)
		this.armedStops.delete(vmid)
		this.checkFeedbacks('stopArmed', 'guestButton')
		return true
	}

	async runPowerAction(vmid: string, action: PowerAction, params: Record<string, string | number> = {}): Promise<void> {
		const client = this.client
		if (!client) {
			this.log('warn', `${action}: module is not configured`)
			return
		}

		let guest = this.findGuest(vmid)
		if (!guest) {
			// Guest may be new or moved since the last poll; refresh once before giving up.
			await this.poll()
			guest = this.findGuest(vmid)
		}
		if (!guest) {
			this.setLastActionResult(`${action} ${vmid}: guest not found`)
			this.log('warn', `${action}: no VM/container with VMID "${vmid}" found`)
			return
		}

		// The node is always resolved from the latest poll, never stored in the button (HA can move guests).
		const result = await client.powerAction(guest, action, params)
		if (result.outcome !== 'ok') {
			this.setLastActionResult(`${action} ${guest.name}: ${result.message}`)
			this.log('error', `${action} ${guest.name} (${guest.vmid}) failed: ${result.message}`)
			return
		}

		const upid = result.data
		this.tasks.set(guest.vmid, {
			upid,
			node: nodeFromUpid(upid) || guest.node,
			action,
			startedAt: Date.now(),
			running: true,
			result: '',
		})
		this.setLastActionResult(`${action} ${guest.name}: started`)
		this.log('info', `${action} ${guest.name} (${guest.vmid}) on ${guest.node}: ${upid}`)
		this.setVariableValues(guestVariableValues(guest, `${action}…`, `${action}…`))
		this.checkFeedbacks('guestButton', 'guestTaskRunning')
	}
}
