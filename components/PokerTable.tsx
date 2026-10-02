"use client";

import { FormEvent, useState, useSyncExternalStore } from "react";
import {
  QUICK_BUY_INS,
  LedgerEntry,
  activeMoneyCents,
  allCashedOut,
  appendLedger,
  createId,
  formatCents,
  formatLedgerTime,
  formatMoney,
  getPlayers,
  getServerPlayers,
  ledgerLabel,
  ledgerNetCents,
  netCents,
  parseBuyIn,
  parseCashOut,
  playerBuyInCents,
  potCents,
  settle,
  subscribePlayers,
  updatePlayers,
} from "@/lib/game";

function PlayerLedger({ entries }: { entries: LedgerEntry[] }) {
  return (
    <div className="mt-4 border-t border-ink/10 pt-3">
      <h3 className="text-xs font-medium tracking-[0.16em] text-ink/45 uppercase">
        Ledger
      </h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-ink/45">No activity yet.</p>
      ) : (
        <ol className="mt-2 flex max-h-48 flex-col gap-1.5 overflow-y-auto">
          {entries.map((entry, index) => {
            const time = formatLedgerTime(entry.at);
            return (
              <li
                key={entry.id}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span>{ledgerLabel(entry, entries.slice(0, index))}</span>
                {time ? (
                  <time
                    dateTime={entry.at}
                    className="shrink-0 text-xs text-ink/40"
                  >
                    {time}
                  </time>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default function PokerTable() {
  const players = useSyncExternalStore(
    subscribePlayers,
    getPlayers,
    getServerPlayers,
  );
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [cashOutDrafts, setCashOutDrafts] = useState<Record<string, string>>({});
  const [leaveErrors, setLeaveErrors] = useState<Record<string, string>>({});

  function addPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Enter a name.");
      return;
    }
    const taken = players.some(
      (player) => player.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (taken) {
      setNameError("That name is already at the table.");
      return;
    }

    const player = {
      id: createId(),
      name: trimmed,
      buyIns: [],
      cashOut: null,
      seated: true,
      ledger: [] as LedgerEntry[],
    };
    updatePlayers((current) => [
      ...current,
      { ...player, ledger: appendLedger(player, "sat") },
    ]);
    setName("");
    setNameError("");
  }

  function removePlayer(playerId: string) {
    const player = players.find((item) => item.id === playerId);
    if (!player || player.buyIns.length > 0) return;
    updatePlayers((current) => current.filter((item) => item.id !== playerId));
  }

  function leaveTable(playerId: string) {
    const player = players.find((item) => item.id === playerId);
    if (!player || player.seated === false) return;
    const draft = cashOutDrafts[playerId];
    const cashOut = draft !== undefined ? parseCashOut(draft) : player.cashOut;
    if (cashOut === null) {
      setLeaveErrors((current) => ({
        ...current,
        [playerId]: "Enter what they leave with. Use 0 if they bust.",
      }));
      return;
    }
    updatePlayers((current) =>
      current.map((item) =>
        item.id === playerId
          ? {
              ...item,
              cashOut,
              seated: false,
              ledger: appendLedger(item, "stood", cashOut),
            }
          : item,
      ),
    );
    setLeaveErrors((current) => {
      const next = { ...current };
      delete next[playerId];
      return next;
    });
  }

  function sitBackDown(playerId: string) {
    updatePlayers((current) =>
      current.map((item) =>
        item.id === playerId
          ? {
              ...item,
              buyIns: [],
              cashOut: null,
              seated: true,
              ledger: appendLedger(item, "sat"),
            }
          : item,
      ),
    );
    setCashOutDrafts((current) => {
      const next = { ...current };
      delete next[playerId];
      return next;
    });
  }

  function addBuyIn(playerId: string, amount: number) {
    updatePlayers((current) =>
      current.map((player) =>
        player.id === playerId
          ? {
              ...player,
              buyIns: [...player.buyIns, { id: createId(), amount }],
              ledger: appendLedger(player, "buy-in", amount),
            }
          : player,
      ),
    );
  }

  function addCustomBuyIn(playerId: string) {
    const amount = parseBuyIn(customAmounts[playerId] ?? "");
    if (amount === null) return;
    addBuyIn(playerId, amount);
    setCustomAmounts((current) => ({ ...current, [playerId]: "" }));
  }

  function removeBuyIn(playerId: string, buyInId: string) {
    updatePlayers((current) =>
      current.map((player) => {
        if (player.id !== playerId) return player;
        const buyIn = player.buyIns.find((item) => item.id === buyInId);
        if (!buyIn) return player;
        return {
          ...player,
          buyIns: player.buyIns.filter((item) => item.id !== buyInId),
          ledger: appendLedger(player, "removed-buy-in", buyIn.amount),
        };
      }),
    );
  }

  function updateCashOut(playerId: string, value: string) {
    if (!/^\d*\.?\d{0,2}$/.test(value)) return;
    setCashOutDrafts((current) => ({ ...current, [playerId]: value }));
    setLeaveErrors((current) => {
      if (!current[playerId]) return current;
      const next = { ...current };
      delete next[playerId];
      return next;
    });
    const cashOut = parseCashOut(value);
    updatePlayers((current) =>
      current.map((player) =>
        player.id === playerId ? { ...player, cashOut } : player,
      ),
    );
  }

  function startNewGame() {
    if (players.length === 0) return;
    const confirmed = window.confirm(
      "Clear this game? Buy-ins saved on this browser will be erased.",
    );
    if (!confirmed) return;
    updatePlayers(() => []);
    setCustomAmounts({});
    setCashOutDrafts({});
    setLeaveErrors({});
    setName("");
    setNameError("");
  }

  const pot = potCents(players);
  const active = activeMoneyCents(players);
  const settlement = settle(players);
  const seated = players.filter((player) => player.seated !== false);
  const departed = players.filter((player) => player.seated === false);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 py-6 sm:py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.22em] text-gold uppercase">
            Home game
          </p>
          <h1 className="font-serif text-4xl leading-none text-paper">
            The table
          </h1>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <p>
              <span className="block font-serif text-3xl text-paper">
                {formatCents(pot)}
              </span>
              <span className="text-sm text-paper/70">Total money</span>
            </p>
            <p>
              <span className="block font-serif text-3xl text-paper">
                {formatCents(active)}
              </span>
              <span className="text-sm text-paper/70">Active money</span>
            </p>
          </div>
          <p className="mt-1 text-sm text-paper/70">
            {players.length === 0
              ? "No players yet"
              : `${seated.length} sitting${
                  departed.length === 0
                    ? ""
                    : ` · ${departed.length} cashed out`
                }`}
            <span className="mx-2 text-paper/35">·</span>
            Saved on this browser
          </p>
        </div>
        <button
          type="button"
          onClick={startNewGame}
          disabled={players.length === 0}
          className="shrink-0 rounded-full border border-paper/25 px-3 py-2 text-sm text-paper transition hover:border-paper/60 disabled:cursor-not-allowed disabled:opacity-40"
        >
          New game
        </button>
      </header>

      <form onSubmit={addPlayer} className="mt-8">
        <label htmlFor="player-name" className="text-sm text-paper/80">
          Add a player
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="player-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (nameError) setNameError("");
            }}
            placeholder="Name"
            autoComplete="off"
            className="min-h-12 min-w-0 flex-1 rounded-2xl border border-transparent bg-paper px-4 text-base text-ink outline-none ring-gold placeholder:text-ink/40 focus:ring-2"
          />
          <button
            type="submit"
            className="min-h-12 rounded-2xl bg-gold px-5 text-base font-medium text-felt-deep transition hover:brightness-105"
          >
            Add
          </button>
        </div>
        {nameError ? (
          <p className="mt-2 text-sm text-down-soft" role="alert">
            {nameError}
          </p>
        ) : null}
      </form>

      {players.length === 0 ? (
        <section className="mt-8 rounded-3xl border border-dashed border-paper/25 px-5 py-8 text-center">
          <p className="font-serif text-2xl text-paper">The seats are empty.</p>
          <p className="mt-2 text-sm text-paper/70">
            Add a name, then tap a buy-in amount.
          </p>
        </section>
      ) : null}

      {seated.length === 0 && departed.length > 0 ? (
        <p className="mt-8 text-sm text-paper/75">No one is sitting.</p>
      ) : null}

      {seated.length > 0 ? (
      <div className="mt-6 flex flex-col gap-4">
        {seated.map((player) => {
          const boughtIn = playerBuyInCents(player);
          const net = netCents(player);
          const draft = cashOutDrafts[player.id];
          const cashOutValue =
            draft !== undefined
              ? draft
              : player.cashOut === null
                ? ""
                : String(player.cashOut);

          return (
            <section
              key={player.id}
              className="rounded-3xl bg-paper px-4 py-4 text-ink shadow-[0_16px_40px_rgb(0_0_0/0.18)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-serif text-2xl leading-tight">
                    {player.name}
                  </h2>
                  <p className="mt-1 text-sm text-ink/65">
                    {formatCents(boughtIn)} this sitting
                    {player.buyIns.length > 0
                      ? ` · ${player.buyIns.length} ${player.buyIns.length === 1 ? "buy-in" : "buy-ins"}`
                      : ""}
                  </p>
                </div>
                {player.buyIns.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => removePlayer(player.id)}
                    className="rounded-full px-3 py-2 text-sm text-ink/55 transition hover:bg-ink/5 hover:text-down"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => leaveTable(player.id)}
                    className="rounded-full bg-ink px-3 py-2 text-sm font-medium text-paper transition hover:bg-ink/85"
                  >
                    Leave
                  </button>
                )}
              </div>

              {player.buyIns.length > 0 ? (
                <ul className="mt-4 flex flex-wrap gap-2">
                  {player.buyIns.map((buyIn) => (
                    <li key={buyIn.id}>
                      <button
                        type="button"
                        onClick={() => removeBuyIn(player.id, buyIn.id)}
                        aria-label={`Remove ${formatMoney(buyIn.amount)} buy-in for ${player.name}`}
                        className="inline-flex min-h-10 items-center gap-2 rounded-full bg-felt px-3 text-sm text-paper transition hover:bg-felt-deep"
                      >
                        {formatMoney(buyIn.amount)}
                        <span aria-hidden="true" className="text-paper/70">
                          ×
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-ink/50">No buy-ins yet.</p>
              )}

              <div className="mt-4 grid grid-cols-4 gap-2">
                {QUICK_BUY_INS.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => addBuyIn(player.id, amount)}
                    className="min-h-11 rounded-xl bg-ink text-sm font-medium text-paper transition hover:bg-ink/85"
                  >
                    +{formatMoney(amount)}
                  </button>
                ))}
              </div>

              <form
                className="mt-2 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  addCustomBuyIn(player.id);
                }}
              >
                <label className="sr-only" htmlFor={`custom-${player.id}`}>
                  Custom buy-in for {player.name}
                </label>
                <input
                  id={`custom-${player.id}`}
                  inputMode="decimal"
                  value={customAmounts[player.id] ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!/^\d*\.?\d{0,2}$/.test(value)) return;
                    setCustomAmounts((current) => ({
                      ...current,
                      [player.id]: value,
                    }));
                  }}
                  placeholder="Other amount"
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-ink/15 px-3 text-base outline-none ring-gold placeholder:text-ink/35 focus:ring-2"
                />
                <button
                  type="submit"
                  className="min-h-11 rounded-xl border border-ink/15 px-4 text-sm font-medium transition hover:bg-ink/5"
                >
                  Add
                </button>
              </form>

              <div className="mt-4 flex items-end justify-between gap-3 border-t border-ink/10 pt-4">
                <label className="block flex-1" htmlFor={`cash-out-${player.id}`}>
                  <span className="text-sm text-ink/65">Cash out</span>
                  <input
                    id={`cash-out-${player.id}`}
                    inputMode="decimal"
                    value={cashOutValue}
                    onChange={(event) =>
                      updateCashOut(player.id, event.target.value)
                    }
                    placeholder="0"
                    className="mt-1 min-h-11 w-full rounded-xl border border-ink/15 px-3 text-base outline-none ring-gold placeholder:text-ink/35 focus:ring-2"
                  />
                  {leaveErrors[player.id] ? (
                    <span className="mt-1 block text-sm text-down" role="alert">
                      {leaveErrors[player.id]}
                    </span>
                  ) : null}
                </label>
                <p className="pb-2 text-right text-sm font-medium">
                  {net === null ? (
                    <span className="text-ink/45">Net pending</span>
                  ) : net === 0 ? (
                    <span>Even</span>
                  ) : net > 0 ? (
                    <span className="text-up">Up {formatCents(net)}</span>
                  ) : (
                    <span className="text-down">
                      Owes {formatCents(Math.abs(net))}
                    </span>
                  )}
                </p>
              </div>
              <PlayerLedger entries={player.ledger ?? []} />
            </section>
          );
        })}
      </div>
      ) : null}

      {departed.length > 0 ? (
        <section className="mt-6">
          <h2 className="font-serif text-2xl text-paper">Cashed out</h2>
          <div className="mt-3 flex flex-col gap-3">
            {departed.map((player) => {
              const boughtIn = playerBuyInCents(player);
              const net = ledgerNetCents(player);
              return (
                <section
                  key={player.id}
                  className="rounded-3xl bg-paper/90 px-4 py-4 text-ink"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium tracking-[0.16em] text-ink/45 uppercase">
                        Left the table
                      </p>
                      <h3 className="mt-1 font-serif text-2xl leading-tight">
                        {player.name}
                      </h3>
                      <p className="mt-1 text-sm text-ink/65">
                        {formatCents(boughtIn)} this sitting
                        {player.cashOut === null
                          ? ""
                          : ` · left with ${formatMoney(player.cashOut)}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => sitBackDown(player.id)}
                      className="shrink-0 rounded-full border border-ink/15 px-3 py-2 text-sm transition hover:bg-ink/5"
                    >
                      Sit back down
                    </button>
                  </div>
                  <p className="mt-3 text-sm font-medium">
                    <span className="text-ink/45">Night · </span>
                    {net === 0 ? (
                      <span>Even</span>
                    ) : net > 0 ? (
                      <span className="text-up">Up {formatCents(net)}</span>
                    ) : (
                      <span className="text-down">
                        Owes {formatCents(Math.abs(net))}
                      </span>
                    )}
                  </p>
                  <PlayerLedger entries={player.ledger ?? []} />
                </section>
              );
            })}
          </div>
        </section>
      ) : null}

      {players.length > 0 ? (
        <section className="mt-4 rounded-3xl border border-paper/20 bg-felt-deep/55 px-4 py-5 text-paper">
          <h2 className="font-serif text-2xl">Who pays whom</h2>
          {!allCashedOut(players) ? (
            <p className="mt-2 text-sm leading-6 text-paper/75">
              Enter what each person still sitting leaves with, then tap Leave.
              Their buy-ins stay in the pot.
            </p>
          ) : null}
          {settlement && settlement.transfers.length === 0 ? (
            <p className="mt-3 text-sm leading-6">Nobody owes a payout.</p>
          ) : null}
          {settlement && settlement.transfers.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-2">
              {settlement.transfers.map((transfer) => (
                <li
                  key={`${transfer.from}-${transfer.to}-${transfer.amount}`}
                  className="rounded-2xl bg-paper/10 px-3 py-3 text-sm leading-6"
                >
                  <span className="font-medium">{transfer.from}</span> pays{" "}
                  <span className="font-medium">{transfer.to}</span>{" "}
                  <span className="font-serif text-lg text-gold">
                    {formatMoney(transfer.amount)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {settlement && settlement.gapCents !== 0 ? (
            <p className="mt-3 text-sm leading-6 text-down-soft" role="status">
              Cash-outs are {formatCents(Math.abs(settlement.gapCents))}{" "}
              {settlement.gapCents > 0 ? "over" : "short of"} the pot, so the
              books are off.
            </p>
          ) : null}
          {settlement && settlement.gapCents === 0 ? (
            <p className="mt-3 text-sm text-paper/75">The books balance.</p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
