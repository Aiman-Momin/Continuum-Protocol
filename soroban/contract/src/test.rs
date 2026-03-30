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
