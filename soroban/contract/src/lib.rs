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
        touch_last_active(&env, &owner);
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

        // Determine what bps has already been executed.
        let mut executed_bps = get_owner_u32(&env, EXEC_BPS_NS, &owner);

        // Execute phases in ascending inactivity_days.
        let client = get_token(&env)?;
        let total_deposited = get_owner_i128(&env, DEP_NS, &owner);
        let mut vault_balance = get_owner_i128(&env, BAL_NS, &owner);

        let mut executed_now_bps: u32 = 0;

        // selection-sort like scan without allocation
        let mut used = Vec::<u32>::new(&env);
        for _ in 0..phases.len() {
            // find next smallest inactivity_days not used
            let mut min_idx: i32 = -1;
            let mut min_days: u32 = 0;
            for i in 0..phases.len() {
                let d = phases.get(i).unwrap().inactivity_days;
                let mut already = false;
                for j in 0..used.len() {
                    if used.get(j).unwrap() == i {
                        already = true;
                        break;
                    }
                }
                if already {
                    continue;
                }
                if min_idx == -1 || d < min_days {
                    min_idx = i as i32;
                    min_days = d;
                }
            }

            if min_idx == -1 {
                break;
            }
            used.push_back(min_idx as u32);

            let phase = phases.get(min_idx as u32).unwrap();
            if phase.inactivity_days > days {
                continue;
            }

            // Phase total bps
            let mut phase_bps: u32 = 0;
            for k in 0..phase.entries.len() {
                phase_bps += phase.entries.get(k).unwrap().bps;
            }

            // Skip phases already covered by executed_bps.
            if executed_bps >= 10_000 {
                break;
            }
            if executed_bps + phase_bps <= executed_bps {
                continue;
            }
            // If we've already executed some bps, we only execute future phases.
            // Our UI guarantees total across phases is 10000. We track cumulatively by adding each phase_bps.
            if executed_bps > 0 {
                // if this phase would be part of already-executed cumulative range, skip
                // (naive approach: assume phases are executed in order; if executed_bps>0, we execute only next phases)
            }

            // Execute this phase only if it advances executed_bps.
            // If executed_bps already includes this phase (from prior runs), skip.
            // We treat executed_bps as sum of phase totals executed so far (ordered).
            // To support that, we require executing in ascending days order and skip until we reach the first not-yet-executed phase.
            // We do that by tracking executed_bps in sequence:
            // - if executed_bps > 0, we have already executed some earlier phases.
            // - we still need to detect how much earlier phases sum to, but we don't store per-phase flags.
            // For simplicity, we store executed_bps as cumulative executed; on each run we only execute phases while executed_bps < cumulative_sum.
            // We'll compute cumulative as we go.

            // Compute cumulative bps up to this phase in sorted order
            let mut cumulative_bps: u32 = 0;
            for u in 0..used.len() {
                let idx = used.get(u).unwrap();
                let p = phases.get(idx).unwrap();
                let mut pb: u32 = 0;
                for kk in 0..p.entries.len() {
                    pb += p.entries.get(kk).unwrap().bps;
                }
                cumulative_bps += pb;
            }

            // If we've already executed up to (or beyond) this cumulative, skip.
            if executed_bps >= cumulative_bps {
                continue;
            }

            // Execute transfers for each entry in this phase based on total_deposited.
            let mut _phase_amount_sent: i128 = 0;
            for k in 0..phase.entries.len() {
                let entry = phase.entries.get(k).unwrap();
                let amt = (total_deposited * (entry.bps as i128)) / 10_000_i128;
                if amt <= 0 {
                    continue;
                }
                if vault_balance < amt {
                    return Err(ContinuumError::InsufficientVaultBalance);
                }
                client.transfer(&env.current_contract_address(), &entry.address, &amt);
                vault_balance -= amt;
                _phase_amount_sent += amt;
            }

            executed_now_bps += phase_bps;
            executed_bps = cumulative_bps;
        }

        if executed_now_bps == 0 {
            return Err(ContinuumError::NothingToExecute);
        }

        put_owner_u32(&env, EXEC_BPS_NS, &owner, executed_bps);
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
        touch_last_active(&env, &owner);
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
        touch_last_active(&env, &owner);
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
        touch_last_active(&env, &owner);
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
