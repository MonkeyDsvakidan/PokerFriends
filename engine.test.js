// Tests der Spiellogik: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from './engine.js';

const T = (names, o = {}) => E.newGame({
  mode: 'tournament', names, chips: E.DEFAULT_CHIPS,
  tournament: { buyIn: 2000, startStack: 2000, levels: E.DEFAULT_LEVELS, levelMin: 20, rebuy: { on: false, untilLevel: 0, max: 0 }, payout: E.suggestPayout(names.length), ...o },
}, () => 0); // Dealer = erste Person
const C = (names, o = {}) => E.newGame({
  mode: 'cash', names, chips: E.DEFAULT_CHIPS,
  cash: { points: 100, rappen: 100, sb: 10, bb: 20, minBuy: 1000, maxBuy: 5000, firstBuy: 2000, ...o },
}, () => 0);
const id = (g, n) => g.players.find((p) => p.name === n).id;
const toAct = (g) => g.players.find((p) => p.id === g.hand.toAct).name;
const stack = (g, n) => g.players.find((p) => p.name === n).stack;

test('Preflop beginnt links vom Big Blind, Postflop links vom Dealer', () => {
  const g = T(['A', 'B', 'C', 'D']); E.startHand(g);
  assert.equal(g.hand.dealer, id(g, 'A'));
  assert.equal(g.hand.sb, id(g, 'B')); assert.equal(g.hand.bb, id(g, 'C'));
  assert.equal(toAct(g), 'D');
  E.act(g, { type: 'call' }); E.act(g, { type: 'call' }); E.act(g, { type: 'call' });
  assert.equal(toAct(g), 'C', 'BB hat die Option');
  E.act(g, { type: 'check' });
  assert.equal(g.hand.street, 'flop');
  assert.equal(toAct(g), 'B', 'erste aktive Person links vom Dealer');
});

test('Postflop überspringt Gepasste links vom Dealer', () => {
  const g = T(['A', 'B', 'C', 'D']); E.startHand(g);
  E.act(g, { type: 'call' }); E.act(g, { type: 'call' }); E.act(g, { type: 'fold' }); E.act(g, { type: 'check' });
  assert.equal(toAct(g), 'C');
});

test('Heads-up: Dealer ist Small Blind, handelt preflop zuerst, postflop zuletzt', () => {
  const g = T(['A', 'B']); E.startHand(g);
  assert.equal(g.hand.sb, id(g, 'A')); assert.equal(g.hand.bb, id(g, 'B'));
  assert.equal(toAct(g), 'A');
  E.act(g, { type: 'call' }); E.act(g, { type: 'check' });
  assert.equal(g.hand.street, 'flop');
  assert.equal(toAct(g), 'B');
});

test('Button wandert weiter', () => {
  const g = T(['A', 'B', 'C']); E.startHand(g);
  E.act(g, { type: 'fold' }); E.act(g, { type: 'fold' });
  assert.ok(g.hand.done);
  E.startHand(g);
  assert.equal(g.hand.dealer, id(g, 'B'));
});

test('Erlaubte Aktionen, Min-Raise und Prüfungen', () => {
  const g = T(['A', 'B', 'C']); E.startHand(g); // A Dealer, B 10, C 20, A dran
  let L = E.legal(g);
  assert.equal(L.check, false); assert.equal(L.call, 20); assert.equal(L.raise.min, 40); assert.equal(L.bet, null);
  assert.throws(() => E.act(g, { type: 'check' }), /Check geht nicht/);
  assert.throws(() => E.act(g, { type: 'raise', to: 30 }), /Mindest-Raise/);
  assert.throws(() => E.act(g, { type: 'raise', to: 5000 }), /nur/);
  assert.throws(() => E.act(g, { type: 'raise', to: 63 }), /teilbar/);
  E.act(g, { type: 'raise', to: 60 }); // Raise um 40
  L = E.legal(g);
  assert.equal(L.call, 50); assert.equal(L.raise.min, 100);
  E.act(g, { type: 'raise', to: 100 });
  assert.equal(E.legal(g).raise.min, 140);
  assert.equal(stack(g, 'A'), 1940); assert.equal(stack(g, 'B'), 1900);
});

