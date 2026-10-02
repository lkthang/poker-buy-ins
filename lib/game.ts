export const STORAGE_KEY = "poker-buyins";

export const QUICK_BUY_INS = [20, 40, 50, 100] as const;

export type BuyIn = {
  id: string;
  amount: number;
};

export const LEDGER_KINDS = ["sat", "stood", "buy-in", "removed-buy-in"] as const;

export type LedgerKind = (typeof LEDGER_KINDS)[number];

export type LedgerEntry = {
  id: string;
  at: string;
  kind: LedgerKind;
  amount?: number;
};

export type Player = {
  id: string;
  name: string;
  buyIns: BuyIn[];
  cashOut: number | null;
  seated: boolean;
  ledger: LedgerEntry[];
};

export type Transfer = {
  from: string;
  to: string;
  amount: number;
};

export type Settlement = {
  transfers: Transfer[];
  gapCents: number;
};

export function createId(): string {
  return crypto.randomUUID();
}

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function parseBuyIn(value: string): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const cents = toCents(amount);
  if (cents <= 0) return null;
  return fromCents(cents);
}

export function parseCashOut(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === ".") return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return fromCents(toCents(amount));
}

export function formatCents(cents: number): string {
  return formatMoney(fromCents(cents));
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isBuyInAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isCashOut(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isBuyIn(value: unknown): value is BuyIn {
  if (!value || typeof value !== "object") return false;
  const buyIn = value as BuyIn;
  return isId(buyIn.id) && isBuyInAmount(buyIn.amount);
}

type SavedPlayer = Omit<Player, "seated" | "ledger"> & {
  seated?: boolean;
  ledger?: unknown;
};

function isLedgerEntry(value: unknown): value is LedgerEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as LedgerEntry;
  if (!isId(entry.id) || typeof entry.at !== "string") return false;
  if (!LEDGER_KINDS.includes(entry.kind)) return false;
  if (entry.kind === "sat") return entry.amount === undefined;
  if (entry.kind === "stood") return isCashOut(entry.amount);
  return isBuyInAmount(entry.amount);
}

function backfillLedger(player: SavedPlayer): LedgerEntry[] {
  const entries: LedgerEntry[] = [{ id: createId(), at: "", kind: "sat" }];
  for (const buyIn of player.buyIns) {
    entries.push({
      id: buyIn.id,
      at: "",
      kind: "buy-in",
      amount: buyIn.amount,
    });
  }
  if (player.seated === false && player.cashOut !== null) {
    entries.push({
      id: createId(),
      at: "",
      kind: "stood",
      amount: player.cashOut,
    });
  }
  return entries;
}

function readLedger(player: SavedPlayer): LedgerEntry[] | null {
  if (!Array.isArray(player.ledger)) return null;
  const entries = player.ledger.filter(isLedgerEntry);
  return entries.length > 0 ? entries : null;
}

function isSavedPlayer(value: unknown): value is SavedPlayer {
  if (!value || typeof value !== "object") return false;
  const player = value as SavedPlayer;
  return (
    isId(player.id) &&
    typeof player.name === "string" &&
    player.name.trim().length > 0 &&
    Array.isArray(player.buyIns) &&
    player.buyIns.every(isBuyIn) &&
    (player.cashOut === null || isCashOut(player.cashOut)) &&
    (player.seated === undefined || typeof player.seated === "boolean")
  );
}

export function normalizePlayer(player: SavedPlayer): Player {
  return {
    ...player,
    seated: player.seated !== false,
    ledger: readLedger(player) ?? backfillLedger(player),
  };
}

export function appendLedger(
  player: Player,
  kind: LedgerKind,
  amount?: number,
): LedgerEntry[] {
  const entry: LedgerEntry = {
    id: createId(),
    at: new Date().toISOString(),
    kind,
  };
  if (amount !== undefined) entry.amount = amount;
  return [...(player.ledger ?? []), entry];
}

export function ledgerLabel(entry: LedgerEntry, earlier: LedgerEntry[]): string {
  switch (entry.kind) {
    case "sat":
      return earlier.some((item) => item.kind === "sat")
        ? "Sat back down"
        : "Sat down";
    case "stood":
      return `Stood up with ${formatMoney(entry.amount ?? 0)}`;
    case "buy-in":
      return `Bought in ${formatMoney(entry.amount ?? 0)}`;
    case "removed-buy-in":
      return `Removed ${formatMoney(entry.amount ?? 0)} buy-in`;
  }
}

export function formatLedgerTime(at: string): string {
  if (!at) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function playerBuyInCents(player: Player): number {
  return player.buyIns.reduce((sum, buyIn) => sum + toCents(buyIn.amount), 0);
}

function ledgerCents(player: Player, kind: LedgerKind): number {
  return (player.ledger ?? [])
    .filter((entry) => entry.kind === kind)
    .reduce((sum, entry) => sum + toCents(entry.amount ?? 0), 0);
}

export function ledgerBuyInCents(player: Player): number {
  return ledgerCents(player, "buy-in") - ledgerCents(player, "removed-buy-in");
}

export function ledgerCashOutCents(player: Player): number {
  return ledgerCents(player, "stood");
}

export function ledgerNetCents(player: Player): number {
  return ledgerCashOutCents(player) - ledgerBuyInCents(player);
}

export function potCents(players: Player[]): number {
  return players.reduce((sum, player) => sum + ledgerBuyInCents(player), 0);
}

export function activeMoneyCents(players: Player[]): number {
  return (
    potCents(players) -
    players.reduce((sum, player) => sum + ledgerCashOutCents(player), 0)
  );
}

export function netCents(player: Player): number | null {
  if (player.cashOut === null) return null;
  return toCents(player.cashOut) - playerBuyInCents(player);
}

export function allCashedOut(players: Player[]): boolean {
  return (
    players.length > 0 &&
    players.every((player) => player.seated === false && player.cashOut !== null)
  );
}

export function settle(players: Player[]): Settlement | null {
  if (!allCashedOut(players)) return null;

  const creditors = players
    .map((player) => ({ name: player.name, cents: ledgerNetCents(player) }))
    .filter((party) => party.cents > 0)
    .sort((a, b) => b.cents - a.cents);

  const debtors = players
    .map((player) => ({ name: player.name, cents: -ledgerNetCents(player) }))
    .filter((party) => party.cents > 0)
    .sort((a, b) => b.cents - a.cents);

  const transfers: Transfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const amount = Math.min(
      debtors[debtorIndex].cents,
      creditors[creditorIndex].cents,
    );
    if (amount > 0) {
      transfers.push({
        from: debtors[debtorIndex].name,
        to: creditors[creditorIndex].name,
        amount: fromCents(amount),
      });
    }
    debtors[debtorIndex].cents -= amount;
    creditors[creditorIndex].cents -= amount;
    if (debtors[debtorIndex].cents === 0) debtorIndex += 1;
    if (creditors[creditorIndex].cents === 0) creditorIndex += 1;
  }

  return {
    transfers,
    gapCents: players.reduce((sum, player) => sum + ledgerNetCents(player), 0),
  };
}

const serverPlayers: Player[] = [];
let players = serverPlayers;
let loaded = false;
const listeners = new Set<() => void>();

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  players = loadPlayers();
  loaded = true;
}

export function subscribePlayers(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    players = loadPlayers();
    loaded = true;
    listener();
  };

  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getPlayers(): Player[] {
  ensureLoaded();
  return players;
}

export function getServerPlayers(): Player[] {
  return serverPlayers;
}

export function updatePlayers(recipe: (current: Player[]) => Player[]): void {
  ensureLoaded();
  players = recipe(players);
  savePlayers(players);
  for (const listener of listeners) listener();
}

export function loadPlayers(): Player[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedPlayer).map(normalizePlayer);
  } catch {
    return [];
  }
}

export function savePlayers(players: Player[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
}
