import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import cron from "node-cron";
import { promises as fs } from "fs";
import { Resend } from "resend";
import * as StellarSdk from "stellar-sdk";

const {
  Horizon,
  rpc: SorobanRpc,
  TransactionBuilder,
  Networks,
  Contract,
  Address,
  scValToNative,
  Keypair,
} = StellarSdk;

type NotificationSubscription = {
  publicKey: string;
  email: string;
  inactivityDays?: number;
  lastNotifiedDate?: string;
  lastSeenLastActiveMs?: number;
};

type NotificationStore = {
  subscriptions: Record<string, NotificationSubscription>;
};

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "notifications.json");

const CONTRACT_ID =
  process.env.CONTRACT_ID || "CDJKN3CFTOT2QTPGVDOPYKKNKYAIOZUIYCW6JAENAYX2XYZYID3DGE47";
const DEFAULT_INACTIVITY_DAYS = 90;

const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
const sorobanServer = new SorobanRpc.Server("https://soroban-testnet.stellar.org");
const contract = new Contract(CONTRACT_ID);

const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM || "Continuum <onboarding@resend.dev>";
const resend = resendApiKey ? new Resend(resendApiKey) : null;

const botSecret = process.env.BOT_SECRET;
const botKeypair = botSecret ? Keypair.fromSecret(botSecret) : null;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getTodayKey(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function ensureStoreFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    const initial: NotificationStore = { subscriptions: {} };
    await fs.writeFile(STORE_PATH, JSON.stringify(initial, null, 2), "utf8");
  }
}

async function readStore(): Promise<NotificationStore> {
  await ensureStoreFile();
  const raw = await fs.readFile(STORE_PATH, "utf8");
  try {
    const parsed = JSON.parse(raw) as NotificationStore;
    return parsed?.subscriptions ? parsed : { subscriptions: {} };
  } catch {
    return { subscriptions: {} };
  }
}

async function writeStore(store: NotificationStore) {
  await ensureStoreFile();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

async function simulateGetLastActive(publicKey: string): Promise<number> {
  const account = await horizon.loadAccount(publicKey);
  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call("get_last_active", new Address(publicKey).toScVal()))
    .setTimeout(30)
    .build();

  const simulation = await sorobanServer.simulateTransaction(tx);
  if (!SorobanRpc.Api.isSimulationSuccess(simulation)) return 0;
  const result = scValToNative(simulation.result!.retval);
  return Number(result || 0);
}

async function simulateGetInactivityDays(publicKey: string): Promise<number | null> {
  try {
    const account = await horizon.loadAccount(publicKey);
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call("get_distributions", new Address(publicKey).toScVal()))
      .setTimeout(30)
      .build();

    const simulation = await sorobanServer.simulateTransaction(tx);
    if (!SorobanRpc.Api.isSimulationSuccess(simulation)) return null;
    const native = scValToNative(simulation.result!.retval) as any[];
    if (!Array.isArray(native) || native.length === 0) return null;
    const values = native
      .map((p) => Number(p?.inactivity_days))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (!values.length) return null;
    return Math.min(...values);
  } catch {
    return null;
  }
}

