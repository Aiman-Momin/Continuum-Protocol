#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Vec,
};

const DATA_KEY: Symbol = symbol_short!("DATA"); // demo only
const LAST_ACTIVE_NS: Symbol = symbol_short!("ACTV");
const NOMINEES_NS: Symbol = symbol_short!("NOMS");
const TIMELINE_NS: Symbol = symbol_short!("TIME");
const DISTRIB_NS: Symbol = symbol_short!("DIST");

const TTL_LEDGER_BUMP: u32 = 60 * 60 * 24 * 30; // ~30 days worth of ledgers is network-dependent; bump on writes
const TTL_LEDGER_MIN: u32 = 60 * 60 * 24 * 7; // ~7 days

#[contract]
pub struct SimpleStorage;

#[contracttype]
#[derive(Clone)]
pub struct Nominee {
    pub address: Address,
    pub role: Symbol,
    /// Percentage in basis points (10000 = 100.00%)
    pub bps: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct TimelineStage {
    /// Unix timestamp in seconds
    pub when: u64,
    /// Amount in stroops (1 XLM = 10_000_000 stroops) or any unit you decide.
    /// Keeping it generic for now.
    pub amount: i128,
    pub memo: Symbol,
}

#[contracttype]
#[derive(Clone)]
pub struct DistributionEntry {
    pub address: Address,
    /// Percentage in basis points (10000 = 100.00%)
    pub bps: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct DistributionPhase {
    pub inactivity_days: u32,
    pub entries: Vec<DistributionEntry>,
}

#[contractimpl]
impl SimpleStorage {
    /// Stores a value and updates last_active timestamp
    pub fn set_data(env: Env, value: u64) {
        env.storage().instance().set(&DATA_KEY, &value);
        // Demo function: keeps old behavior (global), not used by Continuum config.
        // Real activity tracking is per-owner via check_in(owner).
    }

    /// Retrieves the stored value
    pub fn get_data(env: Env) -> u64 {
        env.storage().instance().get(&DATA_KEY).unwrap_or(0)
    }

    /// Check-in: updates last_active timestamp for the owner (requires auth)
    pub fn check_in(env: Env, owner: Address) {
        owner.require_auth();
        let timestamp = env.ledger().timestamp();
        let key = (LAST_ACTIVE_NS, owner.clone());
        env.storage().persistent().set(&key, &timestamp);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_LEDGER_MIN, TTL_LEDGER_BUMP);
    }

    /// Retrieves the last active timestamp for the owner
    pub fn get_last_active(env: Env, owner: Address) -> u64 {
        let key = (LAST_ACTIVE_NS, owner);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    /// Store nominees for an owner (requires auth)
    pub fn set_nominees(env: Env, owner: Address, nominees: Vec<Nominee>) {
        owner.require_auth();
        let key = (NOMINEES_NS, owner);
        env.storage().persistent().set(&key, &nominees);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_LEDGER_MIN, TTL_LEDGER_BUMP);
    }

    /// Load nominees for an owner
    pub fn get_nominees(env: Env, owner: Address) -> Vec<Nominee> {
        let key = (NOMINEES_NS, owner);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env))
    }

    /// Store release timeline for an owner (requires auth)
    pub fn set_timeline(env: Env, owner: Address, stages: Vec<TimelineStage>) {
        owner.require_auth();
        let key = (TIMELINE_NS, owner);
        env.storage().persistent().set(&key, &stages);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_LEDGER_MIN, TTL_LEDGER_BUMP);
    }

    /// Load release timeline for an owner
    pub fn get_timeline(env: Env, owner: Address) -> Vec<TimelineStage> {
        let key = (TIMELINE_NS, owner);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env))
    }

    /// Store inactivity distribution phases for an owner (requires auth)
    pub fn set_distributions(env: Env, owner: Address, phases: Vec<DistributionPhase>) {
        owner.require_auth();
        let key = (DISTRIB_NS, owner);
        env.storage().persistent().set(&key, &phases);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_LEDGER_MIN, TTL_LEDGER_BUMP);
    }

    /// Load inactivity distribution phases for an owner
    pub fn get_distributions(env: Env, owner: Address) -> Vec<DistributionPhase> {
        let key = (DISTRIB_NS, owner);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env))
    }
}

mod test;
