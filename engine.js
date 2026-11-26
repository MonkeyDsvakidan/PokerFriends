// Poker-Spielleiter – Spiellogik als reine Funktionen auf einem JSON-Spielstand (testbar mit `node --test`).
// Geld immer in Rappen (Ganzzahl), Chips in Punkten (Ganzzahl). Sitzreihenfolge = Reihenfolge in g.players (im Uhrzeigersinn).

export const DEFAULT_CHIPS = [
  { name: 'Rot', color: '#e5484d', value: 5, count: 100 },
  { name: 'Blau', color: '#3e63dd', value: 10, count: 100 },
  { name: 'Grün', color: '#30a46c', value: 25, count: 100 },
  { name: 'Schwarz', color: '#2b2a30', value: 100, count: 100 },
  { name: 'Lila', color: '#8e4ec6', value: 500, count: 50 },
];
export const DEFAULT_LEVELS = [[10, 20], [15, 30], [25, 50], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400], [300, 600]]
  .map(([sb, bb]) => ({ sb, bb }));

export function suggestPayout(n) {
  if (n <= 3) return [100];
  if (n <= 5) return [70, 30];
  return [50, 30, 20];
}

const err = (msg) => { throw new Error(msg); };
const P = (g, id) => g.players.find((p) => p.id === id);
const name = (g, id) => P(g, id).name;
export const unitOf = (g) => Math.min(...g.chips.map((c) => c.value).filter((v) => v > 0), Infinity) || 1;

// ---------- Chips verteilen ----------
// Vorschlag, wie viele Chips jeder Farbe eine Person für `amount` Punkte bekommt (n Personen teilen sich den Vorrat).
export function suggestChips(chips, amount, n = 1) {
  const cs = chips.map((c, i) => ({ ...c, i, cap: Math.floor(c.count / n) })).filter((c) => c.value > 0).sort((a, b) => a.value - b.value);
  const counts = new Array(chips.length).fill(0);
  let rest = amount;
  // Etwas Kleingeld: kleine Farben je ca. 5 % des Betrags (4–10 Stück), solange sie deutlich kleiner als der Betrag sind
  for (const c of cs) {
    if (c.value * 20 > amount) break;
    const k = Math.min(c.cap, 10, Math.max(4, Math.floor((amount * 0.05) / c.value)), Math.floor(rest / c.value));
    counts[c.i] += k; rest -= k * c.value;
  }
  // Rest möglichst mit mittleren Farben (höchstens 1/10 des Betrags), danach mit allen, gross zuerst
  for (const limit of [amount / 10, Infinity]) {
    for (const c of [...cs].reverse()) {
      if (c.value > limit) continue;
      const k = Math.min(c.cap - counts[c.i], Math.floor(rest / c.value));
      if (k > 0) { counts[c.i] += k; rest -= k * c.value; }
    }
  }
  return { counts, rest }; // rest > 0: reicht nicht oder lässt sich nicht genau legen
}

// ---------- Spiel anlegen ----------
// cfg: { mode:'tournament'|'cash', names:[...], chips, tournament:{buyIn(Rp), startStack, levels, levelMin, rebuy:{on,untilLevel,max}, payout:[%]},
//        cash:{points, rappen, sb, bb, minBuy(Rp), maxBuy(Rp), firstBuy(Rp)} }
export function newGame(cfg, rnd = Math.random) {
  if (cfg.names.length < 2) err('Es braucht mindestens 2 Personen.');
  const g = {
    v: 1, mode: cfg.mode, chips: cfg.chips, players: [], issued: 0, handNo: 0, hand: null,
    dealer: null, hands: [], log: [], hint: '', ended: false,
    t: cfg.mode === 'tournament' ? cfg.tournament : null,
    c: cfg.mode === 'cash' ? cfg.cash : null,
    timer: cfg.mode === 'tournament' ? { level: 0, left: cfg.tournament.levelMin * 60000, since: null } : null,
  };
  cfg.names.forEach((n, i) => g.players.push({ id: 'p' + (i + 1), name: n, stack: 0, status: 'active', paid: 0, out: 0, rebuys: 0, place: null }));
  if (g.mode === 'tournament') {
    for (const p of g.players) { p.stack = g.t.startStack; p.paid = g.t.buyIn; }
    g.issued = g.players.length * g.t.startStack;
  } else {
    for (const p of g.players) buyIn(g, p.id, cfg.cash.firstBuy);
  }
  g.dealer = g.players[Math.floor(rnd() * g.players.length)].id;
  g.hint = `${name(g, g.dealer)} bekommt den Dealer-Button (ausgelost).`;
  return g;
}

