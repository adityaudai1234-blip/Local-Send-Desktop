# BeamDrop Device-to-Device Network Communication Specification

**Specification Version**: `1.0.0`  
**Compatibility Target**: Desktop (Tauri 2 / Rust), Android (Kotlin / OkHttp / Ktor / Netty), iOS (Swift / Network.framework)

---

## 1. Architectural Overview

BeamDrop operates on a symmetric peer-to-peer client-server architecture over the local network (LAN):
- Every instance hosts a local asynchronous TCP server (default port `53317`).
- Both devices establish bidirectional, authenticated, and encrypted sessions using AES-256-GCM derived from Phase 2 shared cryptographic auth tokens.
- No central relay or internet server is required.

---

## 2. Framing & Transport Layer

### 2.1 Wire Format
Communication uses a 4-byte big-endian length prefix followed by UTF-8 encoded JSON or an AES-256-GCM encrypted payload:

```
+---------------------------+-----------------------------------------------+
| Frame Length (4 bytes BE) | Payload (JSON or [12-byte Nonce || Ciphertext])|
+---------------------------+-----------------------------------------------+
```

- **Maximum Control Frame Size**: `1,048,576` bytes (1 MB). Frames exceeding this length are immediately dropped with connection termination (`ERR_FRAME_TOO_LARGE`).
- **Encrypted Envelope**:
  `[12-byte random CSPRNG Nonce] || [AES-256-GCM Ciphertext] || [16-byte Poly1305 Authentication Tag]`

---

## 3. Standard Protocol Envelope

All control messages share this JSON structure (`camelCase`):

```json
{
  "protocolVersion": "1.0",
  "messageId": "9c12b1a8-12fe-4318-b2ef-343058a74e50",
  "senderDeviceId": "bd-mac-7b29",
  "recipientDeviceId": "bd-pix-88f2",
  "messageType": "PING",
  "timestamp": 1741267500000,
  "payload": {}
}
```

### Required Fields
- `protocolVersion`: String (Fixed: `"1.0"`).
- `messageId`: String (UUIDv4).
- `senderDeviceId`: String (UUID).
- `recipientDeviceId`: String (UUID).
- `messageType`: String (One of the standard types below).
- `timestamp`: Integer (Milliseconds since Unix epoch). Replay window: `|current_time - timestamp| <= 60000ms`.
- `payload`: Object (Type-specific parameters).

---

## 4. Message Types & Workflows

### 4.1 Connection & Authentication Sequence

```
Device B (Initiator / Client)             Device A (Listener / Server)
       |                                              |
       | --- 1. TCP Connect (Port 53317) -----------> |
       | --- 2. DEVICE_HELLO -----------------------> |
       | <--- 3. DEVICE_INFO (or challenge) --------- |
       | --- 4. AUTH_REQUEST (Signature/Token Hash) ->|
       |                                              | [Verify in SQLite]
       | <--- 5. AUTH_RESPONSE (Session Key Derived) -|
       |                                              |
       | === [ESTABLISHED AUTHENTICATED STATE] ====== |
       |                                              |
       | <--- 6. Periodic PING (Every 5s) ----------->|
       | <--- 7. Periodic PONG (Latency Measured) --->|
```

#### `DEVICE_HELLO`
Sent immediately upon socket connection.
```json
{
  "messageType": "DEVICE_HELLO",
  "payload": {
    "name": "Aditya's Pixel 8",
    "version": "1.0.0",
    "platform": "android",
    "deviceModel": "Google Pixel 8 Pro",
    "port": 53317
  }
}
```

#### `AUTH_REQUEST`
Sent by the connecting client proving its pre-shared trust token.
```json
{
  "messageType": "AUTH_REQUEST",
  "payload": {
    "sessionId": "4f9d2d0b-68e1-4c12-8418-8092db2c3664",
    "clientDeviceId": "bd-pix-88f2",
    "timestamp": 1741267501000,
    "signatureHex": "e34a9c12..."
  }
}
```

#### `AUTH_RESPONSE`
```json
{
  "messageType": "AUTH_RESPONSE",
  "payload": {
    "success": true,
    "sessionToken": "sess_tok_9a3b8c4d",
    "errorMessage": null
  }
}
```

---

### 4.2 Heartbeat & Health Monitoring

#### `PING`
Dispatched every **5 seconds** by the active connection manager.
```json
{
  "messageType": "PING",
  "payload": {
    "sentAt": 1741267505000
  }
}
```

#### `PONG`
Responded to immediately without blocking.
```json
{
  "messageType": "PONG",
  "payload": {
    "pingId": "9c12b1a8-12fe-4318-b2ef-343058a74e50",
    "pingSentAt": 1741267505000,
    "receivedAt": 1741267505004
  }
}
```

- **Timeout Rule**: If no `PONG` response is received within **15,000 ms (15 seconds)**, the connection transitions to `Reconnecting`.

---

### 4.3 Clean Disconnection

#### `DISCONNECT`
```json
{
  "messageType": "DISCONNECT",
  "payload": {
    "reason": "USER_CLOSED"
  }
}
```

---

### 4.4 Phase 4 File Transfer Preparation

The protocol reserves and specifies standard control frames for the upcoming streaming phase:
- `TRANSFER_REQUEST`: Announces file metadata (file name, size, MIME type, SHA-256).
- `TRANSFER_ACCEPTED`: Receiver acknowledges and allocates incoming buffer.
- `TRANSFER_REJECTED`: Receiver declines incoming transfer request.
- `TRANSFER_CANCELLED`: Sender or receiver cancels an active stream.

---

## 5. Reconnection & Backoff Algorithm

When a connected trusted device drops:
1. State transitions to `Reconnecting`.
2. Attempt retry using truncated exponential backoff:
   $$T_{\text{wait}} = \min(2^{\text{attempt}} \times 1\text{s}, 30\text{s}) + \text{uniform}(100\text{ms}, 500\text{ms})$$
3. Maximum attempts: **5 attempts**.
4. If reconnect fails after 5 retries, state transitions to `Failed`. User can trigger manual reconnection via the UI.

---

## 6. Standard Error Codes

| Code | Description |
| :--- | :--- |
| `ERR_AUTH_FAILED` | Token hash mismatch or device not in SQLite trusted table |
| `ERR_FRAME_TOO_LARGE` | Control frame exceeded 1 MB |
| `ERR_REPLAY_DETECTED` | Timestamp delta > 60 seconds |
| `ERR_TIMEOUT` | Heartbeat PING timed out after 15s |
| `ERR_UNSUPPORTED_VERSION`| Protocol version is not `1.0` |
| `ERR_DECRYPTION_FAILED` | AEAD authentication tag mismatch |
