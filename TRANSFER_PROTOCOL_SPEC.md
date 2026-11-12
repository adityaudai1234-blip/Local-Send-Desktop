# BeamDrop File Transfer Protocol Specification (Phase 4)

**Version**: `1.0.0`  
**Standard**: Binary-framed encrypted peer-to-peer file transfer over authenticated TCP/TLS  
**Platforms**: Desktop (Tauri 2 / Rust), Android (Kotlin / Ktor / OkHttp / Netty), iOS (Swift / Network.framework)

---

## 1. Overview & Architecture

BeamDrop file transmission uses an asynchronous, chunked, binary streaming protocol operating directly over local network connections established and authenticated in Phases 2 and 3.

```
+-----------------------------------------------------------------------------------------+
|                                    TRANSFER SESSION                                     |
|                                                                                         |
|  Sender (Device A)                                            Receiver (Device B)       |
|         |                                                             |                 |
|         |-------- 1. TRANSFER_REQUEST (Metadata, Files, Size) ------->| (Prompt User)   |
|         |<------- 2. TRANSFER_ACCEPTED or TRANSFER_REJECTED ----------|                 |
|         |                                                             |                 |
|         |-------- 3. TRANSFER_STARTED ------------------------------->|                 |
|         |                                                             |                 |
|         |-------- 4. FILE_METADATA (File 1 of N) -------------------->| (Alloc .part)   |
|         |-------- 5. FILE_CHUNK (Chunk 0, 64KB) --------------------->| (Hash Update)   |
|         |-------- 6. FILE_CHUNK (Chunk 1, 64KB) --------------------->| (Hash Update)   |
|         |                 ... (streaming chunks)                      |                 |
|         |-------- 7. FILE_VERIFICATION (SHA-256 checksum) ----------->| (Validate Hash) |
|         |<------- 8. TRANSFER_PROGRESS (Ack, Offset, Speed) ----------| (Rename .part)  |
|         |                                                             |                 |
|         |-------- 9. TRANSFER_COMPLETED ----------------------------->| (Notify User)   |
+-----------------------------------------------------------------------------------------+
```

---

## 2. Control Message Envelopes

All control messages share the standard BeamDrop envelope:

```json
{
  "protocolVersion": "1.0",
  "messageId": "UUIDv4",
  "senderDeviceId": "UUID",
  "recipientDeviceId": "UUID",
  "messageType": "MESSAGE_TYPE",
  "timestamp": 1741267500000,
  "payload": {}
}
```

### 2.1 Defined Message Types

| Message Type | Direction | Description |
|---|---|---|
| `TRANSFER_REQUEST` | Sender → Receiver | Initiates transfer; describes batch of files, total size, and expiration |
| `TRANSFER_ACCEPTED` | Receiver → Sender | Confirms recipient approval; includes accepted file IDs and destination token |
| `TRANSFER_REJECTED` | Receiver → Sender | Rejection notification with reason (`USER_REJECTED`, `INSUFFICIENT_STORAGE`) |
| `TRANSFER_STARTED` | Sender → Receiver | Handshake indicating chunk streaming is commencing |
| `TRANSFER_PROGRESS` | Bidirectional | Syncs confirmed byte offset, instantaneous speed (B/s), and ETA (seconds) |
| `TRANSFER_COMPLETED` | Sender → Receiver | All files in the batch were streamed and verified |
| `TRANSFER_FAILED` | Bidirectional | Indicates an unrecoverable failure during transfer |
| `TRANSFER_CANCELLED` | Bidirectional | Explicit cancellation by sender or receiver; triggers `.part` cleanup |
| `TRANSFER_PAUSED` | Bidirectional | Temporarily stops chunk transmission; preserves partial file state |
| `TRANSFER_RESUMED` | Bidirectional | Requests resumption from last confirmed byte offset |
| `FILE_METADATA` | Sender → Receiver | Precedes each file in a batch with name, size, MIME type, and expected hash |
| `FILE_CHUNK` | Sender → Receiver | Binary packet containing chunk index, offset, and encrypted payload |
| `FILE_VERIFICATION` | Sender → Receiver | Signals EOF for a file with the sender's computed SHA-256 checksum |
| `TRANSFER_ERROR` | Bidirectional | Reports protocol errors, timeout, disk full, or checksum mismatches |

---

## 3. Detailed Payloads

