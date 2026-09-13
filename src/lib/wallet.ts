/**
 * Minimal wallet connection via the injected provider.
 *
 * We previously used @solana/wallet-adapter-react-ui and removed it: under Vite
 * with React 19 it produced duplicate React module instances ("invalid hook
 * call") and its qrcode dependency failed CJS interop. Phantom, Solflare and
 * Backpack all expose the same injected API, so this is both smaller and more
 * reliable, at the cost of not supporting mobile deep-linking -- which a desktop
 * demo does not need.
 */
import type { VersionedTransaction } from "@solana/web3.js";

interface InjectedProvider {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect(): Promise<void>;
  signAndSendTransaction(tx: VersionedTransaction): Promise<{ signature: string }>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
}

interface MaybeWindow {
  phantom?: { solana?: InjectedProvider };
  solana?: InjectedProvider;
  solflare?: InjectedProvider;
  backpack?: InjectedProvider;
}

/** The injected provider, if a wallet extension is present. */
export function getProvider(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as MaybeWindow;
  return w.phantom?.solana ?? w.solflare ?? w.backpack ?? w.solana ?? null;
}

export function walletName(): string {
  const w = typeof window === "undefined" ? null : (window as unknown as MaybeWindow);
  if (!w) return "wallet";
  if (w.phantom?.solana) return "Phantom";
  if (w.solflare) return "Solflare";
  if (w.backpack) return "Backpack";
  return "wallet";
}

export async function connect(): Promise<string> {
  const provider = getProvider();
  if (!provider) {
    throw new Error("No Solana wallet found. Install Phantom, Solflare or Backpack.");
  }
  const { publicKey } = await provider.connect();
  return publicKey.toBase58();
}

/** Reconnect silently if this site was already approved. */
export async function eagerConnect(): Promise<string | null> {
  const provider = getProvider();
  if (!provider) return null;
  try {
    const { publicKey } = await provider.connect({ onlyIfTrusted: true });
    return publicKey.toBase58();
  } catch {
    return null;
  }
}

export async function disconnect(): Promise<void> {
  await getProvider()?.disconnect();
}

/** Sign and broadcast. The wallet shows its own confirmation dialog. */
export async function signAndSend(tx: VersionedTransaction): Promise<string> {
  const provider = getProvider();
  if (!provider) throw new Error("wallet disconnected");
  const { signature } = await provider.signAndSendTransaction(tx);
  return signature;
}