// ---------- Hilfen Reihenfolge ----------
const dealtIn = (g) => g.players.filter((p) => p.status === 'active' && p.stack > 0).map((p) => p.id);
// nächste ID nach `id` (im Uhrzeigersinn) aus `ids`; `id` muss nicht in `ids` sein
function nextOf(g, id, ids) {
  const order = g.players.map((p) => p.id);
  const start = order.indexOf(id);
  for (let k = 1; k <= order.length; k++) {
    const cand = order[(start + k) % order.length];
    if (ids.includes(cand)) return cand;
  }
  return null;
}
// Reihenfolge ab der ersten Person links vom Dealer
export function fromLeftOfDealer(g, ids) {
  const out = []; let cur = g.hand ? g.hand.dealer : g.dealer;
  for (let k = 0; k < ids.length; k++) { cur = nextOf(g, cur, ids); out.push(cur); }
  return out;
}

export function blindsNow(g) {
  return g.mode === 'tournament' ? g.t.levels[Math.min(g.timer.level, g.t.levels.length - 1)] : { sb: g.c.sb, bb: g.c.bb };
}

export const pendingBusts = (g) => g.players.filter((p) => p.status === 'bust');

// ---------- Hand ----------
export function startHand(g) {
  if (g.ended) err('Das Spiel ist beendet.');
  if (g.hand && !g.hand.done) err('Die laufende Hand ist noch nicht fertig.');
  if (pendingBusts(g).length) err('Zuerst entscheiden: Rebuy oder ausscheiden.');
  const ids = dealtIn(g);
  if (ids.length < 2) err('Es braucht mindestens 2 Personen mit Chips.');
  const dealer = g.handNo === 0 && ids.includes(g.dealer) ? g.dealer : nextOf(g, g.dealer, ids);
  g.dealer = dealer;
  const blinds = { ...blindsNow(g) };
  const sb = ids.length === 2 ? dealer : nextOf(g, dealer, ids); // Heads-up: Dealer ist Small Blind
  const bb = nextOf(g, sb, ids);
  const h = g.hand = {
    no: ++g.handNo, dealer, sb, bb, ids, blinds, street: 'preflop', done: false,
    bets: {}, contrib: {}, folded: {}, allin: {}, acted: {}, cur: blinds.bb, minRaise: blinds.bb, toAct: null, lines: [], pots: null, result: null,
  };
  for (const id of ids) { h.bets[id] = 0; h.contrib[id] = 0; }
  const post = (id, amt, what) => {
    const p = P(g, id), a = Math.min(amt, p.stack);
    p.stack -= a; h.bets[id] += a; h.contrib[id] += a;
    if (p.stack === 0) h.allin[id] = true;
    return `${p.name} legt ${a} als ${what}${p.stack === 0 ? ' (All-in)' : ''}`;
  };
  const hint = [post(sb, blinds.sb, 'Small Blind'), post(bb, blinds.bb, 'Big Blind')].join(' · ');
  h.lines.push(hint);
  g.hint = `Hand ${h.no}: ${hint}. ${name(g, dealer)} teilt aus.`;
  advance(g, bb);
  return g;
}

const live = (h) => h.ids.filter((id) => !h.folded[id]);
const needs = (h, id) => !h.folded[id] && !h.allin[id] && (!h.acted[id] || h.bets[id] < h.cur);

