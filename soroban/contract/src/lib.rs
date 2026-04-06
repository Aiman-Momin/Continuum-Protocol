#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Vec,
};
use soroban_sdk::token;

const DATA_KEY: Symbol = symbol_short!("DATA"); // demo only
const LAST_ACTIVE_NS: Symbol = symbol_short!("ACTV");
const NOMINEES_NS: Symbol = symbol_short!("NOMS");
const TIMELINE_NS: Symbol = symbol_short!("TIME");
const DISTRIB_NS: Symbol = symbol_short!("DIST");
const TOKEN_KEY: Symbol = symbol_short!("TOKN");
const BAL_NS: Symbol = symbol_short!("BALN");
const DEP_NS: Symbol = symbol_short!("DEPO");
const EXEC_BPS_NS: Symbol = symbol_short!("EXBP");

// IMPORTANT:
// Soroban TTL units are LEDGERS, not seconds.
// We keep conservative defaults and clamp against network limits at runtime.
const TTL_LEDGER_BUMP: u32 = 20_000;
const TTL_LEDGER_MIN: u32 = 1_000;

#[contract]
pub struct SimpleStorage;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContinuumError {
    NotInitialized = 1,
    NoActivity = 2,
    NotExpired = 3,
    NothingToExecute = 4,
    InsufficientVaultBalance = 5,
}

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

fn get_token(env: &Env) -> Result<token::Client<'_>, ContinuumError> {
    let token_addr: Address = env
        .storage()
        .instance()
        .get(&TOKEN_KEY)
        .ok_or(ContinuumError::NotInitialized)?;
    Ok(token::Client::new(env, &token_addr))
}

fn bump_owner_key(env: &Env, key: &(Symbol, Address)) {
    env.storage()
        .persistent()
        .extend_ttl(key, TTL_LEDGER_MIN, TTL_LEDGER_BUMP);
}

fn get_owner_i128(env: &Env, ns: Symbol, owner: &Address) -> i128 {
    let key = (ns, owner.clone());
    env.storage().persistent().get(&key).unwrap_or(0_i128)
}

fn put_owner_i128(env: &Env, ns: Symbol, owner: &Address, v: i128) {
    let key = (ns, owner.clone());
    env.storage().persistent().set(&key, &v);
    bump_owner_key(env, &key);
}

fn get_owner_u32(env: &Env, ns: Symbol, owner: &Address) -> u32 {
    let key = (ns, owner.clone());
    env.storage().persistent().get(&key).unwrap_or(0_u32)
}

fn put_owner_u32(env: &Env, ns: Symbol, owner: &Address, v: u32) {
    let key = (ns, owner.clone());
    env.storage().persistent().set(&key, &v);
    bump_owner_key(env, &key);
}

fn put_owner_u64(env: &Env, ns: Symbol, owner: &Address, v: u64) {
    let key = (ns, owner.clone());
    env.storage().persistent().set(&key, &v);
    bump_owner_key(env, &key);
}

fn touch_last_active(env: &Env, owner: &Address) {
    let now = env.ledger().timestamp();
    put_owner_u64(env, LAST_ACTIVE_NS, owner, now);
}

fn elapsed_days(now_sec: u64, last_active_sec: u64) -> u32 {
    if now_sec <= last_active_sec {
        return 0;
    }
    let delta = now_sec - last_active_sec;
    (delta / 86_400) as u32
}

#[contractimpl]
impl SimpleStorage {
    /// Initialize token contract to use for escrowed funds (e.g., native XLM token contract).
    pub fn init(env: Env, token_contract: Address) {
        // only allow first init
        if env.storage().instance().has(&TOKEN_KEY) {
            return;
        }
        env.storage().instance().set(&TOKEN_KEY, &token_contract);
    }

    /// Deposit escrow funds into the contract vault for the owner.
    pub fn deposit(env: Env, owner: Address, amount: i128) -> Result<(), ContinuumError> {
        owner.require_auth();
        let client = get_token(&env)?;
        // Transfer from owner -> contract. Token contract enforces auth on `owner`.
        client.transfer(&owner, &env.current_contract_address(), &amount);

        let bal = get_owner_i128(&env, BAL_NS, &owner);
        let dep = get_owner_i128(&env, DEP_NS, &owner);
        put_owner_i128(&env, BAL_NS, &owner, bal + amount);
        put_owner_i128(&env, DEP_NS, &owner, dep + amount);
        // Note: Deposit does not reset inactivity timer; only check_in does.
        Ok(())
    }