async function sendReminderEmail(email: string, publicKey: string, daysRemaining: number) {
  if (!resend) {
    console.warn("[Scheduler] RESEND_API_KEY missing; email skipped.");
    return false;
  }

  const subject =
    daysRemaining <= 0
      ? "Continuum Alert: Inactivity timer reached 0 days"
      : `Continuum Reminder: ${daysRemaining} day(s) remaining`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6">
      <h2>Continuum Inactivity Reminder</h2>
      <p>Wallet: <code>${publicKey}</code></p>
      <p>
        ${
          daysRemaining <= 0
            ? "Your inactivity timer has reached 0 days. Please check in immediately."
            : `You have <strong>${daysRemaining}</strong> day(s) remaining before your inactivity trigger window.`
        }
      </p>
      <p>Please open Continuum and perform a check-in to reset your timer.</p>
    </div>
  `;

  await resend.emails.send({
    from: emailFrom,
    to: email,
    subject,
    html,
  });
  return true;
}

async function tryExecuteDistribution(ownerPublicKey: string) {
  if (!botKeypair) {
    console.warn("[Scheduler] BOT_SECRET missing; execute_distribution skipped.");
    return { success: false, error: "BOT_SECRET missing" };
  }

  const botAccount = await horizon.loadAccount(botKeypair.publicKey());
  const tx = new TransactionBuilder(botAccount, {
    fee: "1000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call("execute_distribution", new Address(ownerPublicKey).toScVal()))
    .setTimeout(60)
    .build();

  const preparedTx = await sorobanServer.prepareTransaction(tx);
  preparedTx.sign(botKeypair);
  const result = await horizon.submitTransaction(preparedTx as any);
  return { success: true, hash: (result as any).hash };
}

async function runSweep() {
  const store = await readStore();
  const today = getTodayKey();
  let changed = false;

  for (const [publicKey, sub] of Object.entries(store.subscriptions)) {
    if (!sub?.email) continue;
    try {
      const lastActiveSec = await simulateGetLastActive(publicKey);
      const lastActiveMs = lastActiveSec > 0 ? lastActiveSec * 1000 : 0;
      const configuredDays =
        (await simulateGetInactivityDays(publicKey)) ?? sub.inactivityDays ?? DEFAULT_INACTIVITY_DAYS;

      // New check-in/activity resets the notification cadence.
      if (lastActiveMs > (sub.lastSeenLastActiveMs || 0)) {
        sub.lastSeenLastActiveMs = lastActiveMs;
        sub.lastNotifiedDate = undefined;
        changed = true;
      }

      if (!lastActiveMs) continue;

      const remainingMs = configuredDays * 24 * 60 * 60 * 1000 - (Date.now() - lastActiveMs);
      const daysRemaining = Math.max(0, Math.floor(remainingMs / (24 * 60 * 60 * 1000)));

      // Trigger on-chain transfer execution at expiry.
      if (daysRemaining === 0) {
        try {
          const execRes = await tryExecuteDistribution(publicKey);
          if (execRes.success) {
            console.log(`[Scheduler] execute_distribution sent for ${publicKey}: ${execRes.hash}`);
          }
        } catch (err) {
          console.error(`[Scheduler] execute_distribution failed for ${publicKey}:`, err);
        }
      }

      // Notify when within 5 days, once/day.
      if (daysRemaining > 5) continue;
      if (sub.lastNotifiedDate === today) continue;

      const sent = await sendReminderEmail(sub.email, publicKey, daysRemaining);
      if (sent) {
        sub.lastNotifiedDate = today;
        sub.lastSeenLastActiveMs = lastActiveMs;
        changed = true;
      }
    } catch (err) {
      console.error(`[Scheduler] Sweep failed for ${publicKey}:`, err);
    }
  }

  if (changed) await writeStore(store);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", service: "Continuum Protocol Backend" });
  });

  app.get("/api/notifications/subscription/:publicKey", async (req, res) => {
    const { publicKey } = req.params;
    const store = await readStore();
    const sub = store.subscriptions[publicKey];
    if (!sub) {
      res.status(404).json({ success: false, error: "No subscription found" });
      return;
    }
    res.json({ success: true, subscription: sub });
  });

  app.post("/api/notifications/subscribe", async (req, res) => {
    const { publicKey, email, inactivityDays } = req.body || {};
    if (!publicKey || typeof publicKey !== "string") {
      res.status(400).json({ success: false, error: "publicKey is required" });
      return;
    }
    if (!email || typeof email !== "string" || !isValidEmail(email)) {
      res.status(400).json({ success: false, error: "Valid email is required" });
      return;
    }

    const store = await readStore();
    const existing = store.subscriptions[publicKey];
    store.subscriptions[publicKey] = {
      publicKey,
      email,
      inactivityDays:
        typeof inactivityDays === "number" && inactivityDays > 0
          ? Math.floor(inactivityDays)
          : existing?.inactivityDays,
      lastNotifiedDate: existing?.lastNotifiedDate,
      lastSeenLastActiveMs: existing?.lastSeenLastActiveMs,
    };
    await writeStore(store);
    res.json({ success: true, subscription: store.subscriptions[publicKey] });
  });

  app.delete("/api/notifications/subscription/:publicKey", async (req, res) => {
    const { publicKey } = req.params;
    const store = await readStore();
    delete store.subscriptions[publicKey];
    await writeStore(store);
    res.json({ success: true });
  });

  // Mock Notification Endpoint
  app.post("/api/notify", (req, res) => {
    const { email, type, message } = req.body;
    console.log(`[Notification] Sending ${type} to ${email}: ${message}`);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Continuum Protocol running on http://localhost:${PORT}`);
    console.log(`[Scheduler] contract: ${CONTRACT_ID}`);
    console.log(
      `[Scheduler] resend: ${resend ? "configured" : "missing RESEND_API_KEY (emails disabled)"}`,
    );
    console.log(`[Scheduler] bot: ${botKeypair ? botKeypair.publicKey() : "missing BOT_SECRET"}`);
  });

  // Run once at startup + every hour
  runSweep().catch((e) => console.error("[Scheduler] startup sweep failed:", e));
  cron.schedule("0 * * * *", () => {
    runSweep().catch((e) => console.error("[Scheduler] hourly sweep failed:", e));
  });
}

startServer();