// Erlaubte Aktionen der Person, die dran ist
export function legal(g) {
  const h = g.hand; if (!h || h.done || !h.toAct) return null;
  const id = h.toAct, stack = P(g, id).stack, bet = h.bets[id], toCall = h.cur - bet;
  const othersCanAct = live(h).some((o) => o !== id && !h.allin[o]);
  const canRaise = !h.acted[id] && othersCanAct;
  const r = { id, toCall, fold: toCall > 0, check: toCall === 0, call: null, bet: null, raise: null, allin: null, pot: potTotal(h) };
  if (toCall > 0 && stack > toCall) r.call = toCall;
  if (canRaise && h.cur === 0 && stack > Math.min(h.blinds.bb, stack)) r.bet = { min: h.blinds.bb, max: stack };
  if (canRaise && h.cur > 0 && bet + stack > h.cur + h.minRaise) r.raise = { min: h.cur + h.minRaise, max: bet + stack };
  if (stack > 0 && (canRaise || stack <= toCall)) r.allin = bet + stack;
  return r;
}
export const potTotal = (h) => Object.values(h.contrib).reduce((a, b) => a + b, 0);

// a: { type:'fold'|'check'|'call'|'bet'|'raise'|'allin', to?: Gesamteinsatz dieser Setzrunde }
export function act(g, a) {
  const L = legal(g); if (!L) err('Gerade ist niemand dran.');
  const h = g.hand, id = L.id, p = P(g, id), bet = h.bets[id];
  let line;
  const putTo = (to) => { const add = to - bet; p.stack -= add; h.bets[id] = to; h.contrib[id] += add; if (p.stack === 0) h.allin[id] = true; return add; };
  let type = a.type, to = a.to;
  if ((type === 'bet' || type === 'raise') && to === L.allin) type = 'allin';
  switch (type) {
    case 'fold':
      if (!L.fold) err('Fold ist hier nicht nötig – du kannst checken.');
      h.folded[id] = true; line = `${p.name} passt (Fold) – Karten weg`; break;
    case 'check':
      if (!L.check) err(`Check geht nicht: es sind ${L.toCall} offen.`);
      line = `${p.name} checkt`; break;
    case 'call':
      if (L.call == null) err('Call geht hier nicht.');
      putTo(h.cur); line = `${p.name} geht mit (Call) – legt ${L.call} dazu`; break;
    case 'bet': case 'raise': {
      const lim = type === 'bet' ? L.bet : L.raise;
      if (!lim) err(type === 'bet' ? 'Bet geht hier nicht.' : 'Raise geht hier nicht.');
      if (!Number.isInteger(to)) err('Bitte einen Betrag eingeben.');
      if (to > lim.max) err(`${p.name} hat nur ${lim.max} – mehr geht nicht.`);
      if (to < lim.min) err(type === 'bet' ? `Mindestens ${lim.min} setzen.` : `Mindest-Raise: auf ${lim.min} erhöhen.`);
      const u = unitOf(g); if (to % u) err(`Der Betrag muss durch ${u} teilbar sein (kleinster Chip).`);
      const add = putTo(to);
      h.minRaise = to - h.cur; h.cur = to; h.acted = {};
      line = type === 'bet' ? `${p.name} setzt ${to} – legt ${add} vor sich` : `${p.name} erhöht auf ${to} – legt ${add} dazu`;
      break;
    }
    case 'allin': {
      if (L.allin == null) err('All-in geht hier nicht.');
      const total = L.allin, add = putTo(total);
      if (total > h.cur) {
        const raise = total - h.cur;
        if (raise >= h.minRaise) { h.minRaise = raise; h.acted = {}; } // volles Raise öffnet die Setzrunde wieder
        h.cur = total;
      }
      line = `${p.name} geht All-in – legt ${add} dazu (total ${total})`;
      break;
    }
    default: err('Unbekannte Aktion.');
  }
  h.acted[id] = true;
  h.lines.push(line);
  g.hint = line;
  advance(g, id);
  return g;
}

