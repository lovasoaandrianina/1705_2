import assert from 'node:assert/strict';
import { findCarre, primeGroups, tenGroups } from './engine.js';
const J = { r: 5, suits: [0, 3] };
const c = (id, r, s) => ({ id, r, s });
// Joker remplace bien le 5 dans la suite 3-4-5-6.
const run4 = [c(1,3,1), c(2,4,1), c(3,5,0), c(4,6,1)];
assert.ok(findCarre(run4, J), 'suite de 4 avec joker correctement placé');
// Un joker ne doit pas valider une combinaison incohérente à lui seul.
const invalid = [c(11,3,1), c(12,4,1), c(13,5,0), c(14,7,1)];
assert.equal(findCarre(invalid, J), null, 'suite invalide malgré le joker');
const prime = [...run4, c(5,8,0), c(6,8,1), c(7,8,2)];
assert.ok(primeGroups(prime, J), 'prime 7 cartes avec joker bien placé');
const ten = [...prime, c(8,10,0), c(9,10,1), c(10,10,2)];
assert.ok(tenGroups(ten, J), 'prime 10 cartes avec joker bien placé');
console.log('Gameplay Rami: tests joker Carré / 7 cartes / 10 cartes OK');
