## Deploy Continuum Soroban contract (testnet)

This repo includes a Soroban contract at `soroban/contract/` that supports:
- `set_nominees/get_nominees`
- `set_timeline/get_timeline`
- `set_distributions/get_distributions`
- `check_in(owner)` and `get_last_active(owner)` (owner-scoped + auth)
- **Escrow + auto-distribution**
  - `init(token_contract)`
  - `deposit(owner, amount)`
  - `get_vault_balance(owner)`
  - `execute_distribution(owner)` (anyone/bot can trigger once expired)

### 1) Build

```bash
cd soroban/contract
cargo build --target wasm32v1-none --release
```

### 2) Deploy

```bash
soroban contract deploy \
  --wasm target/wasm32v1-none/release/*.wasm \
  --source <YOUR_IDENTITY_OR_SECRET> \
  --network testnet
```

Copy the returned **contract ID**.

### 3) Initialize native XLM token contract

Soroban uses a token contract for assets (including native XLM).

Get the native token contract id:

```bash
soroban lab token id --asset native --network testnet
```

Initialize:

```bash
soroban contract invoke \
  --id <NEW_CONTRACT_ID> \
  --source <YOUR_IDENTITY_OR_SECRET> \
  --network testnet \
  -- init \
  --token_contract <NATIVE_TOKEN_CONTRACT_ID>
```

### 4) Update app + backend with new contract ID

- Frontend: `src/services/contractService.ts` → `CONTRACT_ID`
- Backend: set env `CONTRACT_ID` (or update the default in `server.ts`)

### 5) Run backend bot (optional, for automatic execution)

Set env:
- `BOT_SECRET`: secret key of a funded testnet account (pays fees and submits `execute_distribution`)

Then run:

```bash
npm run dev:server
```

### Notes
- **Automatic transfers only work for funds deposited into the contract vault** via `deposit()`.
- If you keep funds in a normal wallet, no backend can force-transfer without custody/signature.