    /// Returns the tracked vault balance for the owner.
    pub fn get_vault_balance(env: Env, owner: Address) -> i128 {
        get_owner_i128(&env, BAL_NS, &owner)
    }

    /// Execute all eligible distribution phases (anyone can call once inactivity thresholds are reached).
    pub fn execute_distribution(env: Env, owner: Address) -> Result<u32, ContinuumError> {
        // Ensure init
        if !env.storage().instance().has(&TOKEN_KEY) {
            return Err(ContinuumError::NotInitialized);
        }

        let last_active = Self::get_last_active(env.clone(), owner.clone());
        if last_active == 0 {
            return Err(ContinuumError::NoActivity);
        }

        let now = env.ledger().timestamp();
        let days = elapsed_days(now, last_active);

        let phases = Self::get_distributions(env.clone(), owner.clone());
        if phases.len() == 0 {
            return Err(ContinuumError::NothingToExecute);
        }

        // Track cumulative bps executed so far
        let mut executed_bps = get_owner_u32(&env, EXEC_BPS_NS, &owner);
        if executed_bps >= 10_000 {
            return Err(ContinuumError::NothingToExecute);
        }

        let client = get_token(&env)?;
        let total_deposited = get_owner_i128(&env, DEP_NS, &owner);
        let mut vault_balance = get_owner_i128(&env, BAL_NS, &owner);
        let mut executed_now_bps: u32 = 0;

        // Build sorted list of phase indices by inactivity_days (ascending)
        let mut sorted_indices = Vec::<u32>::new(&env);
        for _ in 0..phases.len() {
            let mut min_idx: i32 = -1;
            let mut min_days: u32 = u32::MAX;
            for i in 0..phases.len() {
                let phase = phases.get(i).unwrap();
                let mut already_added = false;
                for j in 0..sorted_indices.len() {
                    if sorted_indices.get(j).unwrap() == i {
                        already_added = true;
                        break;
                    }
                }
                if !already_added && phase.inactivity_days < min_days {
                    min_idx = i as i32;
                    min_days = phase.inactivity_days;
                }
            }
            if min_idx >= 0 {
                sorted_indices.push_back(min_idx as u32);
            }
        }

        // Execute phases in order
        for i in 0..sorted_indices.len() {
            let phase_idx = sorted_indices.get(i).unwrap();
            let phase = phases.get(phase_idx).unwrap();

            // Skip if inactivity threshold not met yet
            if phase.inactivity_days > days {
                continue;
            }

            // Calculate phase total bps
            let mut phase_bps: u32 = 0;
            for k in 0..phase.entries.len() {
                phase_bps += phase.entries.get(k).unwrap().bps;
            }

            // Skip if this phase was already executed
            if executed_bps >= phase_bps {
                executed_bps -= phase_bps;
                continue;
            }

            // Execute this phase: transfer to all recipients
            for k in 0..phase.entries.len() {
                let entry = phase.entries.get(k).unwrap();
                let amt = (total_deposited * (entry.bps as i128)) / 10_000_i128;
                if amt > 0 {
                    if vault_balance < amt {
                        return Err(ContinuumError::InsufficientVaultBalance);
                    }
                    client.transfer(&env.current_contract_address(), &entry.address, &amt);
                    vault_balance -= amt;
                }
            }

            executed_now_bps += phase_bps;
            executed_bps = 0; // Move to next phase
        }

        if executed_now_bps == 0 {
            return Err(ContinuumError::NothingToExecute);
        }

        put_owner_u32(&env, EXEC_BPS_NS, &owner, executed_now_bps);
        put_owner_i128(&env, BAL_NS, &owner, vault_balance);

        Ok(executed_now_bps)
    }

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
        let key = (NOMINEES_NS, owner.clone());
        env.storage().persistent().set(&key, &nominees);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_LEDGER_MIN, TTL_LEDGER_BUMP);
        // Note: Setting nominees does not reset inactivity timer; only check_in does.
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
        let key = (TIMELINE_NS, owner.clone());
        env.storage().persistent().set(&key, &stages);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_LEDGER_MIN, TTL_LEDGER_BUMP);
        // Note: Setting timeline does not reset inactivity timer; only check_in does.
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
        let key = (DISTRIB_NS, owner.clone());
        env.storage().persistent().set(&key, &phases);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_LEDGER_MIN, TTL_LEDGER_BUMP);
        // Note: Setting distributions does not reset inactivity timer; only check_in does.
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
