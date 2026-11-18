# BeamDrop Phase 6 — Security, Encryption & Privacy Architecture

## 1. Cryptographic Primitives & Rationale

| Purpose | Primitive | Crate / Standard | Why Selected |
| :--- | :--- | :--- | :--- |
| Device Identity & Signing | **Ed25519** | `ed25519-dalek` (RFC 8032) | Fast 32-byte public keys, deterministic signatures, side-channel hardened, native Android Tink/BouncyCastle parity. |
| Session Key Agreement | **X25519** | `x25519-dalek` (RFC 7748) | Ephemeral Diffie-Hellman providing Forward Secrecy per session; 32-byte raw keys trivial to serialize across Android and Rust. |
| Key Derivation | **HKDF-SHA256** | `hkdf` + `sha2` (RFC 5869) | Cryptographically binds session transcript and separates control vs. file-transfer keys via explicit `info` domain labels. |
| Authenticated Encryption | **ChaCha20-Poly1305** & **AES-256-GCM** | `chacha20poly1305`, `aes-gcm` | Industry-standard AEAD providing confidentiality + 128-bit Poly1305/GHASH integrity authentication. ChaCha20-Poly1305 offers high speed on mobile ARM CPUs without AES hardware instructions; AES-256-GCM leverages AES-NI on x86_64 desktops. |
| File & Key Integrity | **SHA-256** | `sha2` (FIPS 180-4) | Collision-resistant end-to-end verification of reassembled files and deterministic 8-byte key fingerprints. |
| Secret Hygiene | **Zeroize** | `zeroize` | Zeroes ephemeral ECDH secrets and derived session key buffers from RAM on drop. |
| OS Secret Storage | **OS Keyring** | `keyring` | Isolates Ed25519 private signing keys in macOS Keychain, Windows Credential Manager, or Linux Secret Service API. |

---

## 2. Trust Model & Threat Boundaries

- **Zero-Cloud Local LAN Threat Model**: Devices on the same Wi-Fi/LAN are **never** assumed trustworthy. mDNS discovery announcements are strictly informational and unauthenticated.
- **Explicit Mutual Trust**: Trust is established only after out-of-band pairing (QR scan + 6-digit Short Authentication String comparison bound to both Ed25519 public keys and pairing session ID).
- **Private Key Isolation**: Ed25519 private keys remain exclusively in Rust memory and OS secure keyring storage. They are **never** serialized over IPC to React or transmitted across the network.
- **Identity Pinning (TOFU + Key Change Detection)**: Once paired, a peer's Ed25519 public key and `keyVersion` are pinned locally. Any subsequent handshake presenting a mismatched public key for an existing `deviceId` raises an **Identity Change Security Alert**, blocks automatic authentication, and requires explicit user re-verification.
- **Revocation Boundary**: Revoking a device deletes/marks trust revoked, destroys its `SecureSession`, closes any open transport sockets, cancels active transfers, and blocks reconnection until re-paired.

---

## 3. Key Lifecycle & Domain Separation

1. **Identity Initialization**: On first run, `IdentityManager` checks `SecureKeyStore` (OS keyring).
   - If keyring is available: loads or generates 32-byte Ed25519 seed, stores seed in OS keyring, writes non-secret metadata (`device_id`, `public_key_hex`, `fingerprint`, `key_version`, `created_at`) to `beamdrop_security.sqlite`.
   - If keyring is unavailable: **does not silently persist plaintext private keys to disk**. Sets `SecureStorageStatus.available = false`, emits an explicit security warning, and operates in memory-only ephemeral identity mode unless the OS keyring becomes available.
2. **Per-Session Ephemeral Handshake**:
   - Initiator and responder exchange fresh ephemeral X25519 public keys (`eph_pub_a`, `eph_pub_b`) signed by their long-term Ed25519 identity keys along with nonces and timestamps.
   - Both sides verify signatures against the pinned trusted Ed25519 public key.
   - Shared ECDH secret `Z = X25519(eph_priv, peer_eph_pub)`.
