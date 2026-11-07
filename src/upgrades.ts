import type {
	CompanionStaticUpgradeProps,
	CompanionStaticUpgradeResult,
	CompanionStaticUpgradeScript,
	CompanionUpgradeContext,
} from '@companion-module/base'
import { nameKey, renameKey, type ModuleConfig, type ModuleSecrets } from './config.js'

/**
 * 0.1.2 -> 0.1.3: the free text field "displayNames" ("101 = OBS Split", one per line) was replaced by one
 * "Rename" checkbox + name field per guest. Entries by VMID are converted; entries by Proxmox name cannot be
 * mapped without the cluster (unknown at upgrade time) and have to be set again in the new fields.
 */
export function migrateDisplayNames(config: ModuleConfig & { displayNames?: string }): boolean {
	if (typeof config.displayNames !== 'string') return false
	for (const rawLine of config.displayNames.split(/\r?\n|;/)) {
		const line = rawLine.trim()
		const separator = line.indexOf('=')
		if (line.startsWith('#') || separator <= 0) continue
		const key = line.slice(0, separator).trim()
		const name = line.slice(separator + 1).trim()
		if (!/^\d+$/.test(key) || !name) continue
		config[renameKey(Number(key))] = true
		config[nameKey(Number(key))] = name
	}
	delete config.displayNames
	return true
}

/** Upgrade scripts are only appended, never removed or reordered. */
export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig, ModuleSecrets>[] = [
	(
		_context: CompanionUpgradeContext<ModuleConfig>,
		{ config }: CompanionStaticUpgradeProps<ModuleConfig, ModuleSecrets>,
	): CompanionStaticUpgradeResult<ModuleConfig, ModuleSecrets> => {
		const changed = config ? migrateDisplayNames(config) : false
		return { updatedConfig: changed ? config : null, updatedActions: [], updatedFeedbacks: [] }
	},
]
