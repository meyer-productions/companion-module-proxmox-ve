/**
 * Schreibgeschützter Smoke-Test gegen einen echten Proxmox-Cluster (nur GET-Requests, keine Power-Aktionen).
 * Aufruf: yarn smoke  (liest PVE_* aus .env, siehe .env.example). Das Token-Secret wird nie ausgegeben.
 *
 * 1. Zeigt die SHA-256-Fingerprints aller Nodes (zum Eintragen in PVE_FINGERPRINTS bzw. die Modul-Konfiguration).
 *    Fingerprints vor dem Übernehmen mit der Proxmox-GUI vergleichen (Node → System → Certificates).
 * 2. Liest Version, Nodes und alle VMs/Container über das Modul-Client-Objekt (inkl. Failover).
 */
import tls from 'node:tls'
import { ProxmoxClient, parseClusterResources, splitList, type TlsMode } from '../src/proxmox-client.js'

const hosts = splitList(process.env.PVE_HOSTS ?? '')
const port = Number(process.env.PVE_PORT ?? 8006)
const tokenId = process.env.PVE_TOKEN_ID?.trim() ?? ''
const tokenSecret = process.env.PVE_TOKEN_SECRET?.trim() ?? ''
const tlsMode = (process.env.PVE_TLS_MODE?.trim() || 'fingerprint') as TlsMode
const fingerprints = splitList(process.env.PVE_FINGERPRINTS ?? '')

if (hosts.length === 0) throw new Error('PVE_HOSTS fehlt (.env)')

async function readFingerprint(host: string): Promise<string> {
	return new Promise((resolve) => {
		const socket = tls.connect({ host, port, rejectUnauthorized: false, timeout: 4000 }, () => {
			const cert = socket.getPeerCertificate()
			resolve(`${cert.fingerprint256}  (CN=${String(cert.subject?.CN ?? '?')}, gültig bis ${cert.valid_to})`)
			socket.end()
		})
		socket.on('timeout', () => {
			socket.destroy()
			resolve('Timeout')
		})
		socket.on('error', (err) => resolve(`Fehler: ${err.message}`))
	})
}

async function main(): Promise<void> {
	console.log('Zertifikat-Fingerprints (SHA-256):')
	for (const host of hosts) console.log(`  ${host}: ${await readFingerprint(host)}`)

	if (!tokenId || !tokenSecret) {
		console.log('\nPVE_TOKEN_ID/PVE_TOKEN_SECRET fehlen - API-Test übersprungen.')
		return
	}
	if (tlsMode === 'fingerprint' && fingerprints.length === 0) {
		console.log('\nPVE_FINGERPRINTS leer - Fingerprints oben prüfen und eintragen, dann erneut ausführen.')
		return
	}

	const client = new ProxmoxClient({ hosts, port, tokenId, tokenSecret, tlsMode, fingerprints })

	const version = await client.getVersion()
	if (version.outcome !== 'ok') {
		console.log(`\nAPI-Fehler (${version.outcome}): ${version.message}`)
		await client.close()
		process.exitCode = 1
		return
	}
	console.log(`\nProxmox VE ${version.data.version} (Release ${version.data.release}) via ${version.host}`)

	const resources = await client.getClusterResources()
	if (resources.outcome !== 'ok') {
		console.log(`/cluster/resources fehlgeschlagen (${resources.outcome}): ${resources.message}`)
	} else {
		const { guests, nodes } = parseClusterResources(resources.data)
		console.log(`\nNodes (${nodes.length}):`)
		for (const node of nodes) console.log(`  ${node.name.padEnd(16)} ${node.status}`)
		console.log(`\nVMs/Container (${guests.length}):`)
		for (const g of guests) {
			console.log(
				`  ${String(g.vmid).padEnd(6)} ${g.type.padEnd(5)} ${g.status.padEnd(8)} ${g.node.padEnd(12)} ` +
					`ha=${(g.hastate || '-').padEnd(8)} ${g.name}`,
			)
		}
		if (guests.length === 0) console.log('  (keine sichtbar - fehlt VM.Audit für das Token?)')
	}

	if (client.failedHosts.size > 0) {
		console.log('\nNicht erreichbare Nodes:')
		for (const [host, message] of client.failedHosts) console.log(`  ${host}: ${message}`)
	}
	await client.close()
}

await main()