3. **HKDF-SHA256 Key Derivation**:
   - Salt = `SHA-256(session_id || min(device_a, device_b) || max(device_a, device_b))`
   - PRK = `HKDF-Extract(salt, Z)`
   - Domain-separated 32-byte keys (`ZeroizeOnDrop`):
     - `control_c2s_key = HKDF-Expand(PRK, "beamdrop/v1/control-c2s", 32)`
     - `control_s2c_key = HKDF-Expand(PRK, "beamdrop/v1/control-s2c", 32)`
     - `file_c2s_key    = HKDF-Expand(PRK, "beamdrop/v1/file-c2s", 32)`
     - `file_s2c_key    = HKDF-Expand(PRK, "beamdrop/v1/file-s2c", 32)`
4. **Deterministic Nonce Construction (Zero Nonce Reuse)**:
   - Every AEAD encryption uses a strict 12-byte (96-bit) nonce:
     `[ 4-byte channel/direction tag || 8-byte big-endian monotonic u64 sequence_number ]`
   - Prefixes: `0x42444331` (`BDC1` control C2S), `0x42444332` (`BDC2` control S2C), `0x42444631` (`BDF1` file C2S), `0x42444632` (`BDF2` file S2C).
   - Because each directional key is unique per session and sequence numbers strictly increment (`1, 2, 3, ...`), a `(key, nonce)` pair is mathematically guaranteed never to repeat.
5. **Key Rotation & Destruction**:
   - Session keys expire after `3600s` (1 hour) or on disconnect/unpair/revoke and are zeroized on drop.
   - `rotate_device_keys()` generates a new Ed25519 keypair, increments `key_version`, replaces the OS keyring secret, and records an audit event.

---

## 4. Replay Attack Protection & Encrypted File Chunk Format

### Control & Data Replay Rules
Every authenticated packet carries `session_id`, `message_id` (UUID v4), `sender_device_id`, `timestamp` (Unix ms), and `sequence_number` (`u64`). Receiver rejects frames if:
- Session ID does not match active authenticated session or session is expired (`now > expires_at`).
- Sender device ID does not match pinned session peer.
- Timestamp skew exceeds `±120,000 ms` (`2 minutes`).
- `message_id` was previously seen in this session.
- `sequence_number <= highest_accepted_sequence` (strictly monotonic enforcement).
- AEAD authentication tag verification fails (with AAD = `session_id|sender_id|sequence_number`).

### Encrypted Chunk Envelope (`EncryptedChunkFrame`)
- `transferId`: String
- `fileId`: String
- `chunkSequence`: u64 (strictly monotonic)
- `offset`: u64
- `nonceHex`: 24-char hex (12 bytes)
- `cipherSuite`: `"chacha20-poly1305"` | `"aes-256-gcm"`
- `ciphertextB64`: Base64 of `(ciphertext || 16-byte AEAD tag)`
- Final per-file integrity is additionally confirmed using end-to-end `SHA-256` over reconstructed plaintext before atomic rename of `.part` -> final target file.

---

## 5. Android Compatibility Matrix

Android (`Kotlin` / `AndroidKeyStore` + `BouncyCastle` / `JCA`) and Desktop (`Rust` / `Tauri 2`) share identical wire conventions:
- Ed25519 public keys: 32 raw bytes lowercase hex (`64` hex chars).
- X25519 public keys: 32 raw bytes lowercase hex (`64` hex chars).
- Fingerprint: Uppercase colon-separated first 8 bytes of `SHA-256(raw_ed25519_pub_bytes)` (`XX:XX:XX:XX:XX:XX:XX:XX`).
- SAS Verification Code: `u32::from_be_bytes(SHA-256(session_id || client_pub_hex || server_pub_hex)[0..4]) % 1_000_000` formatted as 6 zero-padded digits.
- AEAD Output: `[ciphertext || 16-byte tag]` matching `javax.crypto.Cipher` / `ChaCha20-Poly1305` / `AES/GCM/NoPadding`.

---

## 6. Local Storage & SQLite Disclosure

- **OS Secure Storage**: Long-term Ed25519 private signing seeds are stored in macOS Keychain / Windows Credential Manager / Linux Secret Service via `keyring`.
- **SQLite Storage (`beamdrop_data.sqlite`, `beamdrop_transfers.sqlite`, `beamdrop_security.sqlite`)**: Stores only public keys, fingerprints, SHA-256 auth token hashes, transfer metadata, privacy settings, and redacted audit logs. Standard SQLite is used (SQLite transparent file encryption / SQLCipher is **not** claimed unless explicitly compiled in); zero private keys or file contents are stored in SQLite.
