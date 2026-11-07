# BeamDrop Secure Pairing & Authentication Protocol Specification

**Specification Version**: `1.0.0`  
**Compatibility Target**: Desktop (Tauri 2 / Rust), Android (Kotlin / Jetpack Crypto), iOS (Swift / CryptoKit)

---

## 1. Threat Model & Security Principles

1. **Local Boundary Isolation**: Discovery via mDNS advertises device availability, but **mDNS resolution grants zero trust**.
2. **Mutual Public-Key Authentication**: Devices verify identities via asymmetric Ed25519 cryptography.
3. **Short-Lived Ephemeral Sessions**: QR codes and pairing sessions expire automatically after **300 seconds (5 minutes)**.
4. **Replay & Injection Prevention**: Each handshake references a single-use UUIDv4 session identifier and cryptographic nonces.
5. **No Private Key Transmission**: Private signing keys never leave the secure operating-system storage or client keychain. QR payloads and network transmissions strictly contain public keys and fingerprints.
6. **Human Verification Code**: A 6-digit visual Short Authentication String (SAS) computed from both public keys and session ID allows users to detect man-in-the-middle attacks on untrusted Wi-Fi.

---

## 2. Shared Data Models & Serialization

All JSON structures use standard `camelCase` keys:

### 2.1 QR Code Payload Format
Rendered as standard QR Code (UTF-8 string with Error Correction Level M):

```json
{
  "protocol": "beamdrop-pairing",
  "version": "1.0",
  "sessionId": "4f9d2d0b-68e1-4c12-8418-8092db2c3664",
  "deviceId": "bd-mac-7b29",
  "deviceName": "Alex's MacBook Pro",
  "ipAddress": "192.168.1.105",
  "port": 53317,
  "publicKey": "a3b909f193ec83a31c50e4171694f4c2c5443a53e6b4b455b34bc2e3160a0a91",
  "fingerprint": "E3:4A:9C:12:8F:05:BD:7E",
  "verificationCode": "481920",
  "expiresAt": 1741267800000
}
```

| Field | Type | Description |
| :--- | :--- | :--- |
| `protocol` | String | Fixed: `"beamdrop-pairing"` |
| `version` | String | Semantic version: `"1.0"` |
| `sessionId` | String (UUIDv4) | Single-use session identifier |
| `deviceId` | String | Unique instance ID of the displaying device |
| `deviceName` | String | User-friendly device alias (e.g., `"Alex's MacBook Pro"`) |
| `ipAddress` | String | Active IPv4 address on the shared subnet |
| `port` | Number | Listening socket port (default `53317`) |
| `publicKey` | String (Hex) | 32-byte Ed25519 public key (64 hex characters) |
| `fingerprint` | String | SHA-256 thumbprint (first 8 bytes formatted as `XX:XX:...`) |
| `verificationCode` | String (6 digits) | Human visual check code (`000000` - `999999`) |
| `expiresAt` | Number | Milliseconds since Unix epoch |

---

### 2.2 Pairing Request Payload (Client -> Server)
Sent by scanning device (Device B) to displaying device (Device A):

```json
{
  "requestId": "9c12b1a8-12fe-4318-b2ef-343058a74e50",
  "sessionId": "4f9d2d0b-68e1-4c12-8418-8092db2c3664",
  "fromDeviceId": "bd-pix-88f2",
  "fromDeviceName": "Aditya's Pixel 8",
  "fromPlatform": "android",
  "fromDeviceModel": "Google Pixel 8 Pro",
  "fromIpAddress": "192.168.1.142",
  "fromPort": 53317,
  "fromPublicKey": "f9024c084656ec5688a44d858cf09f25752c00222f7743d78c005b766861614e",
  "fromFingerprint": "9A:14:8B:D3:52:FC:31:01",
  "verificationCode": "481920",
  "timestamp": 1741267500000
}
```

---

### 2.3 Pairing Response Payload (Server -> Client)

```json
{
  "success": true,
  "requestId": "9c12b1a8-12fe-4318-b2ef-343058a74e50",
  "authToken": "8f37b129a60e42d7b4c90e1f3a2b5c7d8e9f0123456789abcdef0123456789ab",
  "message": "Successfully paired with Aditya's Pixel 8"
}
```

---

## 3. Cryptographic Handshake Sequence

```
Device A (Displaying QR)                  Device B (Scanning Camera)
       |                                              |
       | 1. Generates Keypair & Session (UUID, 5 min) |
       | 2. Displays QR Code with Public Key          |
       |                                              |
       |                                    3. Scans QR Code
       |                                    4. Validates protocol & expiresAt
       |                                    5. Computes verificationCode
       | <---------------------------------- 6. Transmits PairingRequest
       |
7. Compares session_id & expiry
8. Prompts user: "Pair with Device B?"
9. User verifies verificationCode matches
10. User clicks "Accept Pairing"
11. Generates 32-byte Auth Token
12. Stores Device B in SQLite trusted_devices
13. Returns PairingResponse + Auth Token ---->|
                                              | 14. Receives Auth Token
                                              | 15. Stores Device A in SQLite trusted_devices
                                              |
       [AUTHENTICATED TRUST RELATIONSHIP ESTABLISHED]
```

---

## 4. Verification Code Calculation (SAS)

Both devices compute the identical 6-digit numeric verification code using SHA-256 over session data:

```
Input: SHA-256(sessionId + clientPublicKeyHex + serverPublicKeyHex)
Number = BigEndianU32(hash[0..4]) % 1,000,000
Formatted: "%06d" (e.g. 481920)
```

If the numbers displayed on Device A and Device B differ, the user must reject the connection immediately.

---

## 5. Standard Error Codes

| Code | Reason | Resolution |
| :--- | :--- | :--- |
| `ERR_PAIR_EXPIRED` | QR code was scanned after `expiresAt` | Regenerate QR code on displaying device |
| `ERR_INVALID_PROTOCOL` | `protocol` attribute is not `"beamdrop-pairing"` | Verify both clients are on compatible versions |
| `ERR_SESSION_MISMATCH` | Session ID does not match active listener | Cancel and restart pairing session |
| `ERR_USER_REJECTED` | User tapped "Reject Pairing" on receiver | Re-request pairing with user consent |
| `ERR_ALREADY_TRUSTED` | Device ID already exists in `trusted_devices` | Reconnect existing device directly |
| `ERR_KEY_MALFORMED` | Ed25519 public key length != 32 bytes | Ensure standard uncompressed hex encoding |
