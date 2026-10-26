// Test du moteur de poker : npm run test:poker
// 1) pots annexes  2) milliers de mains à 9 (bots + faux joueurs) avec horloge simulée : les jetons ne doivent jamais apparaître ni disparaître.
import * as E from "./engine.js";

let clock = 1_700_000_000_000;
Date.now = () => clock;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error("✗ ÉCHEC :", m); } };
const chips = (g) => g.seats.reduce((a, s) => a + s.stack + s.pendingAdd + s.total, 0) + (g.feesTotal || 0); // les commissions quittent la table mais restent comptées

/* ── 1. Pots annexes : A (1000 tapis) > B (400 tapis) > C (200 tapis), D couché (300) ── */
{
  const g = E.newGame(50, 100);
  for (const s of g.seats) Object.assign(s, { inHand: false, folded: true, total: 0, stack: 0, hole: [] });
  const c = (r, su) => r - 2 + 13 * su;
  const set = (i, total, hole, folded = false) => Object.assign(g.seats[i], { inHand: true, folded, total, stack: 0, hole, allin: !folded });
  set(0, 1000, [c(14, 0), c(14, 1)]);           // A : paires d'As
  set(1, 400, [c(13, 0), c(13, 1)]);            // B : paires de Rois
  set(2, 200, [c(12, 0), c(12, 1)]);            // C : paires de Dames
  set(3, 300, [c(2, 2), c(3, 3)], true);        // D : couché après 300
  const handObj = { n: 1, deck: [], board: [c(5, 2), c(7, 3), c(9, 0), c(10, 1), c(4, 0)], street: "river", currentBet: 0, minRaise: 100, fullLevel: 0, toAct: -1, deadline: 0, botAt: 0, waitUntil: 0 };
  g.hand = structuredClone(handObj);
  g.phase = "hand";
  const g2 = structuredClone(g);
  const before = chips(g);
  E.showdown(g);
  ok(chips(g) === before, "pots annexes : conservation des jetons");
  ok(g.seats[0].stack === 1900, `A gagne tout (1900) : ${g.seats[0].stack}`);
  ok(g.seats[1].stack === 0 && g.seats[2].stack === 0, "B et C perdent");
  // A moins fort que B et C : B gagne le pot principal limité à son tapis
  for (const s of g2.seats) { s.stack = 0; }
  g2.seats[0].hole = [c(2, 0), c(3, 1)]; g2.seats[1].hole = [c(13, 0), c(13, 1)]; g2.seats[2].hole = [c(14, 0), c(14, 1)];
  g2.hand = structuredClone(handObj); g2.phase = "hand";
  E.showdown(g2);
  // pot principal 4×200 = 800 (C, As) ; pot annexe 1 : 100×3 (A, B, D) = 300 (B) ; pot annexe 2 : 100×2 (A, B) = 200 (B) ; A récupère 600 non suivis
  ok(g2.seats[2].stack === 800, `C gagne le pot principal (800) : ${g2.seats[2].stack}`);
  ok(g2.seats[1].stack === 500, `B gagne les pots annexes (300 + 200) : ${g2.seats[1].stack}`);
  ok(g2.seats[0].stack === 600, `A récupère l'excédent non suivi (600) : ${g2.seats[0].stack}`);
}

