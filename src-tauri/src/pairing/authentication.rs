use crate::security::{generate_secure_token, hash_token};

pub struct AuthCredentials {
    pub raw_token: String,
    pub token_hash: String,
}

pub fn generate_device_auth_credentials() -> AuthCredentials {
    let raw_token = generate_secure_token(32);
    let token_hash = hash_token(&raw_token);
    AuthCredentials {
        raw_token,
        token_hash,
    }
}
