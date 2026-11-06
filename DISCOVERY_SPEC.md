# BeamDrop Shared Device Discovery Protocol Specification

**Specification Version**: `1.0.0`  
**Compatibility Target**: Desktop (Tauri 2 / Rust), Android (Kotlin / NsdManager), iOS (Network.framework)

---

## 1. Overview & Principles

BeamDrop is a decentralized, local-area-network (LAN) device discovery and secure file sharing application inspired by LocalSend. It operates **strictly over local network boundaries without reliance on external cloud servers, STUN/TURN relays, or third-party telemetry.**

Discovery is the initial zero-configuration rendezvous phase that permits devices on the same Wi-Fi or wired subnet to detect one another. **Discovery alone does not establish a trusted relationship or grant file system access.** Pairing and encrypted transfer handshakes will occur in subsequent phases.

---

## 2. mDNS / DNS-SD Service Contract

### 2.1 Service Identifier
- **Service Type**: `_beamdrop._tcp.local.`
- **Transport Protocol**: Multicast DNS over UDP port `5353` (multicast address `224.0.0.251` for IPv4, `[FF02::FB]` for IPv6).
- **Default Application Port**: `53317` (configurable if occupied).

### 2.2 Instance Naming Convention
To avoid mDNS naming collisions when multiple devices share an alias:
```
<SanitizedDeviceAlias>-<ShortDeviceIDPrefix>
```
*Example*: `Alex-MacBook-Pro-8f3a12`

### 2.3 TXT Record Attributes

All fields must be UTF-8 encoded key-value pairs formatted as `key=value`:

| Key | Description | Type / Format | Example |
| :--- | :--- | :--- | :--- |
| `id` | Unique UUIDv4 identifying this device instance | String (UUID) | `c7b94b29-b690-449e-b9e7-49d97034c211` |
| `alias` | User-configured friendly device display name | String (max 48 chars) | `Aditya's Pixel 8` |
| `model` | Hardware or OS model name | String | `Google Pixel 8` |
| `platform` | Operating system family | `macos` \| `windows` \| `linux` \| `android` \| `ios` \| `web` | `android` |
| `type` | Form factor category | `desktop` \| `mobile` \| `tablet` \| `server` \| `headless` | `mobile` |
| `version` | Application release version | Semantic Version (`X.Y.Z`) | `1.0.0` |
| `proto` | Discovery protocol version | String | `1.0` |
| `port` | Local listening port for transfers | Integer string | `53317` |
| `fingerprint` | Optional public key / cert thumbprint | Hex string (SHA-256) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4` |

---

## 3. Client Lifecycle & Discovery Workflow

### 3.1 Step 1: Initialization
1. Determine local host network interfaces and pick the primary active private IPv4 address (e.g. `192.168.1.x` or `10.0.0.x`).
2. Generate or load the device's persistent UUID `id` and friendly `alias`.
3. Start the local server socket on the target port (default `53317`).

### 3.2 Step 2: Service Announcement (Registration)
1. Instantiate the mDNS registration daemon:
   - On Android: `android.net.nsd.NsdManager.registerService()`
   - On Desktop (Tauri / Rust): `mdns_sd::ServiceDaemon.register()`
2. Publish `_beamdrop._tcp.local.` with the TXT record specified above.

### 3.3 Step 3: Service Discovery (Browsing)
1. Query for services matching `_beamdrop._tcp.local.`.
2. Upon receiving `ServiceResolved`:
   - Parse all TXT attributes.
   - Ignore records where `id == local_device.id` (self-reflection filter).
   - Validate IP address and port format.
   - Deduplicate based on `id` (or update existing entry if IP or alias changed).
   - Trigger UI event `discovery:device-discovered` or `discovery:device-updated`.

### 3.4 Step 4: Keep-Alive & Departure (TTL)
1. When a device disconnects or is turned off:
   - Graceful shutdown: unregister the mDNS service instance.
   - Sudden loss: if a peer service has not responded or refreshed within 90 seconds, mark it as offline and discard it after 120 seconds.
2. Trigger UI event `discovery:device-lost`.

---

## 4. Cross-Platform Guidelines & Caveats

1. **Android (Kotlin)**:
   - Requires `<uses-permission android:name="android.permission.INTERNET" />`
   - Requires `<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />`
   - Requires `<uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />`
   - Must acquire a `WifiManager.MulticastLock` during discovery to prevent Android OS power saving from dropping multicast packets.
2. **Windows Desktop**:
   - Requires outbound and inbound UDP firewall rule on port 5353.
   - Network profile must be set to "Private Network" (Windows restricts mDNS broadcast on "Public" networks).
3. **macOS**:
   - Native mDNSResponder handles Bonjour queries seamlessly; grant local network permission when prompted on macOS 15+.
4. **Linux**:
   - Ensure `avahi-daemon` is running or userland raw socket binding has appropriate capabilities (`CAP_NET_BIND_SERVICE`).
