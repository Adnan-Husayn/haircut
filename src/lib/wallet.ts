/**
 * Wallet connection via injected providers.
 *
 * We previously used @solana/wallet-adapter-react-ui and removed it: under Vite
 * with React 19 it produced duplicate React module instances ("invalid hook
 * call") and its qrcode dependency failed CJS interop.
 *
 * Every wallet below exposes the same injected Solana interface, so detection
 * is just a matter of knowing where each one puts it. Note this is a Solana
 * interface: an EVM-only wallet will not appear here however it is listed,
 * because it has no Solana provider to find.
 */
import type { VersionedTransaction } from "@solana/web3.js";

interface InjectedProvider {
  publicKey?: { toBase58(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect(): Promise<void>;
  signAndSendTransaction(tx: VersionedTransaction): Promise<{ signature: string }>;
}

type Slot = { solana?: InjectedProvider } | InjectedProvider | undefined;

interface MaybeWindow {
  phantom?: { solana?: InjectedProvider };
  solflare?: InjectedProvider;
  backpack?: InjectedProvider;
  trustwallet?: { solana?: InjectedProvider };
  coinbaseSolana?: InjectedProvider;
  exodus?: { solana?: InjectedProvider };
  okxwallet?: { solana?: InjectedProvider };
  braveSolana?: InjectedProvider;
  magicEden?: { solana?: InjectedProvider };
  glowSolana?: InjectedProvider;
  metamask?: { solana?: InjectedProvider };
  solana?: InjectedProvider;
}

/** Where each wallet publishes its Solana provider. */
const CANDIDATES: Array<{ name: string; slot: (w: MaybeWindow) => Slot }> = [
  { name: "Phantom", slot: (w) => w.phantom?.solana },
  { name: "Solflare", slot: (w) => w.solflare },
  { name: "Backpack", slot: (w) => w.backpack },
  { name: "Trust", slot: (w) => w.trustwallet?.solana },
  { name: "Coinbase", slot: (w) => w.coinbaseSolana },
  { name: "Exodus", slot: (w) => w.exodus?.solana },
  { name: "OKX", slot: (w) => w.okxwallet?.solana },
  { name: "Brave", slot: (w) => w.braveSolana },
  { name: "Magic Eden", slot: (w) => w.magicEden?.solana },
  { name: "Glow", slot: (w) => w.glowSolana },
  { name: "MetaMask", slot: (w) => w.metamask?.solana },
];

export interface DetectedWallet {
  name: string;
  provider: InjectedProvider;
}

function usable(slot: Slot): InjectedProvider | undefined {
  if (!slot) return undefined;
  const p = "solana" in slot ? slot.solana : (slot as InjectedProvider);
  return p && typeof p.connect === "function" && typeof p.signAndSendTransaction === "function"
    ? p
    : undefined;
}

/** Every Solana wallet currently injected into this page, de-duplicated. */
export function detectWallets(): DetectedWallet[] {
  if (typeof window === "undefined") return [];
  const w = window as unknown as MaybeWindow;

  const found: DetectedWallet[] = [];
  const seen = new Set<InjectedProvider>();

  for (const { name, slot } of CANDIDATES) {
    const provider = usable(slot(w));
    if (provider && !seen.has(provider)) {
      seen.add(provider);
      found.push({ name, provider });
    }
  }

  // A wallet we do not know by name, publishing at the generic path.
  const generic = usable(w.solana);
  if (generic && !seen.has(generic)) found.push({ name: "Injected wallet", provider: generic });

  return found;
}

/** The provider in use, once one has been chosen or defaulted to. */
let active: DetectedWallet | null = null;

export function activeWallet(): DetectedWallet | null {
  return active ?? detectWallets()[0] ?? null;
}

export function getProvider(): InjectedProvider | null {
  return activeWallet()?.provider ?? null;
}

export function walletName(): string {
  return activeWallet()?.name ?? "wallet";
}

export async function connect(name?: string): Promise<string> {
  const wallets = detectWallets();
  if (wallets.length === 0) {
    throw new Error("No Solana wallet found. Install Phantom, Solflare, Backpack or Trust.");
  }
  const chosen = name ? wallets.find((wallet) => wallet.name === name) : wallets[0];
  if (!chosen) throw new Error(`${name} is not available in this browser.`);

  const { publicKey } = await chosen.provider.connect();
  active = chosen;
  return publicKey.toBase58();
}

/** Reconnect silently if this site was already approved. */
export async function eagerConnect(): Promise<string | null> {
  for (const wallet of detectWallets()) {
    try {
      const { publicKey } = await wallet.provider.connect({ onlyIfTrusted: true });
      active = wallet;
      return publicKey.toBase58();
    } catch {
      // Not previously approved for this one; try the next.
    }
  }
  return null;
}

export async function disconnect(): Promise<void> {
  await active?.provider.disconnect().catch(() => {/* already gone */});
  active = null;
}

/** Sign and broadcast. The wallet shows its own confirmation dialog. */
export async function signAndSend(tx: VersionedTransaction): Promise<string> {
  const provider = getProvider();
  if (!provider) throw new Error("wallet disconnected");
  const { signature } = await provider.signAndSendTransaction(tx);
  return signature;
}
