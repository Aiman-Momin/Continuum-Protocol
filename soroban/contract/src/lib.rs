#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Env, Symbol};

const DATA_KEY: Symbol = symbol_short!("DATA");
const LAST_ACTIVE_KEY: Symbol = symbol_short!("ACTIVE");

#[contract]
pub struct SimpleStorage;

#[contractimpl]
impl SimpleStorage {
    /// Stores a value and updates last_active timestamp
    pub fn set_data(env: Env, value: u64) {
        env.storage().instance().set(&DATA_KEY, &value);
        let timestamp = env.ledger().timestamp();
        env.storage().instance().set(&LAST_ACTIVE_KEY, &timestamp);
    }

    /// Retrieves the stored value
    pub fn get_data(env: Env) -> u64 {
        env.storage().instance().get(&DATA_KEY).unwrap_or(0)
    }

    /// Check-in: updates last_active timestamp
    pub fn check_in(env: Env) {
        let timestamp = env.ledger().timestamp();
        env.storage().instance().set(&LAST_ACTIVE_KEY, &timestamp);
    }

    /// Retrieves the last active timestamp
    pub fn get_last_active(env: Env) -> u64 {
        env.storage().instance().get(&LAST_ACTIVE_KEY).unwrap_or(0)
    }
}

mod test;
