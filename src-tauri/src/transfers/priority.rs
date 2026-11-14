use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum TransferPriority {
    Low = 1,
    Normal = 2,
    High = 3,
}

impl Default for TransferPriority {
    fn default() -> Self {
        TransferPriority::Normal
    }
}

impl TransferPriority {
    pub fn from_i32(val: i32) -> Self {
        match val {
            1 => TransferPriority::Low,
            3 => TransferPriority::High,
            _ => TransferPriority::Normal,
        }
    }

    pub fn to_i32(&self) -> i32 {
        *self as i32
    }
}