const STREETS = ['preflop', 'flop', 'turn', 'river'];
const REVEAL = { flop: 'Flop aufdecken (3 Karten)', turn: 'Turn aufdecken (1 Karte)', river: 'River aufdecken (1 Karte)' };

function advance(g, lastId) {
  const h = g.hand;
  const lv = live(h);
  if (lv.length === 1) return finish(g, [[lv[0]]]); // alle anderen haben gepasst
  const waiting = h.ids.filter((id) => needs(h, id));
  if (waiting.length) { h.toAct = nextOf(g, lastId, waiting); return; }
  // Setzrunde fertig: Einsätze in die Mitte
  for (const id of h.ids) h.bets[id] = 0;
  h.cur = 0; h.minRaise = h.blinds.bb; h.acted = {}; h.toAct = null;
  const canAct = lv.filter((id) => !h.allin[id]);
  const idx = STREETS.indexOf(h.street);
  if (canAct.length <= 1 || h.street === 'river') {
    const rest = STREETS.slice(idx + 1).map((s) => REVEAL[s]);
    h.street = 'showdown';
    h.pots = pots(h);
    g.hint = `Einsätze in die Mitte. ${rest.length ? rest.join(', ') + '. ' : ''}Showdown: Karten zeigen.`;
    if (h.pots.every((pt) => pt.eligible.length === 1)) finish(g, h.pots.map((pt) => pt.eligible));
    return;
  }
  h.street = STREETS[idx + 1];
  g.hint = `Einsätze in die Mitte. ${REVEAL[h.street]}.`;
  h.lines.push(REVEAL[h.street]);
  h.toAct = nextOf(g, h.dealer, canAct.filter((id) => needs(h, id)));
}

// Haupt- und Side-Pots aus den Gesamteinsätzen der Hand
export function pots(h) {
  const ids = h.ids.filter((id) => h.contrib[id] > 0);
  const lv = ids.filter((id) => !h.folded[id]);
  const levels = [...new Set(lv.map((id) => h.contrib[id]))].sort((a, b) => a - b);
  const res = []; let prev = 0;
  for (const L of levels) {
    const amount = ids.reduce((s, id) => s + Math.min(h.contrib[id], L) - Math.min(h.contrib[id], prev), 0);
    const eligible = lv.filter((id) => h.contrib[id] >= L);
    const payers = ids.filter((id) => h.contrib[id] > prev).length;
    const last = res[res.length - 1];
    if (last && last.eligible.join() === eligible.join()) last.amount += amount;
    else if (amount > 0) res.push({ amount, eligible, uncalled: false });
    res[res.length - 1].uncalled = eligible.length === 1 && payers === 1;
    prev = L;
  }
  const extra = ids.reduce((s, id) => s + Math.max(0, h.contrib[id] - prev), 0); // nur Gepasste über dem höchsten Einsatz (selten)
  if (extra && res.length) res[res.length - 1].amount += extra;
  return res;
}

// Pot unter Gewinnern teilen: in Einheiten des kleinsten Chips, Rest an die erste Person links vom Dealer
export function split(g, amount, winners) {
  const u = amount % unitOf(g) === 0 ? unitOf(g) : 1;
  const order = fromLeftOfDealer(g, winners);
  const share = Math.floor(amount / winners.length / u) * u;
  const out = Object.fromEntries(order.map((id) => [id, share]));
  out[order[0]] += amount - share * winners.length;
  return out;
}

// Showdown: winnersByPot[i] = Gewinner von Pot i (bei Pots mit nur einer berechtigten Person automatisch)
export function showdown(g, winnersByPot) {
  const h = g.hand;
  if (!h || h.street !== 'showdown' || h.done) err('Gerade gibt es keinen Showdown.');
  const ws = h.pots.map((pt, i) => (pt.eligible.length === 1 ? pt.eligible : winnersByPot[i] || []));
  ws.forEach((w, i) => {
    if (!w.length) err(`Für ${potLabel(h.pots, i)} ist kein Gewinner gewählt.`);
    if (w.some((id) => !h.pots[i].eligible.includes(id))) err(`Nicht alle Gewählten spielen um ${potLabel(h.pots, i)}.`);
  });
  return finish(g, ws);
}
export const potLabel = (ps, i) => (ps.length === 1 ? 'den Pot' : i === 0 ? 'den Hauptpot' : `Side-Pot ${i}`);

