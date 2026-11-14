use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use super::background::BackgroundTransferCoordinator;
use super::metadata::{TransferDirection, TransferFileItem, TransferSession, TransferStatus};
use super::priority::TransferPriority;
use super::receiver::FileReceiver;
use super::recovery::{RecoverableTransferInfo, RecoveryManager};
use super::scheduler::{QueuedTransferInfo, TransferScheduler};
use super::sender::FileSender;
use crate::file_system::selection::SelectedFile;
use crate::file_system::storage::get_download_directory;
use crate::folders::metadata::FolderMetadata;
use crate::folders::scanner::scan_directory;
use crate::history::repository::HistoryRepository;
use crate::networking::ConnectionManager;
use crate::notifications::NotificationManager;
use crate::protocol::messages::{MessageType, ProtocolMessage, TransferAcceptedPayload, TransferRejectedPayload};
use crate::system_tray::BackgroundTransferStatus;
use crate::trusted_devices::TrustedDeviceManager;

pub struct TransferManager {
    pub active_sessions: Arc<Mutex<HashMap<String, TransferSession>>>,
    pub pending_requests: Arc<Mutex<HashMap<String, TransferSession>>>,
    pub selected_files: Arc<Mutex<Vec<SelectedFile>>>,
    pub selected_folders: Arc<Mutex<Vec<FolderMetadata>>>,
    pub cancellation_tokens: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub pause_tokens: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub scheduler: Arc<TransferScheduler>,
    pub background: Arc<BackgroundTransferCoordinator>,
    pub receiver: Arc<FileReceiver>,
    pub sender: Arc<FileSender>,
    pub history: Arc<HistoryRepository>,
    pub notifications: Arc<NotificationManager>,
    pub trusted_devices: Arc<TrustedDeviceManager>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
}

