# BeamDrop Folder Sharing & Directory Transfer Specification (Phase 5)

**Version**: `1.0.0`  
**Compatibility**: Desktop (Tauri 2 / Rust), Android (Kotlin / SAF / MediaStore), iOS (Network.framework)

---

## 1. Overview & Directory Tree Model

BeamDrop Phase 5 enables peer-to-peer transmission of entire directory trees, preserving nested folder hierarchies, metadata, and empty folders, without streaming whole folders in memory or exposing absolute host paths.

### 1.1 Core Principles
1. **Relative Paths Only**: All file entries in a folder transfer MUST specify a sanitized relative path (e.g., `ProjectA/assets/logo.png`) relative to the shared folder root. Absolute paths (e.g., `/Users/alice/Projects/...` or `C:\Users\...`) are strictly prohibited over the wire.
2. **Path Traversal Protection**: Any path containing `..`, leading `/` or `\`, null bytes (`\0`), control characters, or drive letters (`C:`) is immediately rejected by the receiver.
3. **Recursive Integrity**: Every file in the hierarchy has an independent SHA-256 verification hash. Folders and nested subfolders are created recursively on demand by the receiver before writing file chunks.
4. **Empty Folder Preservation**: Folders containing zero files are transmitted via folder manifests with `isDirectory = true`, ensuring empty directory skeletons are preserved.

---

## 2. Wire Format & Payloads

### 2.1 `TRANSFER_REQUEST` (Folder Batch)

When transmitting a folder, the `TRANSFER_REQUEST` envelope includes `isFolder: true` and `rootFolderName`:

```json
{
  "protocolVersion": "1.0",
  "messageId": "9c12b1a8-12fe-4318-b2ef-343058a74e50",
  "senderDeviceId": "bd-mac-7b29",
  "recipientDeviceId": "bd-pix-88f2",
  "messageType": "TRANSFER_REQUEST",
  "timestamp": 1741267500000,
  "payload": {
    "transferId": "tx-folder-881a",
    "isFolder": true,
    "rootFolderName": "ProjectA",
    "fileCount": 4,
    "folderCount": 2,
    "totalBytes": 14589000,
    "priority": "normal",
    "expiresAt": 1741267560000,
    "files": [
      {
        "fileId": "f-01",
        "fileName": "main.rs",
        "relativePath": "ProjectA/src/main.rs",
        "fileSize": 4120,
        "mimeType": "text/x-rust",
        "isDirectory": false,
        "sha256": "4a5b6c..."
      },
      {
        "fileId": "f-02",
        "fileName": "assets",
        "relativePath": "ProjectA/assets",
        "fileSize": 0,
        "mimeType": "application/x-directory",
        "isDirectory": true,
        "sha256": null
      },
      {
        "fileId": "f-03",
        "fileName": "logo.png",
        "relativePath": "ProjectA/assets/logo.png",
        "fileSize": 14580000,
        "mimeType": "image/png",
        "isDirectory": false,
        "sha256": null
      }
    ]
  }
}
```

### 2.2 Wire Chunk Envelope

Chunks are streamed sequentially using the standard Phase 4 binary envelope with 64 KB slices, tagged with the matching `fileId`.

---

## 3. Receiver Filesystem Execution Workflow

```
Receive TRANSFER_REQUEST
          │
          ▼
   Sanitize Relative Paths (strip ../, drive letters, leading slashes)
          │
          ▼
   Resolve Root Collision in Download Directory (e.g. ProjectA (1))
          │
          ▼
   For each item in files list:
     ├── If isDirectory == true:
     │     fs::create_dir_all(dest_dir.join(sanitized_relative_path))
     │
     └── If isDirectory == false:
           Ensure parent directory exists
           Open temporary .part file: dest_dir.join(relative_path).part
           Stream 64KB AES-GCM chunks & update incremental SHA-256
           On FILE_VERIFICATION:
             Verify receiver hash == sender hash
             Atomic rename .part -> final relative destination
```

---

## 4. Android Compatibility & Scoped Storage

- **Android 11+ (API 30+)**: Files are placed inside `Environment.DIRECTORY_DOWNLOADS/BeamDrop/<rootFolderName>/...` using the `DocumentFile` Tree API or standard `File` operations within application-accessible storage.
- Relative subdirectories are created on Android using `DocumentsContract.createDocument(..., Document.MIME_TYPE_DIR, folderName)`.
- Filename collisions follow Android suffix conventions: `ProjectA (1)`.
