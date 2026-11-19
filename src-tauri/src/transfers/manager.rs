use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use super::background::BackgroundTransferCoordinator;
use super::metadata::{TransferDirection, TransferFileItem, TransferSession, TransferStatus};
use super::priority::TransferPriority;
use super::queue::TransferQueue;
use super::receiver::FileReceiver;
use super::recovery::{RecoverableTransferInfo, RecoveryManager};
use super::scheduler::{QueuedTransferInfo, TransferScheduler};
use super::sender::FileSender;
use crate::audit::SecurityRepository;
use crate::file_system::selection::SelectedFile;
use crate::file_system::storage::get_download_directory;
use crate::folders::metadata::FolderMetadata;
use crate::folders::scanner::scan_directory;
use crate::history::repository::HistoryRepository;
use crate::io_optimizer::{
    check_available_disk_space, query_available_disk_bytes, ChunkBufferPool,
    WRITE_BUFFER_CAPACITY,
};
use crate::network_optimizer::NetworkOptimizer;
use crate::networking::ConnectionManager;
use crate::notifications::NotificationManager;
use crate::performance::metrics::{
    DiskThroughputMetrics, NetworkThroughputMetrics, TransferPerformanceMetrics,
    TransferQueueMetrics, TransferRecoveryStatus, TransferResourceUsage, TransferSpeedDetails,
};
use crate::performance::settings::{
    load_optimization_settings, save_optimization_settings, TransferOptimizationSettings,
};
use crate::protocol::messages::{
    MessageType, ProtocolMessage, TransferAcceptedPayload, TransferRejectedPayload,
};
use crate::system_tray::BackgroundTransferStatus;
use crate::throughput_monitor::ThroughputMonitor;
use crate::transfer_optimizer::ConcurrencyCoordinator;
use crate::trusted_devices::TrustedDeviceManager;

pub struct TransferManager {
    pub active_sessions: Arc<Mutex<HashMap<String, TransferSession>>>,
    pub pending_requests: Arc<Mutex<HashMap<String, TransferSession>>>,
    pub selected_files: Arc<Mutex<Vec<SelectedFile>>>,
    pub selected_folders: Arc<Mutex<Vec<FolderMetadata>>>,
    pub cancellation_tokens: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub pause_tokens: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub retry_counters: Arc<Mutex<HashMap<String, u32>>>,
    pub scheduler: Arc<TransferScheduler>,
    pub transfer_queue: Arc<TransferQueue>,
    pub background: Arc<BackgroundTransferCoordinator>,
    pub receiver: Arc<FileReceiver>,
    pub sender: Arc<FileSender>,
    pub history: Arc<HistoryRepository>,
    pub notifications: Arc<NotificationManager>,
    pub trusted_devices: Arc<TrustedDeviceManager>,
    pub security_repo: Arc<SecurityRepository>,
    pub optimization_settings: Arc<Mutex<TransferOptimizationSettings>>,
    pub throughput_monitor: Arc<ThroughputMonitor>,
    pub buffer_pool: Arc<ChunkBufferPool>,
    pub concurrency: Arc<ConcurrencyCoordinator>,
    pub network_optimizer: Arc<NetworkOptimizer>,
    connection_manager: Arc<ConnectionManager>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
}

