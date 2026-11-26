// Poker-Spielleiter – Oberfläche. Die Regeln stehen in engine.js; hier nur Anzeige, Eingaben und Speichern.
import * as E from './engine.js?v=3';

const KEY = 'poker-spielleiter-v1';
const UNDO_MAX = 25;
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app'), dlg = $('#dlg'), topAct = $('#topAct');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const pts = E.pts, chf = E.chf;
// CHF-Eingabe («20», «20.50», «20,50», «20.–») → Rappen
const rp = (s) => { const n = parseFloat(String(s).replace(',', '.').replace(/[^\d.]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
const int = (s) => (/^\s*\d+\s*$/.test(String(s)) ? parseInt(s, 10) : NaN);

let S = { game: null, undo: [], setup: null, view: 'home', err: '', sel: {}, sort: 'seat', showChf: false, saveFail: false, loadFail: false };

// ---------- Speichern ----------
function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { /* privates Fenster: dann ohne Speichern */ }
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    if (d.game && d.game.v !== 1) throw new Error('Version');
    S.game = d.game || null; S.undo = d.undo || []; S.setup = d.setup || null; S.showChf = !!d.showChf;
    S.view = S.game ? 'table' : S.setup ? 'setup' : 'home';
  } catch { S.loadFail = true; S.view = 'home'; }
}
function save() {
  const data = () => JSON.stringify({ game: S.game, undo: S.undo, setup: S.setup, showChf: S.showChf });
  try { localStorage.setItem(KEY, data()); S.saveFail = false; }
  catch {
    S.undo = S.undo.slice(-3); // Speicher voll: alte Rückgängig-Schritte opfern, Spielstand behalten
    try { localStorage.setItem(KEY, data()); S.saveFail = false; } catch { S.saveFail = true; }
  }
}

// Jede Spielaktion läuft auf einer Kopie: bei einem Fehler bleibt der Stand unverändert
function run(label, fn) {
  const next = structuredClone(S.game);
  try { fn(next); } catch (e) { S.err = e.message; render(); return false; }
  S.undo.push({ label, game: S.game });
  if (S.undo.length > UNDO_MAX) S.undo.shift();
  S.game = next; S.err = '';
  save(); render();
  return true;
}
function undo() {
  const u = S.undo.pop(); if (!u) return;
  const timer = S.game.timer; // der Blind-Timer läuft weiter, er wird nicht zurückgedreht
  S.game = u.game; S.game.timer = timer;
  S.game.hint = `Rückgängig: ${u.label}. ${S.game.hint}`; S.err = ''; S.sel = {};
  save(); render();
}

// ---------- Setup ----------
// Abend-Rangliste (GameMaster, /abend.js der Startseite): Hat die Gruppe heute Abend eben ein anderes Spiel beendet,
// stehen deren Namen schon drin. Poker zählt selbst nicht in die Rangliste. Fehlt /abend.js, gilt das letzte Setup.
function eveningGroup() {
  try {
    const games = window.GMAbend?.load().games || [];
    const names = (games[games.length - 1]?.places || []).map((p) => String(p.name).slice(0, 20)).slice(0, 9);
    return names.length >= 2 ? [...names, ...Array(Math.max(0, 3 - names.length)).fill('')] : null;
  } catch { return null; }
}
function newSetup(mode, prev) {
  return {
    mode, names: eveningGroup() || (prev?.names?.filter(Boolean).length ? prev.names.filter(Boolean) : ['', '', '']),
    chips: prev?.chips || structuredClone(E.DEFAULT_CHIPS),
    buyIn: '20', startStack: '2000', levelMin: '20', levels: structuredClone(E.DEFAULT_LEVELS).map((l) => ({ sb: String(l.sb), bb: String(l.bb) })),
    rebuyOn: false, rebuyUntil: '4', rebuyMax: '1', lateOn: false, lateUntil: '2', payout: null,
    cPoints: '100', cChf: '1', sb: '10', bb: '20', minBuy: '10', maxBuy: '50', firstBuy: '20',
  };
}
function buildCfg(st) {
  const errs = [];
  const names = st.names.map((s) => s.trim().slice(0, 20)).filter(Boolean);
  if (names.length < 2) errs.push('Mindestens 2 Personen eintragen.');
  if (names.length > 9) errs.push('Höchstens 9 Personen.');
  const dup = names.find((n, i) => names.findIndex((m) => m.toLowerCase() === n.toLowerCase()) !== i);
  if (dup) errs.push(`Der Name «${dup}» kommt doppelt vor.`);
  const chips = st.chips.map((c) => ({ name: c.name.trim() || 'Chip', color: c.color, value: int(c.value), count: int(c.count) }));
  if (chips.some((c) => !(c.value > 0) || !(c.count >= 0))) errs.push('Jede Chipfarbe braucht einen Wert und eine Stückzahl (ganze Zahlen).');
  if (!chips.length) errs.push('Mindestens eine Chipfarbe erfassen.');
  const unit = Math.min(...chips.map((c) => c.value).filter((v) => v > 0)) || 1;
  const cfg = { mode: st.mode, names, chips };
  if (st.mode === 'tournament') {
    const t = { buyIn: rp(st.buyIn), startStack: int(st.startStack), levelMin: int(st.levelMin),
      levels: st.levels.map((l) => ({ sb: int(l.sb), bb: int(l.bb) })),
      rebuy: { on: st.rebuyOn, untilLevel: int(st.rebuyUntil), max: int(st.rebuyMax) },
      payout: (st.payout || E.suggestPayout(names.length)).map(Number), payoutAuto: !st.payout,
      late: { on: st.lateOn, untilLevel: int(st.lateUntil) } };
    if (!(t.buyIn > 0)) errs.push('Buy-in in CHF eingeben.');
    if (!(t.startStack > 0)) errs.push('Startstack eingeben.');
    else if (t.startStack % unit) errs.push(`Der Startstack muss durch ${unit} teilbar sein (kleinster Chip).`);
    if (!(t.levelMin >= 1)) errs.push('Levellänge in Minuten eingeben.');
    if (!t.levels.length) errs.push('Mindestens ein Blind-Level.');
    t.levels.forEach((l, i) => {
      if (!(l.sb > 0 && l.bb >= l.sb)) errs.push(`Level ${i + 1}: Small Blind und Big Blind prüfen.`);
      else if (l.sb % unit || l.bb % unit) errs.push(`Level ${i + 1}: Blinds müssen durch ${unit} teilbar sein.`);
    });
    if (t.rebuy.on && !(t.rebuy.untilLevel >= 1 && t.rebuy.max >= 1)) errs.push('Rebuy: bis Level und Anzahl eingeben.');
    if (t.late.on && !(t.late.untilLevel >= 1)) errs.push('Nachmelden: bis Level eingeben.');
    const sum = t.payout.reduce((a, b) => a + b, 0);
    if (t.payout.some((x) => !(x >= 0)) || sum !== 100) errs.push(`Preisgeld-Verteilung ergibt ${sum} % statt 100 %.`);
    if (t.payout.length > Math.max(names.length, 1)) errs.push('Mehr bezahlte Plätze als Personen.');
    cfg.tournament = t;
  } else {
    const c = { points: int(st.cPoints), rappen: rp(st.cChf), sb: int(st.sb), bb: int(st.bb), minBuy: rp(st.minBuy), maxBuy: rp(st.maxBuy), firstBuy: rp(st.firstBuy) };
    if (!(c.points > 0 && c.rappen > 0)) errs.push('Umrechnung eingeben (z. B. 100 Punkte = CHF 1.–).');
    if (!(c.sb > 0 && c.bb >= c.sb)) errs.push('Blinds prüfen.');
    else if (c.sb % unit || c.bb % unit) errs.push(`Blinds müssen durch ${unit} teilbar sein.`);
    if (!(c.minBuy > 0 && c.maxBuy >= c.minBuy)) errs.push('Mindest- und Höchstbetrag prüfen.');
    if (!(c.firstBuy >= c.minBuy && c.firstBuy <= c.maxBuy)) errs.push('Der Einkauf zu Beginn muss zwischen Mindest- und Höchstbetrag liegen.');
    const p = Math.round((c.firstBuy * c.points) / c.rappen);
    if (p % unit) errs.push(`${chf(c.firstBuy)} ergibt ${p} Punkte – nicht mit Chips legbar.`);
    cfg.cash = c;
  }
  return { cfg, errs, unit };
}
function stackFor(cfg) {
  if (cfg.mode === 'tournament') return cfg.tournament.startStack;
  const c = cfg.cash; return Math.round((c.firstBuy * c.points) / c.rappen);
}

function viewHome() {
  topAct.innerHTML = '';
  return `<div class="home">
    <h1>Poker-Spielleiter</h1>
    <p class="muted">Für Texas Hold'em mit echten Karten und Chips. Das Handy liegt in der Mitte und sagt, wer dran ist, was zu setzen ist und wer am Schluss wem wie viel schuldet.</p>
    ${S.loadFail ? `<div class="notice bad">${ic('alert')}<div class="grow"><b>Der gespeicherte Spielstand liess sich nicht lesen.</b><span>Wähle einen Modus, um neu zu beginnen. Der alte Stand bleibt als Sicherung im Browser.</span></div></div>` : ''}
    <div class="modes">
      <button class="mode" data-a="mode" data-v="tournament"><b>Turnier</b><span>Alle zahlen gleich viel und bekommen gleich viele Chips. Die Blinds steigen, wer keine Chips mehr hat, scheidet aus. Das Preisgeld wird nach Rangliste verteilt.</span></button>
      <button class="mode" data-a="mode" data-v="cash"><b>Cash Game</b><span>Chips haben einen festen Franken-Wert, die Blinds bleiben gleich. Nachkaufen und Aussteigen jederzeit zwischen den Händen. Am Schluss wird in Franken abgerechnet.</span></button>
    </div>
  </div>`;
}

const fld = (label, f, v, o = '') => `<label>${label}<input type="text" data-f="${f}" value="${esc(v)}" ${o}></label>`;
const numO = 'inputmode="numeric" autocomplete="off"', chfO = 'inputmode="decimal" autocomplete="off"';

function viewSetup() {
  const st = S.setup, T = st.mode === 'tournament';
  topAct.innerHTML = `<button class="btn ghost" data-a="home">Modus</button>`;
  const payout = st.payout || E.suggestPayout(st.names.filter((n) => n.trim()).length);
  return `<div class="setup">
    <div><h1 class="h2">${T ? 'Turnier' : 'Cash Game'} einrichten</h1><p class="muted">Diese Einstellungen gelten fürs ganze Spiel. Die Eingaben bleiben gespeichert, auch für das nächste Mal.</p></div>
    <section>
      <div class="sec-head"><h2 class="h3">Spieler und Sitzordnung</h2><span class="muted"><span data-live="count"></span> · im Uhrzeigersinn, am Griff ziehen</span></div>
      <ol class="plist" id="plist">${st.names.map((n, i) => `<li data-i="${i}">
        <button class="grip" data-i="${i}" aria-label="Sitz ${i + 1} verschieben (Pfeiltasten)">${ic('grip')}</button>
        <label class="sr"><span class="seatno">Sitz ${i + 1}</span><input type="text" data-f="names.${i}" value="${esc(n)}" maxlength="20" placeholder="Name" autocomplete="off"></label>
        <button class="btn ghost icon" data-a="delName" data-i="${i}" aria-label="Sitz ${i + 1} entfernen">${ic('x')}</button></li>`).join('')}</ol>
      ${st.names.length < 9 ? `<button class="btn" data-a="addName">+ Person</button>` : ''}
    </section>
    <section>
      <div class="sec-head"><h2 class="h3">Chips</h2><span class="muted">Farbe, Wert, vorhandene Stück</span></div>
      ${st.chips.map((c, i) => `<div class="chiprow">
        <input type="color" data-f="chips.${i}.color" value="${esc(c.color)}" aria-label="Farbe ${esc(c.name)}">
        ${fld('Name', `chips.${i}.name`, c.name, 'maxlength="12"')}
        ${fld('Wert', `chips.${i}.value`, c.value, numO)}
        ${fld('Stück', `chips.${i}.count`, c.count, numO)}
        <button class="btn ghost icon" data-a="delChip" data-i="${i}" aria-label="${esc(c.name)} entfernen">${ic('x')}</button></div>`).join('')}
      <button class="btn" data-a="addChip">+ Chipfarbe</button>
    </section>
    ${T ? `<section>
      <h2 class="h3">Turnier</h2>
      <div class="row">${fld('Buy-in (CHF)', 'buyIn', st.buyIn, chfO)}${fld('Startstack (Punkte)', 'startStack', st.startStack, numO)}${fld('Levellänge (Min.)', 'levelMin', st.levelMin, numO)}</div>
      <p class="live" data-live="pool"></p>
      <div class="sec-head"><h2 class="h3">Blinds pro Level</h2><span class="muted">Small / Big Blind</span></div>
      <div class="levels">${st.levels.map((l, i) => `<div class="lvl"><span>${i + 1}<small data-live="lvt.${i}"></small></span>
        <input type="text" data-f="levels.${i}.sb" value="${esc(l.sb)}" ${numO} aria-label="Level ${i + 1} Small Blind">
        <input type="text" data-f="levels.${i}.bb" value="${esc(l.bb)}" ${numO} aria-label="Level ${i + 1} Big Blind">
        <button class="btn ghost icon" data-a="delLevel" data-i="${i}" aria-label="Level ${i + 1} entfernen">${ic('x')}</button></div>`).join('')}</div>
      <p class="live" data-live="dur"></p>
      <button class="btn" data-a="addLevel">+ Level</button>
      <label class="check"><input type="checkbox" data-f="rebuyOn" ${st.rebuyOn ? 'checked' : ''}> Rebuys erlauben</label>
      ${st.rebuyOn ? `<div class="row">${fld('bis und mit Level', 'rebuyUntil', st.rebuyUntil, numO)}${fld('pro Person höchstens', 'rebuyMax', st.rebuyMax, numO)}</div><p class="live" data-live="rebuy"></p>` : ''}
      <label class="check"><input type="checkbox" data-f="lateOn" ${st.lateOn ? 'checked' : ''}> Nachmelden erlauben (wer später kommt, zahlt den Buy-in und steigt mit dem Startstack ein)</label>
      ${st.lateOn ? `<div class="row">${fld('bis und mit Level', 'lateUntil', st.lateUntil, numO)}</div><p class="live" data-live="late"></p>` : ''}
      <div class="sec-head"><h2 class="h3">Preisgeld</h2>${st.payout ? '<button class="link" data-a="payoutAuto">Wieder automatisch</button>' : '<span class="muted">passt sich automatisch an</span>'}</div>
      <p class="muted">${st.payout ? 'Eigene Verteilung. «Wieder automatisch» passt sie an die Anzahl Personen an.' : 'Bis 3 Personen bekommt der Sieger alles, mit 4–5 gibt es 70/30, ab 6 50/30/20. Eine Zahl ändern = eigene Verteilung.'}</p>
      <div class="levels" id="payout">${payoutRows(payout)}</div>
      <p class="live" data-live="pzsum"></p>
      <button class="btn" data-a="addPay">+ bezahlter Platz</button>
    </section>` : `<section>
      <h2 class="h3">Cash Game</h2>
      <div class="row">${fld('Punkte', 'cPoints', st.cPoints, numO)}${fld('= CHF', 'cChf', st.cChf, chfO)}</div>
      <div class="row">${fld('Small Blind', 'sb', st.sb, numO)}${fld('Big Blind', 'bb', st.bb, numO)}</div>
      <p class="live" data-live="conv"></p>
      <div class="row">${fld('Einkauf mindestens (CHF)', 'minBuy', st.minBuy, chfO)}${fld('höchstens (CHF)', 'maxBuy', st.maxBuy, chfO)}</div>
      ${fld('Einkauf zu Beginn pro Person (CHF)', 'firstBuy', st.firstBuy, chfO)}
      <p class="live" data-live="first"></p>
    </section>`}
    <section id="derived">${derived()}</section>
  </div>`;
}
const payoutRows = (payout) => payout.map((p, i) => `<div class="payrow"><span>Platz ${i + 1}</span>
  <label class="pct"><input type="text" data-f="payout.${i}" value="${esc(p)}" ${numO} aria-label="Platz ${i + 1} in Prozent"><span>%</span><b data-live="pz.${i}"></b></label>
  <button class="btn ghost icon" data-a="delPay" data-i="${i}" aria-label="Platz ${i + 1} entfernen">${ic('x')}</button></div>`).join('');
// Live-Werte unter den Feldern: werden bei jeder Eingabe neu gerechnet, ohne die Felder neu zu zeichnen
const hm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
function live() {
  const st = S.setup; if (!st) return;
  const n = st.names.filter((x) => x.trim()).length;
  const set = (k, v) => app.querySelectorAll(`[data-live="${k}"]`).forEach((el) => { el.textContent = v; });
  set('count', `${n} ${n === 1 ? 'Person' : 'Personen'}`);
  if (st.mode === 'tournament') {
    const buy = rp(st.buyIn), lm = int(st.levelMin), payout = (st.payout || E.suggestPayout(n)).map(Number);
    const pool = n * buy, ok = buy > 0 && n > 0;
    set('pool', ok ? `Preistopf: ${n} × ${chf(buy)} = ${chf(pool)}${st.rebuyOn || st.lateOn ? ' – Rebuys und Nachmeldungen kommen dazu' : ''}` : '');
    st.levels.forEach((_, i) => set(`lvt.${i}`, lm > 0 ? `ab ${hm(i * lm)}` : ''));
    set('dur', lm > 0 ? `Alle ${st.levels.length} Levels dauern ${hm(st.levels.length * lm)} h, danach bleibt das letzte Level` : '');
    const ru = int(st.rebuyUntil), lu = int(st.lateUntil);
    set('rebuy', ru > 0 && lm > 0 ? `Rebuys bis ${hm(ru * lm)} h nach dem Start, je ${chf(buy || 0)} für ${pts(int(st.startStack) || 0)} Chips` : '');
    set('late', lu > 0 && lm > 0 ? `Nachmelden bis ${hm(lu * lm)} h nach dem Start, Preisgeld und Verteilung passen sich dann an` : '');
    const pz = ok ? E.prizes(pool, payout) : [];
    payout.forEach((_, i) => set(`pz.${i}`, ok && Number.isFinite(payout[i]) ? `= ${chf(pz[i])}` : ''));
    const sum = payout.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    set('pzsum', `Summe ${sum} %${sum === 100 ? '' : ' – muss 100 % ergeben'}${payout.length > n && n ? ` · ${payout.length} bezahlte Plätze bei nur ${n} Personen` : ''}`);
  } else {
    const ptsC = int(st.cPoints), r = rp(st.cChf), sb = int(st.sb), bb = int(st.bb), fb = rp(st.firstBuy);
    const toC = (x) => chf(Math.round((x * r) / ptsC));
    const ok = ptsC > 0 && r > 0;
    set('conv', ok ? `1 Punkt = ${toC(1)}${sb > 0 && bb > 0 ? ` · Blinds ${sb}/${bb} = ${toC(sb)} / ${toC(bb)}` : ''}` : '');
    set('first', ok && fb > 0 ? `= ${pts(Math.round((fb * ptsC) / r))} Punkte pro Person · zusammen ${chf(fb * n)} am Tisch` : '');
  }
}
function derived() {
  const { cfg, errs } = buildCfg(S.setup);
  const n = Math.max(cfg.names.length, 1);
  let out = '';
  if (!errs.length) {
    const amount = stackFor(cfg), s = E.suggestChips(cfg.chips, amount, n);
    const totalValue = cfg.chips.reduce((a, c) => a + c.value * c.count, 0);
    out += `<h2 class="h3">Chips pro Person (${pts(amount)})</h2><div class="dist">${s.counts.map((k, i) => k ? `<span><i class="dot" style="background:${esc(cfg.chips[i].color)}"></i>${k} × ${esc(cfg.chips[i].name)} (${cfg.chips[i].value})</span>` : '').join('')}</div>`;
    if (totalValue < amount * n) out += `<div class="notice bad">${ic('alert')}<div class="grow">Die Chips reichen nicht: ${n} × ${pts(amount)} = ${pts(amount * n)}, vorhanden sind nur ${pts(totalValue)}.</div></div>`;
    else if (s.rest) out += `<div class="notice bad">${ic('alert')}<div class="grow">Mit diesen Chips lassen sich ${pts(amount)} nicht für alle ${n} genau legen (es fehlen ${pts(s.rest)} pro Person). Mehr kleine Chips erfassen oder den Betrag ändern.</div></div>`;
  }
  out += errs.length ? `<div class="notice bad">${ic('alert')}<div class="grow">${errs.map((e) => `<span>${esc(e)}</span>`).join('')}</div></div>` : '';
  out += `<div class="sticky"><button class="btn primary big wide" data-a="start" ${errs.length ? 'disabled' : ''}>Dealer auslosen und starten</button></div>`;
  return out;
}

// ---------- Tisch ----------
const pName = (g, id) => g.players.find((p) => p.id === id)?.name || '';
const money = (g, points) => (g.mode === 'cash' ? chf(E.toChf(g, points)) : '');

function viewTable() {
  const g = S.game, h = g.hand, active = h && !h.done, chk = E.chipCheck(g);
  topAct.innerHTML = `<button class="btn ghost icon" data-a="undo" ${S.undo.length ? '' : 'disabled'} aria-label="Rückgängig${S.undo.length ? ': ' + esc(S.undo.at(-1).label) : ''}">${ic('undo')}</button>
    <button class="btn ghost icon" data-a="menu" aria-label="Menü">${ic('menu')}</button>`;
  let html = '';
  if (S.saveFail) html += `<div class="notice bad">${ic('alert')}<div class="grow">Speichern im Browser klappt nicht (privates Fenster oder Speicher voll). Die Seite nicht neu laden, sonst ist der Stand weg.</div></div>`;
  if (chk.diff) html += `<div class="notice bad" role="alert">${ic('alert')}<div class="grow"><b>Chips stimmen nicht</b>
    <span>Stacks + Pot = ${pts(chk.actual)}, ausgegeben wurden ${pts(chk.expected)} (${chk.diff > 0 ? '+' : ''}${pts(chk.diff)}).</span>
    <div class="minis"><button class="btn" data-a="count">Chips zählen</button><button class="btn ghost" data-a="acceptDiff">Abweichung übernehmen</button></div></div></div>`;
  if (S.err) html += `<div class="notice bad" role="alert">${ic('alert')}<div class="grow">${esc(S.err)}</div><button class="btn ghost icon" data-a="clearErr" aria-label="Meldung schliessen">${ic('x')}</button></div>`;
  if (g.mode === 'tournament') html += timerHtml(g);
  if (active) {
    const ps = E.pots(h), side = ps.length > 1 && Object.keys(h.allin).length ? ps.map((p, i) => `${E.potLabel(ps, i).replace(/^den /, '')} ${pts(p.amount)}`).join(' · ') : '';
    const STREET = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' };
    html += `<div class="felt"><span class="street">Hand ${h.no} · ${STREET[h.street]} · Blinds ${h.blinds.sb}/${h.blinds.bb}</span><span class="pot num">${pts(E.potTotal(h))}</span><span class="side">${side ? esc(side) : 'Pot inkl. Einsätze vor den Spielern'}</span></div>`;
  }
  html += `<div class="hint" aria-live="polite">${esc(g.hint || 'Los geht’s.')}</div>`;
  html += seatsHtml(g);
  html += `<div class="actions">${actionsHtml(g)}</div>`;
  return `<h1 class="sr-only">Pokertisch</h1><div class="table">${html}</div>`;
}

function timerHtml(g) {
  const lv = E.blindsNow(g), nx = g.t.levels[g.timer.level + 1], cu = E.colorUp(g);
  const paused = g.timer.since == null;
  return `<div class="timer ${paused ? 'paused' : ''}">
    <span class="lv"><b>Level ${g.timer.level + 1} · ${lv.sb}/${lv.bb}</b><span class="muted">${nx ? `danach ${nx.sb}/${nx.bb}` : 'letztes Level'}${paused ? ' · pausiert' : ''}</span>
      <button class="link pool" data-a="players">Preistopf ${chf(E.prizePool(g))} · ${g.players.filter((p) => p.status !== 'out').length} von ${g.players.length} im Spiel</button></span>
    <span class="clock num" id="clock">${clock(E.timeLeft(g, Date.now()))}</span>
    <button class="btn icon" data-a="timer" aria-label="${paused ? 'Timer starten' : 'Timer pausieren'}">${ic(paused ? 'play' : 'pause')}</button>
  </div>${cu.length && g.cuSeen !== g.timer.level ? `<div class="notice">${ic('alert')}<div class="grow"><span><b>Color-up lohnt sich:</b> ${cu.map((c) => esc(c.name) + ' (' + c.value + ')').join(', ')} braucht es für diese Blinds nicht mehr. Zwischen zwei Händen gegen grössere Chips tauschen, danach «Chips zählen».</span></div><button class="btn ghost icon" data-a="cuSeen" aria-label="Hinweis ausblenden">${ic('x')}</button></div>` : ''}`;
}
const clock = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function seatsHtml(g) {
  const h = g.hand, active = h && !h.done;
  return `<ul class="seats">${g.players.map((p) => {
    const inH = active && h.ids.includes(p.id);
    let st = '', cls = '';
    if (inH) {
      if (h.folded[p.id]) { st = 'Fold'; cls = 'fold'; }
      else if (h.allin[p.id]) st = `All-in${h.bets[p.id] ? ' · setzt ' + pts(h.bets[p.id]) : ''}`;
      else if (h.bets[p.id]) st = `setzt ${pts(h.bets[p.id])}`;
      if (h.toAct === p.id) { cls = 'now'; st = st ? st + ' · ist dran' : 'ist dran'; }
    } else if (active) st = { paused: 'Pause', left: 'ausgestiegen', out: `ausgeschieden · Platz ${p.place}` }[p.status] || 'nicht dabei';
    else st = { paused: 'Pause', left: 'ausgestiegen', out: `ausgeschieden · Platz ${p.place}`, bust: 'keine Chips' }[p.status] || '';
    if (p.status === 'out' || p.status === 'left') cls = 'out';
    const b = [];
    if ((active ? h.dealer : g.dealer) === p.id) b.push('<span class="bd d" title="Dealer">D</span>');
    if (active && h.sb === p.id) b.push('<span class="bd sb" title="Small Blind">SB</span>');
    if (active && h.bb === p.id) b.push('<span class="bd bb" title="Big Blind">BB</span>');
    return `<li class="seat ${cls}"><span class="badges">${b.join('')}</span>
      <span><span class="nm">${esc(p.name)}</span>${st ? `<span class="st">${esc(st)}</span>` : ''}</span>
      <span class="stack num">${pts(p.stack)}${S.showChf && g.mode === 'cash' ? `<small>${money(g, p.stack)}</small>` : ''}</span></li>`;
  }).join('')}</ul>`;
}

function actionsHtml(g) {
  const h = g.hand;
  if (h && !h.done && h.street === 'showdown') {
    const rows = h.pots.map((pt, i) => {
      const lbl = E.potLabel(h.pots, i).replace(/^den /, '');
      if (pt.eligible.length === 1) return `<p>${esc(cap(lbl))} ${pts(pt.amount)} geht an ${esc(pName(g, pt.eligible[0]))}.</p>`;
      const sel = S.sel[i] || [];
      return `<div class="potpick"><b>${esc(cap(lbl))} ${pts(pt.amount)} – wer gewinnt? <span class="muted">(bei Gleichstand mehrere)</span></b>
        <div class="picks">${pt.eligible.map((id) => `<button class="pick" data-a="pick" data-p="${i}" data-id="${id}" aria-pressed="${sel.includes(id)}">${esc(pName(g, id))}</button>`).join('')}</div></div>`;
    }).join('');
    const ok = h.pots.every((pt, i) => pt.eligible.length === 1 || (S.sel[i] || []).length);
    return `<div class="who"><b>Showdown</b><span>Karten zeigen</span></div>${rows}
      <button class="btn primary big wide" data-a="award" ${ok ? '' : 'disabled'}>Pot${h.pots.length > 1 ? 's' : ''} verteilen</button>`;
  }
  const L = E.legal(g);
  if (L) {
    const p = g.players.find((x) => x.id === L.id);
    const allinIsCall = L.call == null && L.toCall > 0;
    const btns = [];
    if (L.fold) btns.push(`<button class="btn" data-a="act" data-t="fold">Fold</button>`);
    if (L.check) btns.push(`<button class="btn primary" data-a="act" data-t="check">Check</button>`);
    if (L.call != null) btns.push(`<button class="btn primary" data-a="act" data-t="call">Call ${pts(L.call)}</button>`);
    if (L.bet) btns.push(`<button class="btn" data-a="bet" data-t="bet">Bet …</button>`);
    if (L.raise) btns.push(`<button class="btn" data-a="bet" data-t="raise">Raise …</button>`);
    if (L.allin != null) btns.push(`<button class="btn warn" data-a="act" data-t="allin">All-in ${pts(L.allin - g.hand.bets[L.id])}${allinIsCall ? '<small>= Call</small>' : ''}</button>`);
    return `<div class="who"><b><em>${esc(p.name)}</em> ist dran</b><span>${L.toCall ? `offen ${pts(L.toCall)}` : 'nichts offen'}<br>Stack ${pts(p.stack)}</span></div>
      <div class="abtns">${btns.join('')}</div>`;
  }
  // Zwischen den Händen
  const busts = E.pendingBusts(g);
  if (busts.length) {
    return busts.map((p) => `<div class="between"><b>${esc(p.name)} hat keine Chips mehr.</b>
      <div class="minis"><button class="btn primary" data-a="rebuy" data-id="${p.id}">Rebuy ${chf(g.t.buyIn)}</button><button class="btn" data-a="elim" data-id="${p.id}">Ausscheiden</button></div></div>`).join('');
  }
  const leftT = g.mode === 'tournament' && g.players.filter((p) => p.status !== 'out').length === 1;
  if (leftT) return `<div class="who"><b>Turnier fertig</b></div><button class="btn primary big wide" data-a="end">Zur Abrechnung</button>`;
  const ready = g.players.filter((p) => p.status === 'active' && p.stack > 0).length;
  const bl = E.blindsNow(g);
  return `<div class="between">
    ${ready >= 2 ? `<button class="btn primary big wide" data-a="startHand">Hand ${g.handNo + 1} starten<small>Blinds ${bl.sb}/${bl.bb}</small></button>`
      : `<p>Es braucht mindestens 2 Personen mit Chips. ${g.mode === 'cash' ? 'Unter «Spieler» nachkaufen oder jemanden zurückholen.' : ''}</p>`}
    <div class="minis">
      <button class="btn" data-a="players">${g.mode === 'cash' ? 'Spieler · Nachkauf' : E.canLateJoin(g) ? 'Stacks · Nachmelden' : 'Stacks · Preisgeld'}</button>
      <button class="btn" data-a="count">Chips zählen</button>
      <button class="btn ghost" data-a="end">Spiel beenden</button>
    </div></div>`;
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// ---------- Dialoge ----------
function openDlg(html) { dlg.innerHTML = `<div class="dlg">${html}</div>`; if (!dlg.open) dlg.showModal(); }
const head = (t) => `<div class="dlg-head"><h2>${t}</h2><button class="btn ghost icon" data-a="close" aria-label="Schliessen">${ic('x')}</button></div>`;

function betDlg(type, to, msg = '') {
  const g = S.game, h = g.hand, L = E.legal(g); if (!L) return;
  const lim = type === 'bet' ? L.bet : L.raise, p = g.players.find((x) => x.id === L.id);
  S.bet = { type, to: to ?? lim.min };
  const pot = E.potTotal(h), u = E.unitOf(g);
  const round = (x) => Math.min(lim.max, Math.max(lim.min, Math.round(x / u) * u));
  const potTo = (f) => round(h.cur + (pot + L.toCall) * f);
  const quick = [['Min', lim.min], ['½ Pot', potTo(0.5)], ['Pot', potTo(1)], ['All-in', lim.max]];
  openDlg(`${head(`${esc(p.name)}: ${type === 'bet' ? 'Bet' : 'Raise auf'}`)}
    <p class="muted">${type === 'bet' ? 'Betrag' : 'Gesamteinsatz in dieser Runde'}: mindestens ${pts(lim.min)}, höchstens ${pts(lim.max)} (All-in).${h.bets[L.id] ? ` Schon gesetzt: ${pts(h.bets[L.id])}.` : ''}</p>
    <div class="quick">${quick.map(([l, v]) => `<button class="btn" data-a="betSet" data-v="${v}">${l}<small>${pts(v)}</small></button>`).join('')}</div>
    <div class="amount"><button class="btn" data-a="betStep" data-v="-1" aria-label="weniger">−</button>
      <input type="text" id="betIn" inputmode="numeric" value="${S.bet.to}" aria-label="Betrag"><button class="btn" data-a="betStep" data-v="1" aria-label="mehr">+</button></div>
    ${msg ? `<p class="err" role="alert">${esc(msg)}</p>` : ''}
    <button class="btn primary big wide" data-a="betGo">${type === 'bet' ? 'Bet' : 'Raise auf'} <span id="betLbl">${pts(S.bet.to)}</span></button>`);
}

function countDlg(id, mode = 'colors', msg = '') {
  const g = S.game, list = g.players.filter((p) => p.status !== 'out' && p.status !== 'left');
  id = id || (g.hand && !g.hand.done && g.hand.toAct) || list[0]?.id;
  S.count = { id, mode };
  const p = g.players.find((x) => x.id === id);
  openDlg(`${head('Chips zählen')}
    <label>Person<select id="cntWho">${list.map((x) => `<option value="${x.id}" ${x.id === id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <p class="muted">Nur die Chips vor ${esc(p.name)} zählen, nicht was schon in der Mitte oder als Einsatz vorne liegt.</p>
    <div class="minis"><button class="btn ${mode === 'colors' ? 'primary' : ''}" data-a="cntMode" data-v="colors">Pro Farbe</button><button class="btn ${mode === 'total' ? 'primary' : ''}" data-a="cntMode" data-v="total">Gesamtbetrag</button></div>
    ${mode === 'colors' ? g.chips.map((c, i) => `<div class="row"><label><span class="dist"><span><i class="dot" style="background:${esc(c.color)}"></i>${esc(c.name)} (${c.value})</span></span><input type="text" class="cnt" data-i="${i}" inputmode="numeric" placeholder="Stück"></label></div>`).join('')
      : `<label>Gezählter Betrag<input type="text" id="cntTotal" inputmode="numeric"></label>`}
    <div id="cntOut" aria-live="polite"></div>
    <label>Vermerk (optional)<input type="text" id="cntNote" maxlength="60" placeholder="z. B. falsch ausgezahlt"></label>
    ${msg ? `<p class="err" role="alert">${esc(msg)}</p>` : ''}
    <button class="btn primary big wide" data-a="cntFix" id="cntFix" disabled>Stand korrigieren</button>`);
  countUpdate();
}
function countedValue() {
  const g = S.game;
  if (S.count.mode === 'total') { const v = $('#cntTotal')?.value ?? ''; return v.trim() === '' ? null : int(v); }
  const ins = [...dlg.querySelectorAll('.cnt')];
  if (ins.every((x) => x.value.trim() === '')) return null;
  let sum = 0;
  for (const x of ins) { if (x.value.trim() === '') continue; const k = int(x.value); if (Number.isNaN(k)) return NaN; sum += k * g.chips[+x.dataset.i].value; }
  return sum;
}
function countUpdate() {
  const g = S.game, p = g.players.find((x) => x.id === S.count.id), v = countedValue(), out = $('#cntOut'), btn = $('#cntFix');
  if (v == null) { out.innerHTML = `<p>Laut App: <b>${pts(p.stack)}</b></p>`; btn.disabled = true; return; }
  if (Number.isNaN(v)) { out.innerHTML = `<p class="err">Bitte nur ganze Zahlen eingeben.</p>`; btn.disabled = true; return; }
  const d = v - p.stack;
  out.innerHTML = d ? `<div class="notice bad">${ic('alert')}<div class="grow">Laut App ${pts(p.stack)}, gezählt ${pts(v)}: Abweichung <b>${d > 0 ? '+' : ''}${pts(d)}</b>.</div></div>`
    : `<div class="notice">Stimmt: ${pts(v)}</div>`;
  btn.disabled = !d;
  btn.textContent = d ? `Stand auf ${pts(v)} korrigieren` : 'Stand korrigieren';
}

function playersDlg(msg = '') {
  const g = S.game, between = !g.hand || g.hand.done, cash = g.mode === 'cash';
  const seat = new Map(g.players.map((p, i) => [p.id, i]));
  const rows = [...g.players].sort(S.sort === 'stack' ? (a, b) => b.stack - a.stack : S.sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'de-CH') : (a, b) => seat.get(a.id) - seat.get(b.id));
  const statusTxt = (p) => ({ active: 'spielt', paused: 'Pause', left: 'ausgestiegen', out: `Platz ${p.place}`, bust: 'keine Chips' }[p.status]);
  const sortBtn = (k, l) => `<button data-a="sort" data-v="${k}" aria-pressed="${S.sort === k}">${l}${S.sort === k ? ' ▾&#xFE0E;' : ''}</button>`;
  let html = `${head(cash ? 'Spieler und Stacks' : 'Stacks und Preisgeld')}
    <table class="tbl"><thead><tr><th>${sortBtn('seat', 'Sitz')}</th><th>${sortBtn('name', 'Name')}</th><th class="r">${sortBtn('stack', 'Stack')}</th>${cash && S.showChf ? '<th class="r">CHF</th>' : ''}</tr></thead>
    <tbody>${rows.map((p) => `<tr><td>${seat.get(p.id) + 1}</td><td>${esc(p.name)}<br><span class="muted">${statusTxt(p)}${p.rebuys ? ` · ${p.rebuys} Rebuy` : ''}</span></td><td class="r">${pts(p.stack)}</td>${cash && S.showChf ? `<td class="r">${chf(E.toChf(g, p.stack))}</td>` : ''}</tr>`).join('')}</tbody></table>`;
  if (!cash) {
    const pool = E.prizePool(g), pc = E.payoutOf(g), pz = E.prizes(pool, pc), rb = g.players.reduce((a, p) => a + p.rebuys, 0);
    html += `<h3>Preisgeld jetzt</h3>
      <p class="muted">${g.players.length} Personen${rb ? ` + ${rb} Rebuy${rb > 1 ? 's' : ''}` : ''} = ${chf(pool)}${g.t.payoutAuto ? ' · Verteilung passt sich der Anzahl Personen an' : ''}</p>
      <table class="tbl"><tbody>${pc.map((x, i) => `<tr><td>Platz ${i + 1}</td><td class="r">${x} %</td><td class="r"><b>${chf(pz[i])}</b></td></tr>`).join('')}</tbody></table>`;
    if (E.canLateJoin(g)) {
      html += between ? `<h3>Nachmelden</h3><p class="muted">Zahlt ${chf(g.t.buyIn)} und bekommt ${pts(g.t.startStack)} Chips. Erlaubt bis und mit Level ${g.t.late.untilLevel}.</p>
        <label>Name<input type="text" id="newName" maxlength="20" autocomplete="off"></label>
        <label>Sitzt links von<select id="newAfter">${g.players.filter((p) => p.status !== 'out').map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <button class="btn primary" data-a="addPlayer">Nachmelden</button>` : `<p class="muted">Nachmelden geht zwischen den Händen.</p>`;
    }
  }
  if (cash) {
    html += `<label class="check"><input type="checkbox" id="showChf" ${S.showChf ? 'checked' : ''}> Stacks auch in CHF zeigen</label>`;
    if (!between) html += `<p class="muted">Nachkaufen, Pausen und Aussteigen gehen zwischen den Händen.</p>`;
    else {
      html += `<div class="pmgr">${g.players.map((p) => `<div class="pm"><b>${esc(p.name)} <span class="muted">· ${statusTxt(p)} · eingekauft ${chf(p.paid)}</span></b>
        <div class="row"><label>Nachkaufen (CHF)<input type="text" id="buy-${p.id}" inputmode="decimal" placeholder="${esc(String(g.c.minBuy / 100))}"></label><button class="btn primary" data-a="buy" data-id="${p.id}">Kaufen</button></div>
        <div class="minis">${p.status === 'active' ? `<button class="btn" data-a="pause" data-id="${p.id}">Pausieren</button>` : p.status === 'paused' && p.stack > 0 ? `<button class="btn" data-a="resume" data-id="${p.id}">Spielt wieder</button>` : ''}
        ${p.status !== 'left' && p.stack > 0 ? `<button class="btn ghost" data-a="cashout" data-id="${p.id}">Aussteigen · ${chf(E.toChf(g, p.stack))}</button>` : ''}</div></div>`).join('')}</div>
        <h3>Neue Person</h3>
        <div class="row"><label>Name<input type="text" id="newName" maxlength="20" autocomplete="off"></label><label>Einkauf (CHF)<input type="text" id="newBuy" inputmode="decimal" value="${esc(String(g.c.firstBuy / 100))}"></label></div>
        <label>Sitzt links von<select id="newAfter">${g.players.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <button class="btn" data-a="addPlayer">Dazusetzen</button>`;
    }
  }
  if (msg) html += `<p class="err" role="alert">${esc(msg)}</p>`;
  openDlg(html);
}

function historyDlg() {
  const g = S.game;
  openDlg(`${head('Hand-Historie')}
    ${g.hands.length ? `<div class="hist">${g.hands.map((x) => `<details><summary>Hand ${x.no} · Pot ${pts(x.pot)} · ${esc(x.result)}</summary>
      <p class="muted">Dealer ${esc(x.dealer)} · Blinds ${esc(x.blinds)}</p><ol>${x.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol></details>`).join('')}</div>` : '<p class="muted">Noch keine Hand gespielt. Nach der ersten Hand steht sie hier.</p>'}
    ${g.log.length ? `<h3>Vermerke</h3><ul>${g.log.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}`);
}

function menuDlg(confirmNew = false) {
  openDlg(`${head('Menü')}<div class="menu">
    <button class="btn" data-a="players">${S.game.mode === 'cash' ? 'Spieler, Stacks, Nachkauf' : 'Stacks und Preisgeld'}</button>
    <button class="btn" data-a="count">Chips zählen</button>
    <button class="btn" data-a="history">Hand-Historie</button>
    <button class="btn" data-a="end">Spiel beenden und abrechnen</button>
    <button class="btn ghost" data-a="newGame">${confirmNew ? 'Wirklich verwerfen? Nochmals tippen' : 'Neues Spiel (aktuelles verwerfen)'}</button>
  </div>`);
  S.confirmNew = confirmNew;
}

// ---------- Abrechnung ----------
function viewEnd() {
  const g = S.game, r = E.results(g), pay = E.settle(r.rows), T = g.mode === 'tournament';
  topAct.innerHTML = '';
  const sign = (x) => `<span class="${x > 0 ? 'pos' : x < 0 ? 'neg' : ''}">${x > 0 ? '+' : ''}${chf(x)}</span>`;
  const date = new Date().toLocaleDateString('de-CH');
  const text = [`Poker ${date} – ${T ? 'Turnier' : 'Cash Game'}`,
    ...r.rows.map((x) => `${T ? x.place + '. ' : ''}${x.name}: ${x.net > 0 ? '+' : ''}${chf(x.net)}`),
    '', pay.length ? 'Zahlungen (z. B. TWINT):' : 'Keine Zahlungen nötig.',
    ...pay.map((p) => `${p.from} → ${p.to}: ${chf(p.amount)}`)].join('\n');
  return `<div class="endpage">
    <h1 class="h2">Abrechnung ${T ? 'Turnier' : 'Cash Game'}</h1>
    ${r.sum !== 0 ? `<div class="notice bad" role="alert">${ic('alert')}<div class="grow"><b>Die Summe ergibt ${chf(r.sum)} statt 0.</b><span>Irgendwo stimmen Chips oder Einkäufe nicht. Zurück zum Spiel und «Chips zählen».</span></div></div>` : ''}
    <table class="tbl"><thead><tr>${T ? '<th>Platz</th>' : ''}<th>Name</th><th class="r">${T ? 'Einsatz' : 'Eingekauft'}</th><th class="r">${T ? 'Preisgeld' : 'Ausbezahlt'}</th><th class="r">+/−</th></tr></thead>
    <tbody>${r.rows.map((x) => `<tr>${T ? `<td>${x.place}.</td>` : ''}<td>${esc(x.name)}${x.rebuys ? `<br><span class="muted">${x.rebuys} Rebuy</span>` : ''}</td><td class="r">${chf(x.paid)}</td><td class="r">${chf(x.out)}</td><td class="r">${sign(x.net)}</td></tr>`).join('')}</tbody></table>
    ${T ? `<p>Total Einsätze inkl. Rebuys: <b>${chf(r.pool)}</b></p>` : ''}
    <section class="endsec"><h2 class="h3">Wer zahlt wem</h2>${pay.length ? `<ul>${pay.map((p) => `<li><b>${esc(p.from)}</b> → <b>${esc(p.to)}</b>: ${chf(p.amount)}</li>`).join('')}</ul>` : '<p>Keine Zahlungen nötig.</p>'}
    <label>Text für den Gruppenchat<textarea id="endText" readonly>${esc(text)}</textarea></label>
    <button class="btn primary wide" data-a="copy">${ic('copy')} Text kopieren</button><span id="copyOk" class="muted" aria-live="polite"></span></section>
    <div class="minis"><button class="btn" data-a="reopen">Zurück zum Spiel</button><button class="btn ghost" data-a="newGame2">Neues Spiel</button></div>
  </div>`;
}

// ---------- Render ----------
function render() {
  const v = S.view === 'table' && S.game?.ended ? 'end' : S.view;
  app.innerHTML = v === 'setup' ? viewSetup() : v === 'table' ? viewTable() : v === 'end' ? viewEnd() : viewHome();
  if (v === 'setup') live();
}

// ---------- Aktionen ----------
const A = {
  mode: (el) => { S.setup = newSetup(el.dataset.v, S.setup); S.view = 'setup'; S.loadFail = false; save(); render(); scrollTo(0, 0); },
  home: () => { S.view = 'home'; render(); },
  addName: () => { S.setup.names.push(''); save(); render(); app.querySelector(`[data-f="names.${S.setup.names.length - 1}"]`)?.focus(); },
  delName: (el) => { S.setup.names.splice(+el.dataset.i, 1); save(); render(); },
  addChip: () => { S.setup.chips.push({ name: 'Neu', color: '#c9c4d3', value: '', count: '' }); save(); render(); },
  delChip: (el) => { S.setup.chips.splice(+el.dataset.i, 1); save(); render(); },
  addLevel: () => { const l = S.setup.levels.at(-1) || { sb: '10', bb: '20' }; S.setup.levels.push({ sb: String(int(l.sb) * 2 || ''), bb: String(int(l.bb) * 2 || '') }); save(); render(); },
  delLevel: (el) => { S.setup.levels.splice(+el.dataset.i, 1); save(); render(); },
  payoutAuto: () => { S.setup.payout = null; save(); render(); },
  addPay: () => { S.setup.payout = [...(S.setup.payout || E.suggestPayout(S.setup.names.filter((n) => n.trim()).length)), 0]; save(); render(); },
  delPay: (el) => { const p = [...(S.setup.payout || E.suggestPayout(S.setup.names.filter((n) => n.trim()).length))]; p.splice(+el.dataset.i, 1); S.setup.payout = p; save(); render(); },
  start: () => {
    const { cfg, errs } = buildCfg(S.setup); if (errs.length) return;
    S.game = E.newGame(cfg); S.undo = []; S.view = 'table'; S.err = ''; S.sel = {};
    save(); render(); scrollTo(0, 0); wake();
  },
  undo, clearErr: () => { S.err = ''; render(); },
  menu: () => menuDlg(),
  close: () => dlg.close(),
  timer: () => { E.toggleTimer(S.game, Date.now()); save(); render(); },
  cuSeen: () => { S.game.cuSeen = S.game.timer.level; save(); render(); },
  startHand: () => {
    if (run(`Hand ${S.game.handNo + 1} gestartet`, (g) => E.startHand(g)) && S.game.timer && S.game.timer.since == null && S.game.handNo === 1) {
      E.toggleTimer(S.game, Date.now()); save(); render(); // Timer startet mit der ersten Hand
    }
    S.sel = {}; wake();
  },
  act: (el) => { const g = S.game, n = pName(g, g.hand.toAct); run(`${n}: ${el.textContent.trim()}`, (x) => E.act(x, { type: el.dataset.t })); },
  bet: (el) => betDlg(el.dataset.t),
  betSet: (el) => betDlg(S.bet.type, +el.dataset.v),
  betStep: (el) => { const v = int($('#betIn').value) || 0; betDlg(S.bet.type, Math.max(0, v + +el.dataset.v * S.game.hand.blinds.bb)); },
  betGo: () => {
    const to = int($('#betIn').value), { type } = S.bet, n = pName(S.game, S.game.hand.toAct);
    const test = structuredClone(S.game);
    try { E.act(test, { type, to }); } catch (e) { return betDlg(type, Number.isNaN(to) ? undefined : to, e.message); }
    dlg.close(); run(`${n}: ${type === 'bet' ? 'Bet' : 'Raise auf'} ${to}`, (g) => E.act(g, { type, to }));
  },
  pick: (el) => { const i = +el.dataset.p, id = el.dataset.id, s = S.sel[i] || []; S.sel[i] = s.includes(id) ? s.filter((x) => x !== id) : [...s, id]; render(); },
  award: () => { const w = S.game.hand.pots.map((_, i) => S.sel[i] || []); if (run('Pot verteilt', (g) => E.showdown(g, w))) S.sel = {}; },
  rebuy: (el) => run(`Rebuy ${pName(S.game, el.dataset.id)}`, (g) => E.rebuy(g, el.dataset.id)),
  elim: (el) => run(`${pName(S.game, el.dataset.id)} ausgeschieden`, (g) => E.eliminate(g, el.dataset.id)),
  count: () => countDlg(),
  cntMode: (el) => countDlg(S.count.id, el.dataset.v),
  cntFix: () => {
    const v = countedValue(), id = S.count.id, note = $('#cntNote').value.trim();
    dlg.close(); run(`Korrektur ${pName(S.game, id)}`, (g) => E.correctStack(g, id, v, note));
  },
  acceptDiff: () => run('Abweichung übernommen', (g) => E.acceptDiff(g)),
  players: () => playersDlg(),
  history: () => historyDlg(),
  sort: (el) => { S.sort = el.dataset.v; playersDlg(); },
  buy: (el) => dlgRun(`Nachkauf ${pName(S.game, el.dataset.id)}`, (g) => E.buyIn(g, el.dataset.id, rp($(`#buy-${el.dataset.id}`).value))),
  pause: (el) => dlgRun(`${pName(S.game, el.dataset.id)} pausiert`, (g) => E.setPaused(g, el.dataset.id, true)),
  resume: (el) => dlgRun(`${pName(S.game, el.dataset.id)} spielt wieder`, (g) => E.setPaused(g, el.dataset.id, false)),
  cashout: (el) => dlgRun(`${pName(S.game, el.dataset.id)} ausgestiegen`, (g) => E.cashOut(g, el.dataset.id)),
  addPlayer: () => dlgRun('Person dazugesetzt', (g) => E.addPlayer(g, $('#newName').value, $('#newAfter').value, rp($('#newBuy')?.value ?? ''))),
  end: () => {
    if (dlg.open) dlg.close();
    run('Spiel beendet', (g) => { if (g.hand && !g.hand.done) throw new Error('Zuerst die laufende Hand fertig spielen (oder rückgängig machen).'); g.ended = true; });
    scrollTo(0, 0);
  },
  reopen: () => run('Spiel wieder geöffnet', (g) => { g.ended = false; }),
  newGame: () => {
    if (!S.confirmNew) return menuDlg(true);
    dlg.close(); A.newGame2();
  },
  newGame2: () => { S.game = null; S.undo = []; S.view = 'home'; S.confirmNew = false; save(); render(); scrollTo(0, 0); },
  copy: async () => {
    const ta = $('#endText');
    try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand('copy'); }
    $('#copyOk').textContent = 'Kopiert – jetzt im Gruppenchat einfügen.';
  },
};
// Aktion aus einem Dialog: Fehler im Dialog zeigen, sonst Dialog neu zeichnen
function dlgRun(label, fn) {
  const before = S.game;
  run(label, fn);
  const msg = S.game === before ? S.err : '';
  S.err = ''; render();
  playersDlg(msg);
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]'); if (!el || el.disabled) return;
  unlockAudio();
  A[el.dataset.a]?.(el);
});
// Setup-Eingaben direkt in den Zustand schreiben (ohne alles neu zu zeichnen, damit der Fokus bleibt)
app.addEventListener('input', (e) => {
  const f = e.target.dataset.f; if (!f || !S.setup) return;
  const path = f.split('.'), last = path.pop();
  let o = S.setup;
  if (path[0] === 'payout' || last === 'payout') S.setup.payout = S.setup.payout || E.suggestPayout(S.setup.names.filter((n) => n.trim()).length).map(String);
  for (const k of path) o = o[k];
  o[last] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  save();
  if (e.target.type === 'checkbox') return render();
  $('#derived').innerHTML = derived();
  // Preisgeld-Vorschlag folgt der Anzahl Personen, solange niemand ihn von Hand geändert hat
  if (path[0] === 'names' && !S.setup.payout && $('#payout')) $('#payout').innerHTML = payoutRows(E.suggestPayout(S.setup.names.filter((n) => n.trim()).length));
  // Erste eigene Änderung am Preisgeld: Kopfzeile auf «eigene Verteilung» umstellen (ohne das Feld zu verlieren)
  if (path[0] === 'payout' && !$('[data-a=payoutAuto]')) { const pos = e.target.selectionStart; render(); const el = app.querySelector(`[data-f="${f}"]`); el?.focus(); el?.setSelectionRange(pos, pos); }
  live();
});
dlg.addEventListener('input', (e) => {
  if (e.target.id === 'betIn') { const v = int(e.target.value); $('#betLbl').textContent = Number.isNaN(v) ? '…' : pts(v); }
  if (e.target.classList.contains('cnt') || e.target.id === 'cntTotal') countUpdate();
});
dlg.addEventListener('change', (e) => {
  if (e.target.id === 'cntWho') countDlg(e.target.value, S.count.mode);
  if (e.target.id === 'showChf') { S.showChf = e.target.checked; save(); render(); playersDlg(); }
});
dlg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'betIn') A.betGo(); });

// Sitzordnung per Ziehen (Finger/Maus) oder Pfeiltasten am Griff
let drag = null;
app.addEventListener('pointerdown', (e) => {
  const gr = e.target.closest('.grip'); if (!gr) return;
  e.preventDefault(); gr.setPointerCapture(e.pointerId);
  drag = gr.closest('li'); drag.classList.add('drag');
});
app.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const list = drag.parentElement, items = [...list.children];
  const over = items.find((li) => { const r = li.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom; });
  if (!over || over === drag) return;
  const after = items.indexOf(over) > items.indexOf(drag);
  list.insertBefore(drag, after ? over.nextSibling : over);
});
const dragEnd = () => {
  if (!drag) return;
  const order = [...drag.parentElement.children].map((li) => +li.dataset.i);
  S.setup.names = order.map((i) => S.setup.names[i]);
  drag = null; save(); render();
};
app.addEventListener('pointerup', dragEnd); app.addEventListener('pointercancel', dragEnd);
app.addEventListener('keydown', (e) => {
  const gr = e.target.closest('.grip'); if (!gr || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const i = +gr.dataset.i, j = i + (e.key === 'ArrowUp' ? -1 : 1), n = S.setup.names;
  if (j < 0 || j >= n.length) return;
  [n[i], n[j]] = [n[j], n[i]]; save(); render();
  app.querySelector(`.grip[data-i="${j}"]`)?.focus();
});

// ---------- Blind-Timer, Ton, Bildschirm wach halten ----------
let audio = null;
function unlockAudio() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch { /* ohne Ton */ } }
function beep() {
  try { navigator.vibrate?.([300, 150, 300]); } catch { /* ohne Vibration */ }
  if (!audio) return;
  [0, 0.35, 0.7].forEach((t) => {
    const o = audio.createOscillator(), gn = audio.createGain();
    o.frequency.value = 880; gn.gain.setValueAtTime(0.25, audio.currentTime + t); gn.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + t + 0.3);
    o.connect(gn).connect(audio.destination); o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.3);
  });
}
setInterval(() => {
  const g = S.game; if (!g || g.mode !== 'tournament' || g.ended) return;
  if (E.tick(g, Date.now())) {
    const b = E.blindsNow(g);
    g.hint = `Neues Level ${g.timer.level + 1}: Blinds ${b.sb}/${b.bb} – gilt ab der nächsten Hand.`;
    save(); beep(); if (S.view === 'table') render();
  } else { const c = $('#clock'); if (c) c.textContent = clock(E.timeLeft(g, Date.now())); }
}, 1000);
let lock = null;
async function wake() { try { if (S.game && !lock && document.visibilityState === 'visible') { lock = await navigator.wakeLock?.request('screen'); lock?.addEventListener('release', () => { lock = null; }); } } catch { /* nicht unterstützt */ } }
document.addEventListener('visibilitychange', wake);

load(); render(); wake();
