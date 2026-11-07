import type { TLSSocket } from 'node:tls'
import { Agent, buildConnector, request } from 'undici'

const REQUEST_TIMEOUT_MS = 8000
const CONNECT_TIMEOUT_MS = 4000

export type TlsMode = 'fingerprint' | 'verify' | 'insecure'

export type ProxmoxClientConfig = {
	/** One or more nodes of the same cluster, tried in this order (failover). */
	hosts: string[]
	port: number
	/** Full token ID, e.g. "companion@pve!companion". */
	tokenId: string
	tokenSecret: string
	tlsMode: TlsMode
	/** Accepted SHA-256 certificate fingerprints (any format, see normalizeFingerprint). Only used in "fingerprint" mode. */
	fingerprints: string[]
}

export type GuestType = 'qemu' | 'lxc'
export type PowerAction = 'start' | 'shutdown' | 'reboot' | 'stop'

/** Entry of GET /cluster/resources (only the fields this module uses). */
export type ClusterResource = {
	id: string
	type: string
	node?: string
	status?: string
	vmid?: number
	name?: string
	template?: number
	hastate?: string
	lock?: string
	uptime?: number
	cpu?: number
	maxcpu?: number
	mem?: number
	maxmem?: number
}

export type Guest = {
	vmid: number
	type: GuestType
	name: string
	/** Display name for buttons (alias from the config, falls back to the Proxmox name). */
	label: string
	node: string
	/** "running" | "stopped" | ... as reported by Proxmox. */
	status: string
	/** HA state for HA managed guests ("started", "stopped", "error", ...), empty otherwise. */
	hastate: string
	lock: string
	uptime: number
	cpu: number
	mem: number
	maxmem: number
}

export type ClusterNode = {
	name: string
	status: string
}

export type TaskStatus = {
	status: 'running' | 'stopped' | string
	exitstatus?: string
}

export type ProxmoxResult<T> =
	| { outcome: 'ok'; data: T; host: string }
	| { outcome: 'unauthorized'; message: string }
	| { outcome: 'forbidden'; message: string }
	| { outcome: 'unreachable'; message: string }
	| { outcome: 'error'; message: string; status?: number }

/** Normalizes "AA:BB:cc..." or "aabbcc..." into lower case hex without separators. */
export function normalizeFingerprint(value: string): string {
	return value.toLowerCase().replace(/[^0-9a-f]/g, '')
}

/** Splits a comma/space/semicolon separated list into trimmed, non-empty entries. */
export function splitList(value: string): string[] {
	return value
		.split(/[,;\s]+/)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
}

export class FingerprintMismatchError extends Error {
	constructor(
		readonly host: string,
		readonly fingerprint: string,
	) {
		super(`TLS fingerprint of ${host} is not in the list of accepted fingerprints (got ${fingerprint})`)
		this.name = 'FingerprintMismatchError'
	}
}

/**
 * Builds the undici dispatcher for the configured TLS mode. Proxmox nodes use a certificate signed by the
 * cluster-internal CA by default, so "verify" only works with ACME/public certificates. "fingerprint" pins
 * the certificate of every node instead (each node has its own certificate, so a list is accepted).
 */
export function createDispatcher(config: Pick<ProxmoxClientConfig, 'tlsMode' | 'fingerprints'>): Agent {
	if (config.tlsMode === 'verify') {
		return new Agent({ connect: { timeout: CONNECT_TIMEOUT_MS } })
	}
	if (config.tlsMode === 'insecure') {
		return new Agent({ connect: { rejectUnauthorized: false, timeout: CONNECT_TIMEOUT_MS } })
	}

	const accepted = new Set(config.fingerprints.map(normalizeFingerprint).filter((fp) => fp.length > 0))
	// No TLS session resumption: a resumed session carries no peer certificate, which would fail the pin check.
	const baseConnector = buildConnector({ rejectUnauthorized: false, timeout: CONNECT_TIMEOUT_MS, maxCachedSessions: 0 })
	const pinningConnector: buildConnector.connector = (options, callback) => {
		baseConnector(options, (err, socket) => {
			if (err) {
				callback(err, null)
				return
			}
			const fingerprint = (socket as TLSSocket).getPeerCertificate().fingerprint256 ?? ''
			if (!accepted.has(normalizeFingerprint(fingerprint))) {
				socket.destroy()
				callback(new FingerprintMismatchError(options.hostname, fingerprint), null)
				return
			}
			callback(null, socket)
		})
	}
	return new Agent({ connect: pinningConnector })
}

const CONNECT_ERROR_CODES = new Set([
	'ECONNREFUSED',
	'ECONNRESET',
	'EHOSTUNREACH',
	'ENETUNREACH',
	'ENOTFOUND',
	'EAI_AGAIN',
	'ETIMEDOUT',
	'UND_ERR_CONNECT_TIMEOUT',
	'UND_ERR_SOCKET',
])

function errorCode(err: unknown): string {
	if (err && typeof err === 'object') {
		const code = (err as { code?: unknown }).code
		if (typeof code === 'string') return code
		const cause = (err as { cause?: unknown }).cause
		if (cause) return errorCode(cause)
	}
	return ''
}

/** True if the request certainly never reached the API (safe to repeat on another node, even for POST). */
export function isConnectError(err: unknown): boolean {
	if (err instanceof FingerprintMismatchError) return true
	if (err && typeof err === 'object' && (err as { cause?: unknown }).cause instanceof FingerprintMismatchError)
		return true
	return CONNECT_ERROR_CODES.has(errorCode(err))
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) {
		const cause = (err as { cause?: unknown }).cause
		return cause instanceof Error && cause.message !== err.message ? `${err.message} (${cause.message})` : err.message
	}
	return String(err)
}