impl TransferManager {
    pub fn new(
        connection_manager: Arc<ConnectionManager>,
        history: Arc<HistoryRepository>,
        notifications: Arc<NotificationManager>,
        trusted_devices: Arc<TrustedDeviceManager>,
    ) -> Self {
        let receiver = Arc::new(FileReceiver::new());
        let sender = Arc::new(FileSender::new(connection_manager));

        Self {
            active_sessions: Arc::new(Mutex::new(HashMap::new())),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            selected_files: Arc::new(Mutex::new(Vec::new())),
            selected_folders: Arc::new(Mutex::new(Vec::new())),
            cancellation_tokens: Arc::new(Mutex::new(HashMap::new())),
            pause_tokens: Arc::new(Mutex::new(HashMap::new())),
            scheduler: Arc::new(TransferScheduler::new()),
            background: Arc::new(BackgroundTransferCoordinator::new()),
            receiver,
            sender,
            history,
            notifications,
            trusted_devices,
            app_handle: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_app_handle(&self, handle: AppHandle) {
        let mut lock = self.app_handle.lock().unwrap();
        *lock = Some(handle);
    }

    fn emit_event<T: serde::Serialize + Clone>(&self, event_name: &str, payload: T) {
        if let Some(ref handle) = *self.app_handle.lock().unwrap() {
            let _ = handle.emit(event_name, payload);
        }
    }

    fn notify(&self, dedup_key: &str, title: &str, body: &str, level: &str) {
        let handle_guard = self.app_handle.lock().unwrap();
        self.notifications
            .send_notification(handle_guard.as_ref(), dedup_key, title, body, level);
    }

    // --- File Selection ---

    pub fn add_selected_files(&self, file_paths: Vec<String>) -> Result<Vec<SelectedFile>, String> {
        let mut lock = self.selected_files.lock().unwrap();

        for path in file_paths {
            match SelectedFile::from_path(&path) {
                Ok(item) => {
                    if !lock.iter().any(|f| f.path == item.path) {
                        lock.push(item);
                    }
                }
                Err(e) => return Err(e),
            }
        }

        Ok(lock.clone())
    }

    pub fn get_selected_files(&self) -> Vec<SelectedFile> {
        self.selected_files.lock().unwrap().clone()
    }

    pub fn remove_selected_file(&self, file_id: &str) -> Vec<SelectedFile> {
        let mut lock = self.selected_files.lock().unwrap();
        lock.retain(|f| f.id != file_id);
        lock.clone()
    }

    pub fn clear_selected_files(&self) {
        let mut lock = self.selected_files.lock().unwrap();
        lock.clear();
    }

    // --- Folder Selection ---

    pub fn add_selected_folder(&self, folder_path: &str) -> Result<Vec<FolderMetadata>, String> {
        let metadata = scan_directory(Path::new(folder_path))?;
        let mut lock = self.selected_folders.lock().unwrap();
        if !lock.iter().any(|f| f.root_path == metadata.root_path) {
            lock.push(metadata);
        }
        Ok(lock.clone())
    }

    pub fn get_selected_folders(&self) -> Vec<FolderMetadata> {
        self.selected_folders.lock().unwrap().clone()
    }

    pub fn remove_selected_folder(&self, root_path: &str) -> Vec<FolderMetadata> {
        let mut lock = self.selected_folders.lock().unwrap();
        lock.retain(|f| f.root_path != root_path);
        lock.clone()
    }

    pub fn clear_selected_folders(&self) {
        let mut lock = self.selected_folders.lock().unwrap();
        lock.clear();
    }

    // --- Outgoing Transfers ---

    pub async fn start_file_transfer(
        &self,
        sender_id: String,
        sender_name: String,
        sender_platform: String,
        recipient_id: String,
        recipient_name: String,
        recipient_ip: String,
        recipient_port: u16,
        file_ids: Option<Vec<String>>,
        priority: Option<TransferPriority>,
    ) -> Result<TransferSession, String> {
        let selected = self.get_selected_files();
        let files_to_send: Vec<SelectedFile> = match file_ids {
            Some(ids) => selected.into_iter().filter(|f| ids.contains(&f.id)).collect(),
            None => selected,
        };

        if files_to_send.is_empty() {
            return Err("No files selected for transfer".to_string());
        }

        let transfer_id = Uuid::new_v4().to_string();
        let total_bytes: u64 = files_to_send.iter().map(|f| f.size).sum();
        let priority = priority.unwrap_or(TransferPriority::Normal);

        let names: Vec<String> = files_to_send.iter().map(|f| f.name.clone()).collect();
        let dedup_key = TransferScheduler::make_dedup_key(&recipient_id, &names);

        let transfer_files: Vec<TransferFileItem> = files_to_send
            .into_iter()
            .map(|f| TransferFileItem {
                file_id: f.id,
                name: f.name,
                size: f.size,
                mime_type: f.mime_type,
                path: Some(f.path),
                relative_path: None,
                is_directory: false,
                sha256_checksum: None,
                is_verified: false,
                bytes_transferred: 0,
                status: TransferStatus::WaitingForApproval,
            })
            .collect();

        let session = TransferSession {
            transfer_id: transfer_id.clone(),
            direction: TransferDirection::Outgoing,
            sender_device_id: sender_id,
            sender_device_name: sender_name,
            sender_platform,
            recipient_device_id: recipient_id,
            recipient_device_name: recipient_name.clone(),
            recipient_ip,
            recipient_port,
            files: transfer_files,
            total_bytes,
            bytes_transferred: 0,
            speed_bytes_per_sec: 0,
            estimated_seconds_remaining: None,
            status: TransferStatus::WaitingForApproval,
            priority,
            is_folder: false,
            root_folder_name: None,
            error_message: None,
            started_at: chrono::Utc::now().timestamp_millis(),
            completed_at: None,
            destination_directory: None,
        };

        {
            let mut lock = self.active_sessions.lock().unwrap();
            self.scheduler
                .enqueue(transfer_id.clone(), priority, dedup_key, &lock)?;
            lock.insert(transfer_id.clone(), session.clone());
        }

        {
            let mut c_lock = self.cancellation_tokens.lock().unwrap();
            c_lock.insert(transfer_id.clone(), Arc::new(AtomicBool::new(false)));
            let mut p_lock = self.pause_tokens.lock().unwrap();
            p_lock.insert(transfer_id.clone(), Arc::new(AtomicBool::new(false)));
        }

        let _ = self.history.save_session(&session);
        self.sender.send_transfer_request(&session).await?;
        self.emit_event("transfer-updated", session.clone());

        Ok(session)
    }

    pub async fn start_folder_transfer(
        &self,
        sender_id: String,
        sender_name: String,
        sender_platform: String,
        recipient_id: String,
        recipient_name: String,
        recipient_ip: String,
        recipient_port: u16,
        folder_paths: Option<Vec<String>>,
        priority: Option<TransferPriority>,
    ) -> Result<TransferSession, String> {
        let selected = self.get_selected_folders();
        let folders_to_send: Vec<FolderMetadata> = match folder_paths {
            Some(paths) => selected
                .into_iter()
                .filter(|f| paths.contains(&f.root_path))
                .collect(),
            None => selected,
        };

        if folders_to_send.is_empty() {
            return Err("No folders selected for transfer".to_string());
        }

        let transfer_id = Uuid::new_v4().to_string();
        let priority = priority.unwrap_or(TransferPriority::Normal);

        let root_folder_name = if folders_to_send.len() == 1 {
            folders_to_send[0].folder_name.clone()
        } else {
            format!("{} folders", folders_to_send.len())
        };

        let names: Vec<String> = folders_to_send.iter().map(|f| f.folder_name.clone()).collect();
        let dedup_key = TransferScheduler::make_dedup_key(&recipient_id, &names);

        let mut total_bytes: u64 = 0;
        let mut transfer_files: Vec<TransferFileItem> = Vec::new();

        for folder in folders_to_send {
            total_bytes += folder.total_bytes;
            for entry in folder.files {
                transfer_files.push(TransferFileItem {
                    file_id: entry.id,
                    name: entry.name,
                    size: entry.size,
                    mime_type: entry.mime_type,
                    path: entry.full_path,
                    relative_path: Some(entry.relative_path),
                    is_directory: entry.is_directory,
                    sha256_checksum: None,
                    is_verified: false,
                    bytes_transferred: 0,
                    status: TransferStatus::WaitingForApproval,
                });
            }
        }

        let session = TransferSession {
            transfer_id: transfer_id.clone(),
            direction: TransferDirection::Outgoing,
            sender_device_id: sender_id,
            sender_device_name: sender_name,
            sender_platform,
            recipient_device_id: recipient_id,
            recipient_device_name: recipient_name,
            recipient_ip,
            recipient_port,
            files: transfer_files,
            total_bytes,
            bytes_transferred: 0,
            speed_bytes_per_sec: 0,
            estimated_seconds_remaining: None,
            status: TransferStatus::WaitingForApproval,
            priority,
            is_folder: true,
            root_folder_name: Some(root_folder_name),
            error_message: None,
            started_at: chrono::Utc::now().timestamp_millis(),
            completed_at: None,
            destination_directory: None,
        };

        {
            let mut lock = self.active_sessions.lock().unwrap();
            self.scheduler
                .enqueue(transfer_id.clone(), priority, dedup_key, &lock)?;
            lock.insert(transfer_id.clone(), session.clone());
        }

        {
            let mut c_lock = self.cancellation_tokens.lock().unwrap();
            c_lock.insert(transfer_id.clone(), Arc::new(AtomicBool::new(false)));
            let mut p_lock = self.pause_tokens.lock().unwrap();
            p_lock.insert(transfer_id.clone(), Arc::new(AtomicBool::new(false)));
        }

        let _ = self.history.save_session(&session);
        self.sender.send_transfer_request(&session).await?;
        self.emit_event("transfer-updated", session.clone());

        Ok(session)
    }

    // --- Peer Acceptance / Rejection ---

    pub async fn handle_peer_accepted(&self, transfer_id: &str) -> Result<(), String> {
        let mut session = {
            let mut lock = self.active_sessions.lock().unwrap();
            let s = lock
                .get_mut(transfer_id)
                .ok_or_else(|| format!("Session {} not found", transfer_id))?;
            s.status = TransferStatus::Transferring;
            let cloned = s.clone();
            let _ = self.history.save_session(&cloned);
            cloned
        };

        self.emit_event("transfer-accepted", session.clone());

        let sender = self.sender.clone();
        let active_sessions = self.active_sessions.clone();
        let app_handle_opt = self.app_handle.clone();
        let history_repo = self.history.clone();
        let notifications = self.notifications.clone();
        let scheduler = self.scheduler.clone();

        let is_cancelled = {
            let lock = self.cancellation_tokens.lock().unwrap();
            lock.get(transfer_id)
                .cloned()
                .unwrap_or_else(|| Arc::new(AtomicBool::new(false)))
        };

        let is_paused = {
            let lock = self.pause_tokens.lock().unwrap();
            lock.get(transfer_id)
                .cloned()
                .unwrap_or_else(|| Arc::new(AtomicBool::new(false)))
        };

        let tx_id = transfer_id.to_string();

        tokio::spawn(async move {
            let handle_clone = app_handle_opt.clone();
            let res = sender
                .stream_session_files(&mut session, is_cancelled, is_paused, move |progress| {
                    if let Some(ref handle) = *handle_clone.lock().unwrap() {
                        let _ = handle.emit("transfer-progress", progress);
                    }
                })
                .await;

            let mut lock = active_sessions.lock().unwrap();
            if let Some(s) = lock.get_mut(&tx_id) {
                s.bytes_transferred = session.bytes_transferred;
                s.speed_bytes_per_sec = session.speed_bytes_per_sec;
                s.files = session.files;

                match res {
                    Ok(_) => {
                        s.status = TransferStatus::Completed;
                        s.completed_at = Some(chrono::Utc::now().timestamp_millis());
                        s.speed_bytes_per_sec = 0;
                        let label = s
                            .root_folder_name
                            .clone()
                            .unwrap_or_else(|| format!("{} file(s)", s.files.len()));
                        if let Some(ref handle) = *app_handle_opt.lock().unwrap() {
                            let _ = handle.emit("transfer-completed", s.clone());
                            notifications.send_notification(
                                Some(handle),
                                &format!("tx_complete_{}", tx_id),
                                "Transfer Completed",
                                &format!("Sent {} to {}", label, s.recipient_device_name),
                                "success",
                            );
                        }
                    }
                    Err(err) => {
                        s.status = if err.to_lowercase().contains("cancel") {
                            TransferStatus::Cancelled
                        } else {
                            TransferStatus::Failed
                        };
                        s.error_message = Some(err.clone());
                        s.speed_bytes_per_sec = 0;
                        if let Some(ref handle) = *app_handle_opt.lock().unwrap() {
                            let _ = handle.emit(
                                "transfer-failed",
                                serde_json::json!({ "transferId": tx_id, "error": err }),
                            );
                            notifications.send_notification(
                                Some(handle),
                                &format!("tx_fail_{}", tx_id),
                                "Transfer Interrupted",
                                &err,
                                "error",
                            );
                        }
                    }
                }

                scheduler.remove(&tx_id);
                let _ = history_repo.save_session(s);
            }
        });

        Ok(())
    }

    pub fn handle_peer_rejected(&self, transfer_id: &str, reason: &str) {
        let mut lock = self.active_sessions.lock().unwrap();
        if let Some(s) = lock.get_mut(transfer_id) {
            s.status = TransferStatus::Cancelled;
            s.error_message = Some(format!("Declined: {}", reason));
            self.scheduler.remove(transfer_id);
            let _ = self.history.save_session(s);
            self.emit_event("transfer-rejected", s.clone());
            self.notify(
                &format!("tx_rej_{}", transfer_id),
                "Transfer Declined",
                &format!("{} declined the transfer", s.recipient_device_name),
                "warning",
            );
        }
    }

    // --- Incoming Transfers Approval ---

    pub fn register_incoming_request(&self, session: TransferSession) {
        let sender_name = session.sender_device_name.clone();
        let tx_id = session.transfer_id.clone();
        let label = session
            .root_folder_name
            .clone()
            .unwrap_or_else(|| format!("{} file(s)", session.files.len()));

        let mut lock = self.pending_requests.lock().unwrap();
        lock.insert(tx_id.clone(), session.clone());
        drop(lock);

        self.emit_event("incoming-transfer-request", session);
        self.notify(
            &format!("tx_in_{}", tx_id),
            "Incoming Transfer Request",
            &format!("{} wants to send {}", sender_name, label),
            "info",
        );
    }

    pub async fn accept_transfer(&self, transfer_id: &str) -> Result<TransferSession, String> {
        let mut session = {
            let mut lock = self.pending_requests.lock().unwrap();
            lock.remove(transfer_id)
                .ok_or_else(|| format!("Pending transfer {} not found", transfer_id))?
        };

        session.status = TransferStatus::Transferring;
        session.destination_directory = Some(get_download_directory().to_string_lossy().to_string());

        for f in &session.files {
            self.receiver
                .prepare_file_reception(&session.transfer_id, f)
                .await?;
        }

        {
            let mut lock = self.active_sessions.lock().unwrap();
            let dedup_key = TransferScheduler::make_dedup_key(
                &session.sender_device_id,
                &[session
                    .root_folder_name
                    .clone()
                    .unwrap_or_else(|| session.transfer_id.clone())],
            );
            let _ = self
                .scheduler
                .enqueue(transfer_id.to_string(), session.priority, dedup_key, &lock);
            lock.insert(transfer_id.to_string(), session.clone());
        }

        let _ = self.history.save_session(&session);

        let accepted_payload = TransferAcceptedPayload {
            transfer_id: transfer_id.to_string(),
            accepted_file_ids: session.files.iter().map(|f| f.file_id.clone()).collect(),
            max_chunk_size: 65536,
        };

        let msg = ProtocolMessage::new(
            session.recipient_device_id.clone(),
            session.sender_device_id.clone(),
            MessageType::TransferAccepted,
            serde_json::to_value(accepted_payload).unwrap(),
        );

        let _ = self
            .sender
            .connection_manager
            .send_protocol_message(&session.sender_device_id, &msg)
            .await;

        self.emit_event("transfer-updated", session.clone());

        Ok(session)
    }

    pub async fn reject_transfer(&self, transfer_id: &str, reason: &str) -> Result<(), String> {
        let session_opt = {
            let mut lock = self.pending_requests.lock().unwrap();
            lock.remove(transfer_id)
        };

        if let Some(mut session) = session_opt {
            session.status = TransferStatus::Cancelled;
            session.error_message = Some(reason.to_string());
            session.completed_at = Some(chrono::Utc::now().timestamp_millis());
            let _ = self.history.save_session(&session);

            let rej_payload = TransferRejectedPayload {
                transfer_id: transfer_id.to_string(),
                reason: reason.to_string(),
                message: "User declined incoming transfer.".to_string(),
            };

            let msg = ProtocolMessage::new(
                session.recipient_device_id.clone(),
                session.sender_device_id.clone(),
                MessageType::TransferRejected,
                serde_json::to_value(rej_payload).unwrap(),
            );

            let _ = self
                .sender
                .connection_manager
                .send_protocol_message(&session.sender_device_id, &msg)
                .await;

            self.emit_event(
                "transfer-rejected",
                serde_json::json!({ "transferId": transfer_id, "reason": reason }),
            );
        }

        Ok(())
    }

    // --- Controls: Pause / Resume / Cancel / Priority / Retry / Queue ---

    pub fn pause_transfer(&self, transfer_id: &str) -> Result<(), String> {
        let mut lock = self.active_sessions.lock().unwrap();
        let s = lock
            .get_mut(transfer_id)
            .ok_or_else(|| format!("Active transfer {} not found", transfer_id))?;

        s.status = TransferStatus::Paused;
        s.speed_bytes_per_sec = 0;

        if let Some(token) = self.pause_tokens.lock().unwrap().get(transfer_id) {
            token.store(true, Ordering::SeqCst);
        }

        let _ = self.history.save_session(s);
        self.emit_event("transfer-updated", s.clone());
        Ok(())
    }

    pub fn resume_transfer(&self, transfer_id: &str) -> Result<(), String> {
        let mut lock = self.active_sessions.lock().unwrap();
        let s = lock
            .get_mut(transfer_id)
            .ok_or_else(|| format!("Active transfer {} not found", transfer_id))?;

        s.status = TransferStatus::Transferring;

        if let Some(token) = self.pause_tokens.lock().unwrap().get(transfer_id) {
            token.store(false, Ordering::SeqCst);
        }

        let _ = self.history.save_session(s);
        self.emit_event("transfer-updated", s.clone());
        Ok(())
    }

    pub fn cancel_transfer(&self, transfer_id: &str) -> Result<(), String> {
        if let Some(token) = self.cancellation_tokens.lock().unwrap().get(transfer_id) {
            token.store(true, Ordering::SeqCst);
        }

        let mut lock = self.active_sessions.lock().unwrap();
        if let Some(s) = lock.get_mut(transfer_id) {
            s.status = TransferStatus::Cancelled;
            s.speed_bytes_per_sec = 0;
            s.completed_at = Some(chrono::Utc::now().timestamp_millis());
            self.scheduler.remove(transfer_id);
            let _ = self.history.save_session(s);
            self.emit_event("transfer-cancelled", s.clone());
        }

        Ok(())
    }

    pub fn cancel_transfer_batch(&self) -> usize {
        let lock = self.active_sessions.lock().unwrap();
        let ids: Vec<String> = lock.keys().cloned().collect();
        drop(lock);

        let mut count = 0;
        for id in ids {
            if self.cancel_transfer(&id).is_ok() {
                count += 1;
            }
        }
        count
    }

    pub fn pause_all_transfers(&self) -> usize {
        let ids: Vec<String> = {
            let lock = self.active_sessions.lock().unwrap();
            lock.iter()
                .filter(|(_, s)| matches!(s.status, TransferStatus::Transferring | TransferStatus::Queued | TransferStatus::Preparing))
                .map(|(id, _)| id.clone())
                .collect()
        };

        let mut count = 0;
        for id in ids {
            if self.pause_transfer(&id).is_ok() {
                count += 1;
            }
        }
        count
    }

    pub fn resume_all_transfers(&self) -> usize {
        let ids: Vec<String> = {
            let lock = self.active_sessions.lock().unwrap();
            lock.iter()
                .filter(|(_, s)| matches!(s.status, TransferStatus::Paused))
                .map(|(id, _)| id.clone())
                .collect()
        };

        let mut count = 0;
        for id in ids {
            if self.resume_transfer(&id).is_ok() {
                count += 1;
            }
        }
        count
    }

    pub fn change_transfer_priority(
        &self,
        transfer_id: &str,
        priority: TransferPriority,
    ) -> Result<usize, String> {
        let pos = self.scheduler.update_priority(transfer_id, priority)?;
        let mut lock = self.active_sessions.lock().unwrap();
        if let Some(s) = lock.get_mut(transfer_id) {
            s.priority = priority;
            let _ = self.history.save_session(s);
            self.emit_event("transfer-updated", s.clone());
        }
        Ok(pos)
    }

    pub async fn retry_transfer(&self, transfer_id: &str) -> Result<TransferSession, String> {
        let old_session = self
            .get_transfer_details(transfer_id)
            .ok_or_else(|| format!("Transfer {} not found for retry", transfer_id))?;

        let new_id = Uuid::new_v4().to_string();
        let mut new_files = Vec::new();
        for f in old_session.files {
            new_files.push(TransferFileItem {
                file_id: Uuid::new_v4().to_string(),
                name: f.name,
                size: f.size,
                mime_type: f.mime_type,
                path: f.path,
                relative_path: f.relative_path,
                is_directory: f.is_directory,
                sha256_checksum: None,
                is_verified: false,
                bytes_transferred: 0,
                status: TransferStatus::WaitingForApproval,
            });
        }

        let new_session = TransferSession {
            transfer_id: new_id.clone(),
            direction: TransferDirection::Outgoing,
            sender_device_id: old_session.sender_device_id,
            sender_device_name: old_session.sender_device_name,
            sender_platform: old_session.sender_platform,
            recipient_device_id: old_session.recipient_device_id.clone(),
            recipient_device_name: old_session.recipient_device_name,
            recipient_ip: old_session.recipient_ip,
            recipient_port: old_session.recipient_port,
            files: new_files,
            total_bytes: old_session.total_bytes,
            bytes_transferred: 0,
            speed_bytes_per_sec: 0,
            estimated_seconds_remaining: None,
            status: TransferStatus::WaitingForApproval,
            priority: old_session.priority,
            is_folder: old_session.is_folder,
            root_folder_name: old_session.root_folder_name.clone(),
            error_message: None,
            started_at: chrono::Utc::now().timestamp_millis(),
            completed_at: None,
            destination_directory: None,
        };

        let dedup_key = TransferScheduler::make_dedup_key(
            &new_session.recipient_device_id,
            &[new_session
                .root_folder_name
                .clone()
                .unwrap_or_else(|| new_id.clone())],
        );

        {
            let mut lock = self.active_sessions.lock().unwrap();
            let _ = self
                .scheduler
                .enqueue(new_id.clone(), new_session.priority, dedup_key, &lock);
            lock.insert(new_id.clone(), new_session.clone());
        }

        {
            let mut c_lock = self.cancellation_tokens.lock().unwrap();
            c_lock.insert(new_id.clone(), Arc::new(AtomicBool::new(false)));
            let mut p_lock = self.pause_tokens.lock().unwrap();
            p_lock.insert(new_id.clone(), Arc::new(AtomicBool::new(false)));
        }

        let _ = self.history.save_session(&new_session);
        let _ = self.sender.send_transfer_request(&new_session).await;
        self.emit_event("transfer-updated", new_session.clone());

        Ok(new_session)
    }

    pub fn remove_transfer(&self, transfer_id: &str) -> Result<bool, String> {
        self.scheduler.remove(transfer_id);
        let mut lock = self.active_sessions.lock().unwrap();
        let removed = lock.remove(transfer_id).is_some();
        self.cancellation_tokens.lock().unwrap().remove(transfer_id);
        self.pause_tokens.lock().unwrap().remove(transfer_id);
        Ok(removed)
    }

    pub fn prepare_safe_shutdown(&self) {
        self.pause_all_transfers();
        let lock = self.active_sessions.lock().unwrap();
        for session in lock.values() {
            let _ = self.history.save_session(session);
        }
    }

    // --- Query, Queue, Background & Recovery APIs ---

    pub fn get_active_transfers(&self) -> Vec<TransferSession> {
        let lock = self.active_sessions.lock().unwrap();
        lock.values().cloned().collect()
    }

    pub fn get_transfer_details(&self, transfer_id: &str) -> Option<TransferSession> {
        if let Some(active) = self.active_sessions.lock().unwrap().get(transfer_id).cloned() {
            return Some(active);
        }
        self.history.get_transfer_details(transfer_id).ok().flatten()
    }

    pub fn get_transfer_queue(&self) -> Vec<QueuedTransferInfo> {
        let lock = self.active_sessions.lock().unwrap();
        self.scheduler.get_queue_snapshot(&lock)
    }

    pub fn get_background_transfer_status(&self) -> BackgroundTransferStatus {
        let lock = self.active_sessions.lock().unwrap();
        self.background.build_status(&lock)
    }

    pub fn get_recoverable_transfers(&self) -> Vec<RecoverableTransferInfo> {
        RecoveryManager::scan_recoverable_transfers(&self.history, &self.trusted_devices)
    }

    pub async fn recover_transfer(
        &self,
        transfer_id: &str,
        fresh_retry: bool,
    ) -> Result<TransferSession, String> {
        if fresh_retry {
            return self.retry_transfer(transfer_id).await;
        }
        let session = self
            .get_transfer_details(transfer_id)
            .ok_or_else(|| format!("Recoverable session {} not found", transfer_id))?;

        let mut restored = session.clone();
        restored.status = TransferStatus::Paused;
        {
            let mut lock = self.active_sessions.lock().unwrap();
            lock.insert(restored.transfer_id.clone(), restored.clone());
        }
        {
            let mut c_lock = self.cancellation_tokens.lock().unwrap();
            c_lock.insert(restored.transfer_id.clone(), Arc::new(AtomicBool::new(false)));
            let mut p_lock = self.pause_tokens.lock().unwrap();
            p_lock.insert(restored.transfer_id.clone(), Arc::new(AtomicBool::new(true)));
        }

        let _ = self.history.save_session(&restored);
        self.emit_event("transfer-updated", restored.clone());
        Ok(restored)
    }
}