impl TransferManager {
    pub fn new(
        connection_manager: Arc<ConnectionManager>,
        history: Arc<HistoryRepository>,
        notifications: Arc<NotificationManager>,
        trusted_devices: Arc<TrustedDeviceManager>,
        security_repo: Arc<SecurityRepository>,
    ) -> Self {
        let initial_settings = load_optimization_settings(&security_repo);
        let transfer_queue = Arc::new(TransferQueue::new());
        transfer_queue.set_max_concurrent(initial_settings.max_concurrent_transfers);

        let buffer_pool = Arc::new(ChunkBufferPool::new());
        let throughput_monitor = Arc::new(ThroughputMonitor::new(
            initial_settings.default_chunk_bytes(),
        ));
        let concurrency = Arc::new(ConcurrencyCoordinator::new(
            initial_settings.max_concurrent_file_ops,
            initial_settings.max_concurrent_chunk_ops,
        ));

        let receiver = Arc::new(FileReceiver::new(
            Arc::clone(&buffer_pool),
            Arc::clone(&throughput_monitor),
        ));
        let sender = Arc::new(FileSender::new(
            Arc::clone(&connection_manager),
            Arc::clone(&buffer_pool),
            Arc::clone(&throughput_monitor),
            Arc::clone(&concurrency),
        ));

        Self {
            active_sessions: Arc::new(Mutex::new(HashMap::new())),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            selected_files: Arc::new(Mutex::new(Vec::new())),
            selected_folders: Arc::new(Mutex::new(Vec::new())),
            cancellation_tokens: Arc::new(Mutex::new(HashMap::new())),
            pause_tokens: Arc::new(Mutex::new(HashMap::new())),
            retry_counters: Arc::new(Mutex::new(HashMap::new())),
            scheduler: Arc::new(TransferScheduler::new()),
            transfer_queue,
            background: Arc::new(BackgroundTransferCoordinator::new()),
            receiver,
            sender,
            history,
            notifications,
            trusted_devices,
            security_repo,
            optimization_settings: Arc::new(Mutex::new(initial_settings)),
            throughput_monitor,
            buffer_pool,
            concurrency,
            network_optimizer: Arc::new(NetworkOptimizer::new()),
            connection_manager,
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
        let total_bytes: u64 = files_to_send
            .iter()
            .try_fold(0u64, |acc, f| acc.checked_add(f.size))
            .ok_or_else(|| "Total transfer size exceeds 64-bit limit".to_string())?;

        let default_prio = self.optimization_settings.lock().unwrap().default_priority;
        let priority = priority.unwrap_or(default_prio);

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
                .enqueue_with_size(transfer_id.clone(), priority, total_bytes, dedup_key, &lock)?;
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
        self.emit_event("transfer_queue_update", self.get_transfer_queue_metrics());

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
        let default_prio = self.optimization_settings.lock().unwrap().default_priority;
        let priority = priority.unwrap_or(default_prio);

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
            total_bytes = total_bytes
                .checked_add(folder.total_bytes)
                .ok_or_else(|| "Folder batch size overflows 64-bit limit".to_string())?;
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
                .enqueue_with_size(transfer_id.clone(), priority, total_bytes, dedup_key, &lock)?;
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
        self.emit_event("transfer_queue_update", self.get_transfer_queue_metrics());

        Ok(session)
    }

    // --- Peer Acceptance / Rejection ---

    pub async fn handle_peer_accepted(&self, transfer_id: &str) -> Result<(), String> {
        let mut session = {
            let mut lock = self.active_sessions.lock().unwrap();
            let s = lock
                .get_mut(transfer_id)
                .ok_or_else(|| format!("Session {} not found", transfer_id))?;
            if self.transfer_queue.acquire_slot() {
                s.status = TransferStatus::Transferring;
            } else {
                s.status = TransferStatus::Queued;
            }
            let cloned = s.clone();
            let _ = self.history.save_session(&cloned);
            cloned
        };

        self.emit_event("transfer-accepted", session.clone());
        self.emit_event("transfer_queue_update", self.get_transfer_queue_metrics());

        let sender = self.sender.clone();
        let active_sessions = self.active_sessions.clone();
        let app_handle_opt = self.app_handle.clone();
        let history_repo = self.history.clone();
        let notifications = self.notifications.clone();
        let scheduler = self.scheduler.clone();
        let transfer_queue = self.transfer_queue.clone();
        let throughput_monitor = self.throughput_monitor.clone();
        let buffer_pool = self.buffer_pool.clone();
        let opt_settings_arc = self.optimization_settings.clone();
        let network_optimizer = self.network_optimizer.clone();
        let conn_mgr = self.connection_manager.clone();

        let retry_count_current = self
            .retry_counters
            .lock()
            .unwrap()
            .get(transfer_id)
            .copied()
            .unwrap_or(0);

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
            // Wait fairly if queued behind higher-priority or earlier transfers
            while matches!(session.status, TransferStatus::Queued) {
                if is_cancelled.load(Ordering::SeqCst) {
                    return;
                }
                if transfer_queue.acquire_slot() {
                    session.status = TransferStatus::Transferring;
                    if let Ok(mut lock) = active_sessions.lock() {
                        if let Some(s) = lock.get_mut(&tx_id) {
                            s.status = TransferStatus::Transferring;
                        }
                    }
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            }

            let opt_snapshot = opt_settings_arc.lock().unwrap().clone();
            let handle_for_progress = app_handle_opt.clone();
            let tm_for_progress = throughput_monitor.clone();
            let sessions_for_progress = active_sessions.clone();
            let scheduler_for_progress = scheduler.clone();
            let pool_for_progress = buffer_pool.clone();
            let net_opt_progress = network_optimizer.clone();
            let conn_mgr_progress = conn_mgr.clone();
            let tx_id_inner = tx_id.clone();

            let res = sender
                .stream_session_files(
                    &mut session,
                    opt_snapshot.clone(),
                    None,
                    retry_count_current,
                    is_cancelled,
                    is_paused,
                    move |progress| {
                        // Sync live session snapshot
                        let snapshot_perf = {
                            let mut s_lock = sessions_for_progress.lock().unwrap();
                            if let Some(s) = s_lock.get_mut(&tx_id_inner) {
                                s.bytes_transferred = progress.bytes_transferred;
                                s.speed_bytes_per_sec = progress.speed_bytes_per_sec;
                                s.estimated_seconds_remaining = progress.estimated_seconds_remaining;
                            }
                            let (_, _, _, active_buf, _) = pool_for_progress.snapshot();
                            tm_for_progress.build_performance_metrics(
                                &s_lock,
                                scheduler_for_progress.len(),
                                opt_snapshot.adaptive_chunking_enabled,
                                active_buf,
                            )
                        };

                        if let Some(ref handle) = *handle_for_progress.lock().unwrap() {
                            let _ = handle.emit("transfer-progress", progress.clone());
                            if tm_for_progress.should_emit_channel("transfer_speed_update") {
                                let _ = handle.emit("transfer_speed_update", progress);
                            }
                            if tm_for_progress.should_emit_channel("transfer_performance_update") {
                                let _ = handle.emit("transfer_performance_update", snapshot_perf);
                            }
                            if tm_for_progress.should_emit_channel("network_throughput_update") {
                                let conns = conn_mgr_progress.get_connections();
                                let stats = conn_mgr_progress.get_stats();
                                let (ip, changed_at, _) = net_opt_progress.check_interface_change();
                                let assess = net_opt_progress.assess_link_quality(
                                    &conns,
                                    retry_count_current,
                                    0,
                                );
                                let net_metrics = tm_for_progress.build_network_metrics(
                                    stats.total_tx_bytes,
                                    stats.total_rx_bytes,
                                    stats.active_connections_count,
                                    assess.quality.clone(),
                                    assess.average_latency_ms,
                                    net_opt_progress.congestion_count(),
                                    ip.clone(),
                                    changed_at,
                                );
                                let _ = handle.emit("network_throughput_update", net_metrics);
                                let _ = handle.emit(
                                    "network_quality_update",
                                    net_opt_progress.to_quality_event(&assess, ip),
                                );
                            }
                        }
                    },
                )
                .await;

            transfer_queue.release_slot();
            throughput_monitor.reset_transfer_speed(&tx_id);

            let mut lock = active_sessions.lock().unwrap();
            if let Some(s) = lock.get_mut(&tx_id) {
                s.bytes_transferred = session.bytes_transferred;
                s.speed_bytes_per_sec = 0;
                s.estimated_seconds_remaining = None;
                s.files = session.files;

                match res {
                    Ok(_) => {
                        s.status = TransferStatus::Completed;
                        s.completed_at = Some(chrono::Utc::now().timestamp_millis());
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
                        let is_cancel = err.to_lowercase().contains("cancel");
                        s.status = if is_cancel {
                            TransferStatus::Cancelled
                        } else {
                            throughput_monitor.record_failure();
                            TransferStatus::Failed
                        };
                        s.error_message = Some(err.clone());
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

        let download_dir = get_download_directory();
        let disk_check = check_available_disk_space(&download_dir, session.total_bytes);
        if !disk_check.sufficient {
            return Err(disk_check.message);
        }

        session.status = TransferStatus::Transferring;
        session.destination_directory = Some(download_dir.to_string_lossy().to_string());

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
            let _ = self.scheduler.enqueue_with_size(
                transfer_id.to_string(),
                session.priority,
                session.total_bytes,
                dedup_key,
                &lock,
            );
            lock.insert(transfer_id.to_string(), session.clone());
        }

        let _ = self.history.save_session(&session);

        let chunk_bytes = self
            .optimization_settings
            .lock()
            .unwrap()
            .default_chunk_bytes()
            .min(1_048_576);

        let accepted_payload = TransferAcceptedPayload {
            transfer_id: transfer_id.to_string(),
            accepted_file_ids: session.files.iter().map(|f| f.file_id.clone()).collect(),
            max_chunk_size: chunk_bytes,
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
        self.emit_event("transfer_queue_update", self.get_transfer_queue_metrics());

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

        self.throughput_monitor.reset_transfer_speed(transfer_id);

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

    pub fn cancel_transfers_for_device(&self, device_id: &str) -> usize {
        let matching_ids: Vec<String> = {
            let lock = self.active_sessions.lock().unwrap();
            lock.iter()
                .filter(|(_, s)| {
                    (s.sender_device_id == device_id || s.recipient_device_id == device_id)
                        && !matches!(
                            s.status,
                            TransferStatus::Completed
                                | TransferStatus::Cancelled
                                | TransferStatus::Failed
                        )
                })
                .map(|(id, _)| id.clone())
                .collect()
        };

        let mut cancelled = 0;
        for id in matching_ids {
            if self.cancel_transfer(&id).is_ok() {
                cancelled += 1;
            }
        }
        cancelled
    }

    pub fn pause_all_transfers(&self) -> usize {
        let ids: Vec<String> = {
            let lock = self.active_sessions.lock().unwrap();
            lock.iter()
                .filter(|(_, s)| {
                    matches!(
                        s.status,
                        TransferStatus::Transferring
                            | TransferStatus::Queued
                            | TransferStatus::Preparing
                    )
                })
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
        drop(lock);
        self.emit_event("transfer_queue_update", self.get_transfer_queue_metrics());
        Ok(pos)
    }

    pub async fn retry_transfer(&self, transfer_id: &str) -> Result<TransferSession, String> {
        let old_session = self
            .get_transfer_details(transfer_id)
            .ok_or_else(|| format!("Transfer {} not found for retry", transfer_id))?;

        let prev_retries = {
            let lock = self.retry_counters.lock().unwrap();
            lock.get(transfer_id).copied().unwrap_or(0)
        };
        let next_retries = prev_retries + 1;
        self.throughput_monitor.record_retry();
        self.throughput_monitor.reset_transfer_speed(transfer_id);

        let new_id = Uuid::new_v4().to_string();
        self.retry_counters
            .lock()
            .unwrap()
            .insert(new_id.clone(), next_retries);

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
            let _ = self.scheduler.enqueue_with_size(
                new_id.clone(),
                new_session.priority,
                new_session.total_bytes,
                dedup_key,
                &lock,
            );
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
        self.throughput_monitor.reset_transfer_speed(transfer_id);
        let mut lock = self.active_sessions.lock().unwrap();
        let removed = lock.remove(transfer_id).is_some();
        self.cancellation_tokens.lock().unwrap().remove(transfer_id);
        self.pause_tokens.lock().unwrap().remove(transfer_id);
        self.retry_counters.lock().unwrap().remove(transfer_id);
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

    pub fn optimize_transfer_queue(&self) -> Vec<QueuedTransferInfo> {
        let lock = self.active_sessions.lock().unwrap();
        let optimized = self.scheduler.optimize_queue(&lock);
        drop(lock);
        self.emit_event("transfer_queue_update", self.get_transfer_queue_metrics());
        optimized
    }

    pub fn get_background_transfer_status(&self) -> BackgroundTransferStatus {
        let lock = self.active_sessions.lock().unwrap();
        self.background.build_status(&lock)
    }

    pub fn get_recoverable_transfers(&self) -> Vec<RecoverableTransferInfo> {
        self.get_transfer_recovery_status().items
    }

    pub fn get_transfer_recovery_status(&self) -> TransferRecoveryStatus {
        let status = RecoveryManager::scan_recoverable_transfers_checked(
            &self.history,
            &self.trusted_devices,
            Some(&self.security_repo),
        );
        self.emit_event("transfer_recovery_update", status.clone());
        status
    }

    pub async fn recover_transfer(
        &self,
        transfer_id: &str,
        fresh_retry: bool,
    ) -> Result<TransferSession, String> {
        if fresh_retry {
            return self.retry_transfer(transfer_id).await;
        }

        let recovery = self.get_transfer_recovery_status();
        if let Some(item) = recovery.items.iter().find(|r| r.transfer_id == transfer_id) {
            if !item.can_resume {
                return Err(format!("Cannot safely resume transfer: {}", item.reason));
            }
        }

        let session = self
            .get_transfer_details(transfer_id)
            .ok_or_else(|| format!("Recoverable session {} not found", transfer_id))?;

        self.throughput_monitor.reset_transfer_speed(transfer_id);

        let mut restored = session.clone();
        restored.status = TransferStatus::Paused;
        restored.speed_bytes_per_sec = 0;
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

    // --- Phase 7: Performance Metrics, Settings & Resource Inspection ---

    pub fn get_optimization_settings(&self) -> TransferOptimizationSettings {
        self.optimization_settings.lock().unwrap().clone()
    }

    pub async fn update_optimization_settings(
        &self,
        settings: TransferOptimizationSettings,
    ) -> Result<TransferOptimizationSettings, String> {
        let saved = save_optimization_settings(&self.security_repo, settings)?;
        self.transfer_queue
            .set_max_concurrent(saved.max_concurrent_transfers);
        self.throughput_monitor
            .set_current_chunk_size(saved.default_chunk_bytes());
        self.concurrency
            .reconfigure(saved.max_concurrent_file_ops, saved.max_concurrent_chunk_ops)
            .await;

        *self.optimization_settings.lock().unwrap() = saved.clone();
        self.emit_event(
            "transfer_performance_update",
            self.get_transfer_performance_metrics(),
        );
        Ok(saved)
    }

    pub fn get_transfer_performance_metrics(&self) -> TransferPerformanceMetrics {
        let sessions = self.active_sessions.lock().unwrap();
        let opt = self.optimization_settings.lock().unwrap();
        let (_, _, _, active_buf, _) = self.buffer_pool.snapshot();
        self.throughput_monitor.build_performance_metrics(
            &sessions,
            self.scheduler.len(),
            opt.adaptive_chunking_enabled,
            active_buf,
        )
    }

    pub fn get_network_throughput(&self) -> NetworkThroughputMetrics {
        let conns = self.connection_manager.get_connections();
        let stats = self.connection_manager.get_stats();
        let (ip, changed_at, _) = self.network_optimizer.check_interface_change();
        let perf = self.get_transfer_performance_metrics();
        let assess =
            self.network_optimizer
                .assess_link_quality(&conns, 0, perf.combined_throughput_bps);

        self.throughput_monitor.build_network_metrics(
            stats.total_tx_bytes,
            stats.total_rx_bytes,
            stats.active_connections_count,
            assess.quality,
            assess.average_latency_ms,
            self.network_optimizer.congestion_count(),
            ip,
            changed_at,
        )
    }

    pub fn get_disk_throughput(&self) -> DiskThroughputMetrics {
        let download_dir = get_download_directory();
        let avail = query_available_disk_bytes(&download_dir);
        self.throughput_monitor.build_disk_metrics(
            WRITE_BUFFER_CAPACITY,
            avail,
            download_dir.to_string_lossy().to_string(),
        )
    }

    pub fn get_transfer_speed_details(
        &self,
        transfer_id: &str,
    ) -> Result<TransferSpeedDetails, String> {
        let session = self
            .get_transfer_details(transfer_id)
            .ok_or_else(|| format!("Transfer {} not found", transfer_id))?;
        Ok(self.throughput_monitor.get_transfer_speed_details(&session))
    }

    pub fn get_transfer_queue_metrics(&self) -> TransferQueueMetrics {
        let sessions = self.active_sessions.lock().unwrap();
        let max_conc = self.transfer_queue.max_concurrent();
        self.scheduler.get_queue_metrics(&sessions, max_conc)
    }

    pub fn get_transfer_resource_usage(&self) -> TransferResourceUsage {
        let (handles, active_bufs, pooled_avail, buf_bytes, peak_buf_bytes) =
            self.buffer_pool.snapshot();
        let (active_file_ops, max_file_ops, active_chunk_ops, max_chunk_ops) =
            self.concurrency.snapshot();
        let opt = self.optimization_settings.lock().unwrap().clone();
        let active_net_conns = self.connection_manager.get_stats().active_connections_count;

        TransferResourceUsage {
            active_file_handles: handles,
            active_chunk_buffers: active_bufs,
            pooled_buffers_available: pooled_avail,
            buffer_memory_bytes: buf_bytes,
            peak_buffer_memory_bytes: peak_buf_bytes,
            active_concurrent_transfers: self.transfer_queue.active_count(),
            max_concurrent_transfers: self.transfer_queue.max_concurrent(),
            active_file_ops,
            max_concurrent_file_ops: max_file_ops,
            active_network_connections: active_net_conns,
            max_concurrent_connections: opt.max_concurrent_connections,
            active_chunk_ops,
            max_concurrent_chunk_ops: max_chunk_ops,
        }
    }
}