/* ── 2. Simulation : N joueurs qui jouent au hasard, arrivées et départs en cours de main ── */
function simulate(label, { hands, blinds, players }) {
  const g = E.newGame(blinds[0], blinds[1], 350);
  let uid = 100;
  const join = () => { if (g.seats.some((s) => s.empty)) E.seatHuman(g, { userId: ++uid, name: `J${uid}`, buy: 2000 + Math.floor(Math.random() * 19) * 1000 }); };
  for (let k = 0; k < players; k++) join();
  let lastHand = 0, snapshot = null, handsDone = 0, ticks = 0, showdowns = 0, uncontested = 0;
  while (handsDone < hands && ticks < hands * 600) {
    ticks++; clock += 700;
    const h = g.hand;
    if (h && g.phase === "hand" && !h.waitUntil && h.toAct >= 0 && Math.random() < 0.8) {
      const seat = g.seats[h.toAct], before = chips(g), r = Math.random();
      try {
        if (r < 0.2) E.act(g, h.toAct, { type: "fold" });
        else if (r < 0.6) E.act(g, h.toAct, { type: h.currentBet === seat.bet ? "check" : "call" });
        else if (r < 0.97) E.act(g, h.toAct, { type: "raise", to: h.currentBet + h.minRaise * (1 + Math.floor(Math.random() * 6)) });
        else E.act(g, h.toAct, { type: "raise", to: 10 ** 9 }); // tapis
      } catch { /* action refusée : normal */ }
      ok(chips(g) === before || g.handNo !== lastHand, `${label} : conservation après action`);
    }
    if (Math.random() < 0.01) { const hs = E.humans(g); if (hs.length > 2) E.requestLeave(g, hs[Math.floor(Math.random() * hs.length)].i); }
    if (Math.random() < 0.01) join();
    for (const { s, i } of E.humans(g)) {
      if (s.leaving && E.exitable(g, s)) { const out = E.vacate(g, i); ok(out.payout >= 0, "payout"); join(); }
      else if (!s.leaving && s.stack === 0 && s.pendingAdd === 0) E.addChips(g, i, 3000);
    }
    const c0 = chips(g), hn0 = g.handNo, ph0 = g.phase;
    E.tick(g);
    const newHand = g.handNo !== hn0 || (ph0 === "between" && g.phase === "hand");
    ok(chips(g) === c0 || newHand, `${label} : jetons créés/perdus pendant tick (${c0} → ${chips(g)})`);
    if (g.phase === "hand" && g.handNo !== lastHand) { lastHand = g.handNo; snapshot = chips(g); }
    if (g.phase === "between" && snapshot !== null && g.last && g.last.n === lastHand) {
      handsDone++; snapshot = null;
      if (g.last.uncontested) uncontested++; else showdowns++;
      ok(g.last.winners.reduce((a, w) => a + w.amount, 0) === g.last.pot, `${label} : somme des gains = pot`);
      ok(g.seats.every((s) => s.stack >= 0 && s.bet === 0 && s.total === 0), `${label} : stacks/mises incohérents`);
    }
  }
  console.log(`${label} : ${handsDone} mains (${showdowns} abattages, ${uncontested} sans abattage)`);
  ok(handsDone >= hands * 0.98, `${label} : la partie s'est bloquée (${handsDone}/${hands})`);
}
simulate("2 joueurs (heads-up)", { hands: 1500, blinds: [50, 100], players: 2 });
simulate("5 joueurs", { hands: 1500, blinds: [25, 50], players: 5 });
simulate("9 joueurs", { hands: 1500, blinds: [100, 200], players: 9 });

