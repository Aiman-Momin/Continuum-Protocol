#![cfg(test)]
use super::*;
use soroban_sdk::Env;

#[test]
fn test_storage() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SimpleStorage);
    let client = SimpleStorageClient::new(&env, &contract_id);

    // Initial value should be 0
    assert_eq!(client.get_data(), 0);

    // Set value to 123456789
    client.set_data(&123456789);
    assert_eq!(client.get_data(), 123456789);

    // Update value to 987654321
    client.set_data(&987654321);
    assert_eq!(client.get_data(), 987654321);
}

#[test]
fn test_owner_scoped_nominees_and_activity() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SimpleStorage);
    let client = SimpleStorageClient::new(&env, &contract_id);

    let owner = soroban_sdk::Address::generate(&env);
    owner.require_auth(); // enables auth in testutils

    // Empty by default
    assert_eq!(client.get_nominees(&owner).len(), 0);
    assert_eq!(client.get_last_active(&owner), 0);

    let mut nominees = soroban_sdk::Vec::new(&env);
    nominees.push_back(Nominee {
        address: soroban_sdk::Address::generate(&env),
        role: symbol_short!("BENF"),
        bps: 10_000,
    });

    client.set_nominees(&owner, &nominees);
    assert_eq!(client.get_nominees(&owner).len(), 1);

    client.check_in(&owner);
    assert!(client.get_last_active(&owner) > 0);
}