function finish(g, ws) {
  const h = g.hand;
  if (!h.pots || h.street !== 'showdown') h.pots = pots(h);
  if (ws.length === 1 && h.pots.length > 1) ws = h.pots.map(() => ws[0]); // alle gepasst: alles an die letzte Person
  const won = {}, parts = [];
  h.pots.forEach((pt, i) => {
    const s = split(g, pt.amount, ws[i]);
    for (const [id, a] of Object.entries(s)) { P(g, id).stack += a; won[id] = (won[id] || 0) + a; }
    const who = ws[i].map((id) => `${name(g, id)} ${s[id]}`).join(', ');
    parts.push(pt.uncalled ? `${pt.amount} zurück an ${name(g, ws[i][0])} (nicht gecallt)`
      : ws[i].length > 1 ? `${h.pots.length > 1 ? cap(potLabel(h.pots, i)) + ' ' : 'Pot '}${pt.amount} geteilt: ${who}` : `${h.pots.length > 1 ? cap(potLabel(h.pots, i)) : 'Pot'} von ${pt.amount} an ${name(g, ws[i][0])}`);
  });
  h.done = true; h.toAct = null; h.result = won;
  g.hint = parts.join(' · ');
  h.lines.push(g.hint);
  g.hands.unshift({ no: h.no, dealer: name(g, h.dealer), blinds: `${h.blinds.sb}/${h.blinds.bb}`, pot: potTotal(h), result: g.hint, lines: h.lines });
  g.hands.length = Math.min(g.hands.length, 100);
  // Wer keine Chips mehr hat
  const busted = h.ids.filter((id) => P(g, id).stack === 0);
  if (g.mode === 'cash') {
    for (const id of busted) P(g, id).status = 'paused';
    if (busted.length) g.hint += ` · ${busted.map((id) => name(g, id)).join(', ')} hat keine Chips mehr: nachkaufen oder pausieren.`;
  } else {
    // Kleinerer Stack zu Beginn der Hand = schlechtere Platzierung (zuerst ausgeschieden)
    busted.sort((a, b) => h.contrib[a] - h.contrib[b]);
    for (const id of busted) { if (canRebuy(g, id)) P(g, id).status = 'bust'; else eliminate(g, id); }
  }
  return g;
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// ---------- Turnier ----------
export function canRebuy(g, id) {
  const r = g.t && g.t.rebuy;
  return !!(r && r.on && g.timer.level + 1 <= r.untilLevel && P(g, id).rebuys < r.max);
}
export function rebuy(g, id) {
  const p = P(g, id);
  if (!canRebuy(g, id)) err('Rebuy ist nicht mehr erlaubt.');
  if (p.stack > 0 || (g.hand && !g.hand.done)) err('Rebuy geht nur mit 0 Chips zwischen den Händen.');
  p.stack = g.t.startStack; p.paid += g.t.buyIn; p.rebuys++; p.status = 'active';
  g.issued += g.t.startStack;
  g.hint = `${p.name} kauft nach (Rebuy): zahlt ${chf(g.t.buyIn)} und bekommt ${g.t.startStack} Chips.`;
  return g;
}
export function eliminate(g, id) {
  const p = P(g, id);
  p.place = g.players.filter((q) => q.status !== 'out').length;
  p.status = 'out';
  g.log.push(`${p.name} scheidet aus (Platz ${p.place})`);
  g.hint = (g.hint ? g.hint + ' · ' : '') + `${p.name} scheidet aus: Platz ${p.place}.`;
  const left = g.players.filter((q) => q.status !== 'out');
  if (left.length === 1) { left[0].place = 1; g.hint += ` ${left[0].name} gewinnt das Turnier!`; }
  return g;
}

// Blind-Timer: gibt true zurück, wenn ein neues Level begonnen hat
export function tick(g, now) {
  const t = g.timer; if (!t || t.since == null) return false;
  let changed = false;
  while (now - t.since >= t.left && t.level < g.t.levels.length - 1) {
    t.since += t.left; t.level++; t.left = g.t.levelMin * 60000; changed = true;
  }
  if (t.level === g.t.levels.length - 1 && now - t.since >= t.left) { t.left = 0; t.since = now; }
  return changed;
}
export function timeLeft(g, now) { const t = g.timer; return Math.max(0, t.since == null ? t.left : t.left - (now - t.since)); }
export function toggleTimer(g, now) {
  const t = g.timer;
  if (t.since == null) t.since = now; else { t.left = timeLeft(g, now); t.since = null; }
  return g;
}

// Color-up: welche kleinen Farben die aktuellen Blinds nicht mehr brauchen
// (berücksichtigt auch alle späteren Levels, damit eine Farbe nicht entfernt wird, die später wieder nötig ist)
export function colorUp(g) {
  const bl = g.t.levels.slice(Math.min(g.timer.level, g.t.levels.length - 1));
  const vals = g.chips.map((c) => c.value).filter((v) => v > 0).sort((a, b) => a - b);
  const need = Math.max(...vals.filter((v) => bl.every((l) => l.sb % v === 0 && l.bb % v === 0)), 0);
  return g.chips.filter((c) => c.value < need);
}

// ---------- Cash Game ----------
export const toChf = (g, points) => Math.round((points * g.c.rappen) / g.c.points);
export const toPoints = (g, rappen) => Math.round((rappen * g.c.points) / g.c.rappen);
const between = (g) => { if (g.hand && !g.hand.done) err('Das geht nur zwischen den Händen.'); };

export function buyIn(g, id, rappen) {
  between(g);
  const p = P(g, id), c = g.c;
  if (!(rappen > 0)) err('Bitte einen Betrag in CHF eingeben.');
  if (rappen < c.minBuy || rappen > c.maxBuy) err(`Einkauf zwischen ${chf(c.minBuy)} und ${chf(c.maxBuy)}.`);
  const pts = toPoints(g, rappen);
  if (pts % unitOf(g)) err(`${chf(rappen)} ergibt ${pts} Punkte – das lässt sich nicht mit Chips legen.`);
  p.stack += pts; p.paid += rappen; p.status = 'active';
  g.issued += pts;
  g.hint = `${p.name} zahlt ${chf(rappen)} und bekommt ${pts} Chips.`;
  return g;
}
export function setPaused(g, id, paused) {
  between(g);
  const p = P(g, id);
  if (!paused && p.stack === 0) err(`${p.name} hat keine Chips – zuerst nachkaufen.`);
  p.status = paused ? 'paused' : 'active';
  g.hint = paused ? `${p.name} pausiert und wird übersprungen.` : `${p.name} spielt wieder mit.`;
  return g;
}
export function cashOut(g, id) {
  between(g);
  const p = P(g, id), r = toChf(g, p.stack);
  g.hint = `${p.name} steigt aus: gibt ${p.stack} Chips ab und bekommt ${chf(r)}.`;
  p.out += r; g.issued -= p.stack; p.stack = 0; p.status = 'left';
  return g;
}
export function addPlayer(g, nm, afterId, rappen) {
  between(g);
  nm = String(nm || '').trim().slice(0, 20);
  if (!nm) err('Bitte einen Namen eingeben.');
  if (g.players.some((p) => p.name.toLowerCase() === nm.toLowerCase())) err(`«${nm}» gibt es schon.`);
  const id = 'p' + (Math.max(...g.players.map((p) => +p.id.slice(1))) + 1);
  const at = afterId ? g.players.findIndex((p) => p.id === afterId) + 1 : g.players.length;
  g.players.splice(at, 0, { id, name: nm, stack: 0, status: 'paused', paid: 0, out: 0, rebuys: 0, place: null });
  try { buyIn(g, id, rappen); } catch (e) { g.players.splice(at, 1); throw e; }
  g.hint = `${nm} setzt sich dazu. ` + g.hint;
  return g;
}

// ---------- Kontrolle ----------
export function chipCheck(g) {
  const inPot = g.hand && !g.hand.done ? potTotal(g.hand) : 0;
  const actual = g.players.reduce((s, p) => s + p.stack, 0) + inPot;
  return { expected: g.issued, actual, diff: actual - g.issued };
}
export function correctStack(g, id, stack, note) {
  if (!Number.isInteger(stack) || stack < 0) err('Bitte eine gültige Zahl eingeben.');
  const p = P(g, id), from = p.stack;
  p.stack = stack;
  if (stack > 0 && p.status === 'paused' && g.mode === 'tournament') p.status = 'active';
  g.log.push(`Korrektur ${p.name}: ${from} → ${stack}${note ? ` (${note})` : ''}`);
  g.hint = `Stand von ${p.name} korrigiert: ${from} → ${stack}.`;
  return g;
}
export function acceptDiff(g) {
  const c = chipCheck(g);
  g.log.push(`Abweichung ${c.diff > 0 ? '+' : ''}${c.diff} übernommen (ausgegeben ${c.expected} → ${c.actual})`);
  g.issued = c.actual;
  return g;
}

// ---------- Abrechnung ----------
export function results(g) {
  if (g.mode === 'cash') {
    const rows = g.players.map((p) => {
      const out = p.out + toChf(g, p.stack);
      return { id: p.id, name: p.name, paid: p.paid, out, net: out - p.paid };
    });
    return { rows, sum: rows.reduce((s, r) => s + r.net, 0) };
  }
  // Turnier: Noch Spielende nach Stack einreihen
  const rest = g.players.filter((p) => p.status !== 'out').sort((a, b) => b.stack - a.stack);
  const place = new Map(g.players.filter((p) => p.status === 'out').map((p) => [p.id, p.place]));
  rest.forEach((p, i) => place.set(p.id, i + 1));
  const pool = g.players.reduce((s, p) => s + p.paid, 0);
  const prizes = g.t.payout.map((pc) => Math.floor((pool * pc) / 100 / 100) * 100); // ganze Franken
  if (prizes.length) prizes[0] += pool - prizes.reduce((a, b) => a + b, 0);
  const rows = g.players.map((p) => {
    const pl = place.get(p.id), out = prizes[pl - 1] || 0;
    return { id: p.id, name: p.name, place: pl, paid: p.paid, out, net: out - p.paid, rebuys: p.rebuys };
  }).sort((a, b) => a.place - b.place);
  return { rows, pool, sum: rows.reduce((s, r) => s + r.net, 0) };
}

// Wer zahlt wem: zuerst gleich grosse Beträge direkt, dann grösster Schuldner an grössten Gläubiger
export function settle(rows) {
  const deb = rows.filter((r) => r.net < 0).map((r) => ({ name: r.name, a: -r.net }));
  const cre = rows.filter((r) => r.net > 0).map((r) => ({ name: r.name, a: r.net }));
  const pay = [];
  for (const d of deb) {
    const c = cre.find((x) => x.a === d.a);
    if (c) { pay.push({ from: d.name, to: c.name, amount: d.a }); c.a = 0; d.a = 0; }
  }
  for (;;) {
    const d = deb.filter((x) => x.a > 0).sort((a, b) => b.a - a.a)[0];
    const c = cre.filter((x) => x.a > 0).sort((a, b) => b.a - a.a)[0];
    if (!d || !c) break;
    const a = Math.min(d.a, c.a);
    pay.push({ from: d.name, to: c.name, amount: a });
    d.a -= a; c.a -= a;
  }
  return pay;
}

export function chf(rappen) {
  const s = (Math.abs(rappen) / 100).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${rappen < 0 ? '−' : ''}CHF ${s}`;
}
export const pts = (n) => Number(n).toLocaleString('de-CH');