test('Unvollständiges All-in öffnet die Setzrunde nicht wieder', () => {
  const g = T(['A', 'B', 'C']);
  g.players[2].stack = 130; // C (BB) kurz
  E.startHand(g);
  E.act(g, { type: 'raise', to: 100 }); // A
  E.act(g, { type: 'call' });           // B
  E.act(g, { type: 'allin' });          // C: 130, nur +30 (weniger als Min-Raise 80)
  const L = E.legal(g);
  assert.equal(toAct(g), 'A');
  assert.equal(L.call, 30); assert.equal(L.raise, null);
  assert.equal(L.allin, null, 'A darf nicht mehr erhöhen');
});

test('All-in mit Side-Pots über 3+ Spieler', () => {
  const g = T(['A', 'B', 'C', 'D']);
  // A 2000 (Dealer), B 100, C 300, D 800
  g.players[1].stack = 100; g.players[2].stack = 300; g.players[3].stack = 800; g.issued = 3200;
  E.startHand(g); // B SB 10, C BB 20, D dran
  E.act(g, { type: 'allin' }); // D 800
  E.act(g, { type: 'call' });  // A 800
  E.act(g, { type: 'allin' }); // B 100
  E.act(g, { type: 'allin' }); // C 300
  assert.equal(g.hand.street, 'showdown');
  const p = g.hand.pots;
  assert.deepEqual(p.map((x) => x.amount), [400, 600, 1000]);
  assert.deepEqual(p[0].eligible.length, 4);
  assert.deepEqual(p[1].eligible.length, 3);
  assert.deepEqual(p[2].eligible.length, 2);
  // B gewinnt Hauptpot, C Side-Pot 1, A Side-Pot 2
  E.showdown(g, [[id(g, 'B')], [id(g, 'C')], [id(g, 'A')]]);
  assert.equal(stack(g, 'B'), 400); assert.equal(stack(g, 'C'), 600); assert.equal(stack(g, 'A'), 2200); assert.equal(stack(g, 'D'), 0);
  assert.equal(E.chipCheck(g).diff, 0);
  assert.equal(g.players[3].status, 'out'); assert.equal(g.players[3].place, 4);
});

test('Nicht gecallter Einsatz geht zurück', () => {
  const g = T(['A', 'B', 'C']); E.startHand(g);
  E.act(g, { type: 'allin' }); E.act(g, { type: 'fold' });
  g.players[2].stack; E.act(g, { type: 'fold' });
  assert.ok(g.hand.done);
  assert.equal(stack(g, 'A'), 2030); assert.equal(E.chipCheck(g).diff, 0);
});

test('Split-Pot: Restchip an erste Person links vom Dealer', () => {
  const g = T(['A', 'B', 'C']);
  g.hand = { dealer: id(g, 'A') };
  const s = E.split(g, 25, [id(g, 'A'), id(g, 'C')]); // Einheit 5: 10 + 15
  assert.equal(s[id(g, 'C')], 15); assert.equal(s[id(g, 'A')], 10);
  const s3 = E.split(g, 100, [id(g, 'A'), id(g, 'B'), id(g, 'C')]); // 30/30/30 + 10 an B
  assert.equal(s3[id(g, 'B')], 40);
});

test('Showdown mit Split über ganze Hand', () => {
  const g = T(['A', 'B', 'C']); E.startHand(g);
  E.act(g, { type: 'call' }); E.act(g, { type: 'call' }); E.act(g, { type: 'check' });
  for (let i = 0; i < 9; i++) E.act(g, { type: 'check' });
  assert.equal(g.hand.street, 'showdown');
  E.showdown(g, [[id(g, 'B'), id(g, 'C')]]); // Pot 60 → 30/30
  assert.equal(stack(g, 'B'), 2010); assert.equal(stack(g, 'A'), 1980);
  assert.throws(() => E.showdown(g, [[id(g, 'A')]]));
});