/** Converts the raw /cluster/resources list into guests (no templates) and nodes. */
export function parseClusterResources(resources: ClusterResource[]): { guests: Guest[]; nodes: ClusterNode[] } {
	const guests: Guest[] = []
	const nodes: ClusterNode[] = []
	for (const res of resources) {
		if (res.type === 'node' && res.node) {
			nodes.push({ name: res.node, status: res.status ?? 'unknown' })
		} else if ((res.type === 'qemu' || res.type === 'lxc') && typeof res.vmid === 'number' && !res.template) {
			const name = res.name ?? `${res.type === 'qemu' ? 'VM' : 'CT'} ${res.vmid}`
			guests.push({
				vmid: res.vmid,
				type: res.type,
				name,
				label: name,
				node: res.node ?? '',
				status: res.status ?? 'unknown',
				hastate: res.hastate ?? '',
				lock: res.lock ?? '',
				uptime: res.uptime ?? 0,
				cpu: res.cpu ?? 0,
				mem: res.mem ?? 0,
				maxmem: res.maxmem ?? 0,
			})
		}
	}
	guests.sort((a, b) => a.vmid - b.vmid)
	nodes.sort((a, b) => a.name.localeCompare(b.name))
	return { guests, nodes }
}

/**
 * Minimal Proxmox VE API client with API token authentication and failover across several cluster nodes.
 * Every node answers for the whole cluster (requests for guests on other nodes are proxied internally),
 * so the client simply sticks to the last working node and moves on when it becomes unreachable.
 */
export class ProxmoxClient {
	private readonly dispatcher: Agent
	private activeIndex = 0
	/** Hosts that failed on their last attempt (host -> error message). */
	readonly failedHosts = new Map<string, string>()

	constructor(private readonly config: ProxmoxClientConfig) {
		this.dispatcher = createDispatcher(config)
	}

	get activeHost(): string {
		return this.config.hosts[this.activeIndex] ?? ''
	}

	async close(): Promise<void> {
		await this.dispatcher.close().catch(() => undefined)
	}

	async getClusterResources(): Promise<ProxmoxResult<ClusterResource[]>> {
		return this.request<ClusterResource[]>('GET', '/cluster/resources')
	}

	async getVersion(): Promise<ProxmoxResult<{ version: string; release: string }>> {
		return this.request('GET', '/version')
	}

	/** Sends a power action; returns the task UPID. */
	async powerAction(
		guest: Pick<Guest, 'node' | 'type' | 'vmid'>,
		action: PowerAction,
		params: Record<string, string | number> = {},
	): Promise<ProxmoxResult<string>> {
		const path = `/nodes/${encodeURIComponent(guest.node)}/${guest.type}/${guest.vmid}/status/${action}`
		return this.request<string>('POST', path, params)
	}

	async getTaskStatus(node: string, upid: string): Promise<ProxmoxResult<TaskStatus>> {
		return this.request<TaskStatus>(
			'GET',
			`/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
		)
	}

	private async request<T>(
		method: 'GET' | 'POST',
		path: string,
		params?: Record<string, string | number>,
	): Promise<ProxmoxResult<T>> {
		const hosts = this.config.hosts
		if (hosts.length === 0) return { outcome: 'error', message: 'No host configured' }

		let lastError = ''
		for (let attempt = 0; attempt < hosts.length; attempt++) {
			const index = (this.activeIndex + attempt) % hosts.length
			const host = hosts[index]
			const url = `https://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${this.config.port}/api2/json${path}`
			const body = params
				? new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)])).toString()
				: undefined

			try {
				const response = await request(url, {
					method,
					dispatcher: this.dispatcher,
					headers: {
						authorization: `PVEAPIToken=${this.config.tokenId}=${this.config.tokenSecret}`,
						accept: 'application/json',
						...(body !== undefined ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
					},
					body,
					headersTimeout: REQUEST_TIMEOUT_MS,
					bodyTimeout: REQUEST_TIMEOUT_MS,
				})

				this.failedHosts.delete(host)
				this.activeIndex = index
				const text = await response.body.text()

				if (response.statusCode === 401) {
					return { outcome: 'unauthorized', message: 'Authentication failed (check token ID and secret)' }
				}
				if (response.statusCode === 403) {
					return { outcome: 'forbidden', message: `Permission denied for ${method} ${path}` }
				}
				if (response.statusCode >= 400) {
					// Proxmox puts the reason into the HTTP status text and sometimes into "errors"/"message".
					let detail = ''
					try {
						const parsed = JSON.parse(text) as { message?: string; errors?: Record<string, string> }
						detail = parsed.message ?? (parsed.errors ? Object.values(parsed.errors).join('; ') : '')
					} catch {
						detail = text.slice(0, 200)
					}
					return {
						outcome: 'error',
						status: response.statusCode,
						message: `HTTP ${response.statusCode}${detail ? `: ${detail.trim()}` : ''}`,
					}
				}

				const parsed = JSON.parse(text) as { data: T }
				return { outcome: 'ok', data: parsed.data, host }
			} catch (err) {
				lastError = `${host}: ${errorMessage(err)}`
				this.failedHosts.set(host, errorMessage(err))
				// GET is always safe to repeat. A POST is only repeated if it certainly never reached the node,
				// otherwise a timeout after sending could trigger the same power action twice.
				if (method === 'POST' && !isConnectError(err)) {
					return { outcome: 'error', message: lastError }
				}
			}
		}
		return { outcome: 'unreachable', message: lastError || 'No node reachable' }
	}
}
