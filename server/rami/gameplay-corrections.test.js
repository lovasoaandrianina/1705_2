import assert from 'node:assert/strict';
import { findCarre, primeGroups, tenGroups, newGame, claim, viewFor } from './engine.js';
let n = 1000;
const c = (r, s) => ({ id: n++, r, s });
const ok = (v, m) => assert.ok(v, m);
const no = (v, m) => assert.ok(!v, m);
// Joker de la partie = 8♠ (et 8♣) : dans les primes il compte comme un 8 normal, jamais comme joker.

// ── Carré ──
ok(findCarre([c(2,1), c(3,1), c(4,1), c(5,1)]), 'carré 2-3-4-5');
ok(findCarre([c(4,0), c(4,1), c(4,2), c(4,3)]), 'carré 4-4-4-4');
ok(findCarre([c(5,0), c(6,0), c(7,0), c(8,0)]), 'carré 5-6-7-8♠ : le 8♠ « joker » compte comme un vrai 8');
ok(findCarre([c(8,0), c(8,1), c(8,2), c(8,3)]), 'carré 8-8-8-8 avec le 8♠ joker');
no(findCarre([c(2,1), c(3,1), c(8,0), c(5,1)]), 'un joker NE remplace PAS le 4 manquant');
no(findCarre([c(3,0), c(3,1), c(3,2), c(8,0)]), 'un joker NE complète PAS 3-3-3');
no(findCarre([c(13,1), c(1,1), c(2,1), c(3,1)]), 'pas de suite qui boucle R-A-2-3');
no(findCarre([c(3,1), c(3,1), c(3,0), c(3,2)]), 'même couleur en double refusé');

// ── 7 cartes = carré + 3 ──
const four = () => [c(2,1), c(3,1), c(4,1), c(5,1)];
const tri = () => [c(3,0), c(3,2), c(3,3)];
const run3 = () => [c(6,2), c(7,2), c(8,2)];
ok(primeGroups([...four(), ...tri()]), '7 : suite de 4 + tri');
ok(primeGroups([...four(), ...run3()]), '7 : suite de 4 + suite de 3');
ok(primeGroups([c(5,0), c(6,0), c(7,0), c(8,0), c(9,1), c(10,1), c(11,1)]), '7 : le 8♠ joker sert comme vrai 8 dans la suite');
no(primeGroups([c(2,1), c(3,1), c(8,0), c(5,1), ...tri()]), '7 : joker non utilisable comme remplaçant');
no(primeGroups([...four(), c(3,0), c(3,2), c(8,3)]), '7 : tri incomplet + joker refusé');
ok(primeGroups([...four(), ...tri()], null, { needSet: true }), 'tri obligatoire OK');
no(primeGroups([...four(), ...run3()], null, { needSet: true }), 'tri obligatoire : 2 suites refusées');
ok(primeGroups([...four(), ...run3()], null, { needRun: true }), 'suite obligatoire OK');
no(primeGroups([c(3,0), c(3,1), c(3,2), c(3,3), c(4,0), c(4,1), c(4,2)], null, { needRun: true }), 'suite obligatoire : carré + tri refusés');
ok(primeGroups([...four(), ...tri()], null, { needSet: true, needRun: true }), 'tri ET suite OK');
no(primeGroups([...four(), ...run3()], null, { needSet: true, needRun: true }), 'tri ET suite : 2 suites refusées');

// ── 10 cartes = carré + 3 + 3 ──
const ten = () => [...four(), ...tri(), ...run3()];
ok(tenGroups(ten()), '10 : carré + tri + suite');
ok(tenGroups([c(4,0), c(4,1), c(4,2), c(4,3), c(5,0), c(5,1), c(5,2), c(9,3), c(10,3), c(11,3)]), '10 : 4-4-4-4 + 5-5-5 + 9-10-J');
ok(tenGroups([...ten(), c(11,1), c(13,0), c(1,3)]), '10 dans une main de 13');
no(tenGroups([...four(), ...tri(), c(6,2), c(7,2), c(11,2)]), '10 : seulement 9 cartes rangées');
ok(tenGroups(ten(), null, { needSet: true }) && tenGroups(ten(), null, { needRun: true }) && tenGroups(ten(), null, { needSet: true, needRun: true }), '10 : tri / suite obligatoires respectés');
no(tenGroups([...four(), c(6,2), c(7,2), c(8,2), c(10,3), c(11,3), c(12,3)], null, { needSet: true }), '10 : aucun tri alors qu\'il est exigé');

// ── Réclamation + affichage 30 s ──
const g = newGame([1, 2, 3], { rules: { joker: true }, options: { carre: { on: true, amount: 1 }, prime: { on: true, amount: 1, needSet: true }, ten: { on: true, amount: 1 } } });
g.hands[0] = [...four(), ...tri(), c(10,0), c(12,0), c(1,0), c(13,3), c(8,3), c(11,3)];
assert.throws(() => claim(g, 0, 'ten'), /10 cartes/);
claim(g, 0, 'prime');
const v = viewFor(g, 1, ['a', 'b', 'c']);
assert.ok(v.claimMs.prime > 29000 && v.claimMs.prime <= 30000);
assert.equal(v.claimCards.prime.flat().length, 7);
console.log('Gameplay Rami : Carré / 7 cartes (4+3) / 10 cartes (4+3+3), SANS joker, options tri/suite : OK');
