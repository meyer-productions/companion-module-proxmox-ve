## Proxmox VE

Start, shut down, reboot and stop virtual machines (QEMU) and containers (LXC) on a Proxmox VE node or cluster, with live status for button feedbacks and variables.

### Create an API token (once, on any node)

Run on a Proxmox node shell (as root):

```
pveum role add Companion -privs "VM.Audit VM.PowerMgmt Sys.Audit"
pveum user add companion@pve --comment "Bitfocus Companion"
pveum aclmod / -user companion@pve -role Companion
pveum user token add companion@pve companion --privsep 1
pveum aclmod / -token 'companion@pve!companion' -role Companion
```

Copy the token secret shown by the `token add` command, it is only displayed once. To limit Companion to some guests, grant the role on a pool (`/pool/<name>`) or single guests (`/vms/<vmid>`) instead of `/`.

### Configuration

- **Nodes**: one or more nodes of the cluster, comma separated. Every node can control all guests, the module uses the first reachable node and fails over automatically.
- **API token ID**: `companion@pve!companion`
- **API token secret**: the UUID from above
- **TLS certificate check**:
  - _Pinned fingerprints_ (recommended): enter the SHA-256 fingerprint of each node's certificate (Node → System → Certificates → `pve-ssl.pem` → View Certificate).
  - _Verify_: only for publicly trusted certificates (e.g. ACME).
  - _Do not verify_: no protection against interception, test use only.

### Button names

Proxmox names like `icf02-OBS-Split` are often too long for a button. The connection settings list every VM/container under _Button names_ (after the first successful connection). Check **Rename** next to a guest and enter the name to show on the buttons. All presets show the name through the variable `vm_<vmid>_label`, so a change applies to every existing button immediately. Optional: `\n` in the name forces a line break.

### Presets

- **Cluster & nodes**: cluster overview (version, active node, running guests; press = refresh) and one tile per node (green online, red offline).
- **Per guest**: info tile (node, CPU, RAM, uptime, HA state, lock and running task) plus start, shutdown, reboot and stop buttons.
- Start/shutdown/reboot/stop buttons: icon on top, the status (RUNNING, STOPPED, REBOOT…) fixed at the bottom, the name in between, automatically split and scaled to fit.
- Colors: dark = stopped, green = running, amber = task running, dark red = HA problem.

### Actions

- **Start**, **Shutdown (clean)**, **Reboot (clean)**, **Stop (hard)**
- Guests are selected by VMID. The node is looked up on every press, so buttons keep working after an HA migration.
- HA managed guests: start/shutdown/stop set the HA requested state (like in the Proxmox UI). A guest stopped this way is not restarted by HA.
- **Stop (hard)** asks for a second press within 3 seconds by default (feedback _Hard stop armed_).

### Feedbacks

- **Guest button (complete look)**: advanced feedback used by the presets. Sets icon, fixed status band, scaled name and state color in one go; choose the icon (start, shutdown, reboot, stop, server).
- Boolean feedbacks for own designs: guest status (running/stopped), guest task running, guest HA problem (error/fence/recovery), hard stop armed, node online.

### Variables

Global: `connection_status`, `active_host`, `pve_version`, `guest_count`, `guest_running_count`, `last_poll_time`, `last_action_result`.

Per guest (e.g. VMID 101): `vm_101_name`, `vm_101_label`, `vm_101_info`, `vm_101_status`, `vm_101_node`, `vm_101_type`, `vm_101_uptime`, `vm_101_cpu`, `vm_101_mem`, `vm_101_hastate`, `vm_101_task`.

Per node: `node_<name>_status`.