/* ── 3. Règles ── */
{
  const g = E.newGame(50, 100);
  for (const n of ["A", "B", "C"]) E.seatHuman(g, { userId: n.charCodeAt(0), name: n, buy: 5000 });
  ok(g.seats.filter((s) => !s.empty).length === 3, "3 places occupées");
  clock += 5000; E.tick(g);
  const h = g.hand;
  ok(!!h && g.phase === "hand", "la main démarre à 3 joueurs");
  ok(g.seats.reduce((a, s) => a + s.total, 0) === 150, "blindes postées : 150");
  const other = g.seats.findIndex((s, i) => i !== h.toAct && s.inHand);
  let threw = false; try { E.act(g, other, { type: "fold" }); } catch { threw = true; }
  ok(threw, "agir hors de son tour est refusé");
  threw = false; try { E.act(g, h.toAct, { type: "check" }); } catch { threw = true; }
  ok(threw, "check refusé face à la grosse blinde");
  threw = false; try { E.act(g, h.toAct, { type: "raise", to: 120 }); } catch { threw = true; }
  ok(threw, "relance sous le minimum refusée");
  const g1 = E.newGame(50, 100); E.seatHuman(g1, { userId: 1, name: "Seul", buy: 5000 });
  clock += 20000; E.tick(g1); ok(!g1.hand, "pas de main avec un seul joueur");
  for (let k = 0; k < 8; k++) E.seatHuman(g1, { userId: 10 + k, name: `x${k}`, buy: 2000 });
  let full = false; try { E.seatHuman(g1, { userId: 99, name: "z", buy: 2000 }); } catch { full = true; }
  ok(full, "10e joueur refusé (table complète)");
}
/* ── 4. Commission prélevée sur le gain net de chaque main gagnée ; règle de départ ── */
{
  const c = (r, su) => r - 2 + 13 * su;
  const g = E.newGame(50, 100, 350);
  for (const s of g.seats) Object.assign(s, { inHand: false, folded: true, total: 0, stack: 0, hole: [] });
  Object.assign(g.seats[0], { empty: false, userId: 1, name: "A", inHand: true, folded: false, total: 500, stack: 0, allin: true, hole: [c(14, 0), c(14, 1)] });
  Object.assign(g.seats[1], { empty: false, userId: 2, name: "B", inHand: true, folded: false, total: 500, stack: 0, allin: true, hole: [c(2, 0), c(7, 1)] });
  g.hand = { n: 1, deck: [], board: [c(5, 2), c(9, 3), c(10, 0), c(12, 1), c(3, 0)], street: "river", currentBet: 0, minRaise: 100, fullLevel: 0, toAct: -1, deadline: 0, waitUntil: 0 };
  g.phase = "hand";
  E.showdown(g);
  ok(g.seats[0].stack === 1000 - 18, `A reçoit le pot moins 3,5 % de son gain net de 500 (982) : ${g.seats[0].stack}`);
  ok(g.seats[1].stack === 0, "B perd sa mise, aucune commission");
  ok(g.feesTotal === 18 && g.feeLog.length === 1 && g.feeLog[0].base === 500, "commission journalisée");
  ok(g.last.winners[0].fee === 18, "la commission est visible dans le résultat");
  // départ : seulement avec le bouton
  const t = E.newGame(50, 100, 350);
  for (const n of ["A", "B", "C", "D"]) E.seatHuman(t, { userId: n.charCodeAt(0), name: n, buy: 5000 });
  const idx = t.seats.map((s, i) => i).filter((i) => !t.seats[i].empty);
  t.button = idx[0];
  ok(E.leaveCheck(t, idx[0]).ok, "le joueur au bouton peut quitter");
  ok(!E.leaveCheck(t, idx[2]).ok && E.leaveCheck(t, idx[2]).in === 2, "à 2 places du bouton : dans 2 mains");
  const solo = E.newGame(50, 100, 350); const si = E.seatHuman(solo, { userId: 9, name: "S", buy: 3000 });
  ok(E.leaveCheck(solo, si).ok, "seul à la table : peut quitter");
}
/* ── 5. Tout le monde quitte en pleine main : aucun jeton ne doit disparaître ── */
{
  let lost = 0;
  for (let trial = 0; trial < 400; trial++) {
    const g = E.newGame(25, 50, 350), n = 2 + (trial % 4); let removed = 0;
    for (let k = 0; k < n; k++) E.seatHuman(g, { userId: k + 1, name: "P" + k, buy: 4000 });
    for (let t = 0; t < 80 + (trial % 60); t++) {
      clock += 700; const h = g.hand;
      if (h && g.phase === "hand" && !h.waitUntil && h.toAct >= 0) { const seat = g.seats[h.toAct]; try { E.act(g, h.toAct, Math.random() < 0.3 ? { type: "raise", to: 10 ** 9 } : { type: h.currentBet === seat.bet ? "check" : "call" }); } catch { /* refusée */ } }
      E.tick(g);
    }
    for (const { i } of E.humans(g)) E.requestLeave(g, i);
    for (let t = 0; t < 40; t++) { clock += 1000; E.tick(g); for (const { s, i } of E.humans(g)) if (s.leaving && E.exitable(g, s)) removed += E.vacate(g, i).payout; }
    const left = g.seats.reduce((a, s) => a + s.stack + s.total + s.pendingAdd, 0);
    if (removed + left + (g.feesTotal || 0) !== n * 4000) lost++;
  }
  ok(lost === 0, `départs en pleine main : jetons perdus dans ${lost} cas sur 400`);
}
/* ── 6. Tapis inégaux : l'excédent non suivi est rendu AVANT l'affichage des cartes ── */
{
  let tested = 0;
  for (let trial = 0; trial < 60 && tested < 5; trial++) {
    const g = E.newGame(50, 100, 350, 20000);
    E.seatHuman(g, { userId: 1, name: "A", buy: 20000 }); E.seatHuman(g, { userId: 2, name: "B", buy: 15000 });
    clock += 5000; E.tick(g);
    const a = g.seats.findIndex((x) => x.userId === 1), b = g.seats.findIndex((x) => x.userId === 2);
    if (g.hand.toAct !== a) continue; // il faut que A (20 000) soit le premier à miser
    tested++;
    E.act(g, a, { type: "raise", to: 10 ** 9 });  // A : tapis de 20 000
    E.act(g, b, { type: "call" });                // B : suit avec ses 15 000
    ok(g.seats[a].stack === 5000, `A récupère ses 5 000 Ar non suivis tout de suite : ${g.seats[a].stack}`);
    ok(g.seats[a].total === 15000 && g.seats[b].total === 15000, "les deux joueurs ont 15 000 dans le pot");
    ok(g.hand.reveal && g.hand.board.length === 0 && g.hand.refund && g.hand.refund.amount === 5000, "remboursement annoncé, mains retournées AVANT les cartes communes");
    ok(E.view(g, 1).seats[b].cards.every((c) => c !== null) && E.view(g, 1).seats[b].cards.length === 2, "tapis : l'adversaire voit les cartes de B");
    clock += 4000; E.tick(g);
    ok(g.hand.board.length === 3, "puis le flop est distribué");
    let guard = 0; while (g.phase === "hand" && guard++ < 60) { clock += 1000; E.tick(g); }
    ok(g.last && g.last.winners.length === 1 || g.last.winners.length === 2, "résultat de la main");
    ok(!g.last.winners.some((w) => w.seat === a && w.amount === 5000), "le remboursement n'est pas compté comme un gain");
    ok(g.seats.reduce((x, y) => x + y.stack, 0) + g.feesTotal === 35000, "jetons conservés");
  }
  ok(tested >= 1, "scénario tapis inégaux testé");
}
console.log(fails ? `\n${fails} ÉCHEC(S)` : "\n✓ Tous les tests du poker passent");
process.exit(fails ? 1 : 0);