test('Ausscheiden, Platzierung und Rebuy', () => {
  const g = T(['A', 'B', 'C'], { rebuy: { on: true, untilLevel: 2, max: 1 } });
  E.startHand(g);
  E.act(g, { type: 'allin' }); E.act(g, { type: 'allin' }); E.act(g, { type: 'fold' });
  E.showdown(g, [[id(g, 'A')]]);
  assert.equal(g.players[1].status, 'bust');
  assert.throws(() => E.startHand(g), /Rebuy/);
  E.rebuy(g, id(g, 'B'));
  assert.equal(stack(g, 'B'), 2000); assert.equal(g.players[1].paid, 4000); assert.equal(E.chipCheck(g).diff, 0);
  assert.throws(() => E.rebuy(g, id(g, 'B')));
  // nochmals: jetzt kein Rebuy mehr möglich → scheidet aus
  E.startHand(g); // Dealer B, SB C, BB A, B dran
  E.act(g, { type: 'allin' }); E.act(g, { type: 'fold' });
  assert.equal(E.legal(g).allin, null, 'alle anderen All-in: nur noch Call'); E.act(g, { type: 'call' });
  E.showdown(g, [[id(g, 'A')]]);
  assert.equal(g.players[1].status, 'out'); assert.equal(g.players[1].place, 3);
});

test('Turnier: Abrechnung mit Preisgeld', () => {
  const g = T(['A', 'B', 'C', 'D', 'E']);
  for (const n of ['E', 'D', 'C', 'B']) E.eliminate(g, id(g, n));
  const r = E.results(g);
  assert.equal(r.pool, 10000);
  assert.deepEqual(r.rows.map((x) => [x.name, x.place, x.out]), [['A', 1, 7000], ['B', 2, 3000], ['C', 3, 0], ['D', 4, 0], ['E', 5, 0]]);
  assert.equal(r.sum, 0);
});

test('Cash: Nachkauf, Auszahlung, Abrechnung Summe 0', () => {
  const g = C(['A', 'B', 'C']);
  assert.equal(stack(g, 'A'), 2000); assert.equal(g.issued, 6000);
  assert.throws(() => E.buyIn(g, id(g, 'A'), 500), /zwischen/);
  E.startHand(g);
  assert.throws(() => E.buyIn(g, id(g, 'A'), 2000), /zwischen den Händen/);
  E.act(g, { type: 'allin' }); E.act(g, { type: 'allin' }); E.act(g, { type: 'fold' });
  E.showdown(g, [[id(g, 'A')]]);
  assert.equal(stack(g, 'A'), 4020); assert.equal(g.players[1].status, 'paused');
  E.buyIn(g, id(g, 'B'), 1000);
  assert.equal(g.players[1].status, 'active');
  E.cashOut(g, id(g, 'A'));
  assert.equal(g.players[0].out, 4020);
  E.addPlayer(g, 'D', id(g, 'C'), 1500);
  assert.equal(g.players[3].name, 'D');
  assert.equal(E.chipCheck(g).diff, 0);
  const r = E.results(g);
  assert.equal(r.sum, 0);
  assert.deepEqual(r.rows.map((x) => x.net), [2020, -2000, -20, 0]);
});

test('Cash: Pausierte werden übersprungen', () => {
  const g = C(['A', 'B', 'C', 'D']);
  E.setPaused(g, id(g, 'B'), true);
  E.startHand(g);
  assert.equal(g.hand.sb, id(g, 'C'));
  assert.ok(!g.hand.ids.includes(id(g, 'B')));
});

test('Chip-Kontrolle erkennt Abweichung, Korrektur mit Vermerk', () => {
  const g = C(['A', 'B']);
  E.startHand(g);
  assert.equal(E.chipCheck(g).diff, 0);
  E.correctStack(g, id(g, 'A'), 1995, 'falsch gezählt');
  assert.equal(E.chipCheck(g).diff, 5);
  assert.match(g.log.at(-1), /falsch gezählt/);
  E.acceptDiff(g);
  assert.equal(E.chipCheck(g).diff, 0);
});