### 3.1 `TRANSFER_REQUEST`
```json
{
  "transferId": "tx-e3b0c442-98fc-4c14-9b2e-0683a54b387e",
  "fileCount": 2,
  "totalBytes": 104857600,
  "expiresAt": 1741267560000,
  "files": [
    {
      "fileId": "f-01",
      "fileName": "presentation.pdf",
      "fileSize": 10485760,
      "mimeType": "application/pdf",
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "fileId": "f-02",
      "fileName": "video_clip.mp4",
      "fileSize": 94371840,
      "mimeType": "video/mp4",
      "sha256": null
    }
  ]
}
```

### 3.2 `TRANSFER_ACCEPTED`
```json
{
  "transferId": "tx-e3b0c442-98fc-4c14-9b2e-0683a54b387e",
  "acceptedFileIds": ["f-01", "f-02"],
  "destinationDirectory": "Downloads/BeamDrop",
  "maxChunkSize": 65536
}
```

### 3.3 `TRANSFER_REJECTED`
```json
{
  "transferId": "tx-e3b0c442-98fc-4c14-9b2e-0683a54b387e",
  "reason": "USER_REJECTED",
  "message": "Recipient declined the transfer request."
}
```

### 3.4 `FILE_CHUNK` (Wire Binary Envelope)
For maximum throughput and low memory footprint, `FILE_CHUNK` packets use binary framing:

```
+---------------------------+-------------------+--------------------+-----------------------+
| Magic (2 bytes: 0x42 0x44)| Chunk Flag (1 byte| Transfer ID (16 B) | File ID (16 B UUID)   |
+---------------------------+-------------------+--------------------+-----------------------+
| Chunk Index (8 bytes BE)  | Offset (8 B BE)   | Chunk Length (4 B) | Encrypted Payload     |
+---------------------------+-------------------+--------------------+-----------------------+
```

- **Default Chunk Size**: 65,536 bytes (64 KB). High-speed LAN allows up to 131,072 bytes (128 KB).
- **Payload Encryption**: AES-256-GCM envelope `[12-byte Nonce || Ciphertext || 16-byte Poly1305 Tag]`.
- **Zero-Copy Streaming**: Chunks are read directly from disk via buffered Tokio `AsyncReadExt` and piped to the socket writer without Base64 encoding.

### 3.5 `FILE_VERIFICATION`
```json
{
  "transferId": "tx-e3b0c442-98fc-4c14-9b2e-0683a54b387e",
  "fileId": "f-01",
  "senderSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "totalBytesSent": 10485760
}
```

---

## 4. File Safety & Integrity Rules

1. **Path Traversal Protection**:
   - Remote filenames must be stripped of all directory separators (`/`, `\`, `..`, `:`, null bytes).
   - Filenames are sanitized using ASCII/UTF-8 alphanumeric characters, dots, underscores, and dashes.
2. **Conflict Resolution**:
   - If `document.pdf` already exists in the target directory, it is renamed following `document (1).pdf`, `document (2).pdf`, etc.
   - Files are never silently overwritten.
3. **Atomic Writing & Incomplete File Isolation**:
   - Incoming chunks are written to a temporary file: `<sanitized_name>.<transfer_id>.part`.
   - Streaming SHA-256 digests are computed incrementally on the fly as chunks arrive.
   - When `FILE_VERIFICATION` is received:
     - Compare receiver's running SHA-256 with `senderSha256`.
     - On match: atomically rename `.part` to the final target filename.
     - On mismatch: delete the `.part` file immediately and emit `TRANSFER_ERROR (ERR_CHECKSUM_MISMATCH)`.
4. **Cancellation Cleanup**:
   - If sender or receiver cancels the transfer, all open `.part` files are closed and deleted from disk.

---

## 5. Android Compatibility Guide (Kotlin / OkHttp / Ktor)

The Android companion application uses this exact protocol:
1. **TCP Port**: Android listens on port `53317`.
2. **Length Prefixing**: 4-byte big-endian prefix before JSON control frames.
3. **AES-256-GCM**: Key derived via `MessageDigest.getInstance("SHA-256")` of the shared pairing auth token, standard `GCMParameterSpec(128, nonce)`.
4. **Buffered Streaming**: Use `FileChannel` or `Okio` buffered sources/sinks with 64KB buffers.
5. **Scoped Storage**: Files received on Android are saved to `Environment.DIRECTORY_DOWNLOADS/BeamDrop` via Android `MediaStore` API.