test('Minimale Zahlungen', () => {
  const pay = E.settle([{ name: 'A', net: 3000 }, { name: 'B', net: -1000 }, { name: 'C', net: -2000 }, { name: 'D', net: 500 }, { name: 'E', net: -500 }]);
  assert.equal(pay.length, 3);
  assert.deepEqual(pay.find((p) => p.from === 'E'), { from: 'E', to: 'D', amount: 500 });
  const sum = {}; for (const p of pay) { sum[p.from] = (sum[p.from] || 0) - p.amount; sum[p.to] = (sum[p.to] || 0) + p.amount; }
  assert.deepEqual(sum, { A: 3000, B: -1000, C: -2000, D: 500, E: -500 });
});

test('Blind-Timer und Color-up', () => {
  const g = T(['A', 'B']);
  E.toggleTimer(g, 0);
  assert.equal(E.tick(g, 19 * 60000), false);
  assert.equal(E.tick(g, 20 * 60000 + 1), true);
  assert.equal(g.timer.level, 1);
  E.toggleTimer(g, 25 * 60000); // Pause
  assert.equal(E.timeLeft(g, 99 * 60000), 15 * 60000);
  assert.deepEqual(E.colorUp(g).map((c) => c.name), []); // 15/30: Rot (5) wird noch gebraucht
  g.timer.level = 0; assert.deepEqual(E.colorUp(g), [], '10/20: Rot wird bei 15/30 wieder gebraucht');
  g.timer.level = 5; // 100/200
  assert.deepEqual(E.colorUp(g).map((c) => c.name), ['Rot', 'Blau'], 'Grün braucht es später für 150/300'); g.timer.level = 8; assert.deepEqual(E.colorUp(g).map((c) => c.name), ['Rot', 'Blau', 'Grün']);
});

test('Chip-Vorschlag und Warnung bei zu wenig Chips', () => {
  const s = E.suggestChips(E.DEFAULT_CHIPS, 2000, 5);
  assert.equal(s.rest, 0);
  assert.equal(s.counts.reduce((a, k, i) => a + k * E.DEFAULT_CHIPS[i].value, 0), 2000);
  const few = E.DEFAULT_CHIPS.map((c) => ({ ...c, count: 10 }));
  assert.ok(E.suggestChips(few, 2000, 9).rest > 0);
});

test('Preisgeld passt sich an: Rebuy, Nachmelden, automatische Verteilung', () => {
  const g = T(['A', 'B', 'C', 'D', 'E'], { payoutAuto: true, late: { on: true, untilLevel: 2 }, rebuy: { on: true, untilLevel: 2, max: 1 } });
  assert.deepEqual(E.payoutOf(g), [70, 30]);
  assert.deepEqual(E.prizes(E.prizePool(g), E.payoutOf(g)), [7000, 3000]);
  E.addPlayer(g, 'F', id(g, 'E'));
  assert.equal(g.players.length, 6); assert.equal(stack(g, 'F'), 2000); assert.equal(E.chipCheck(g).diff, 0);
  assert.deepEqual(E.payoutOf(g), [50, 30, 20], 'ab 6 Personen 3 bezahlte Plätze');
  assert.deepEqual(E.prizes(E.prizePool(g), E.payoutOf(g)), [6000, 3600, 2400]);
  assert.throws(() => E.addPlayer(g, 'f', null), /gibt es schon/);
  g.timer.level = 2; // Level 3
  assert.throws(() => E.addPlayer(g, 'G', null), /nicht \(mehr\) erlaubt/);
  const r = E.results(g); assert.equal(r.pool, 12000); assert.equal(r.sum, 0);
});

test('Preisgeld: Rest an Platz 1, eigene Verteilung bleibt', () => {
  assert.deepEqual(E.prizes(5500, [70, 30]), [3900, 1600]);
  const g = T(['A', 'B', 'C', 'D', 'E', 'F'], { payout: [60, 40], payoutAuto: false });
  assert.deepEqual(E.payoutOf(g), [60, 40]);
  assert.throws(() => E.addPlayer(g, 'G', null), /nicht \(mehr\) erlaubt/, 'Turnier ohne Nachmelden');
});
