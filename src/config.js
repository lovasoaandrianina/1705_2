export const CURRENCY = "Ar"; // change ici la devise affichée

export const GAME_NAMES = { rami: "Rami", domino: "Domino", poker: "Poker" };
export const fmt = (n) => `${Number(n || 0).toLocaleString("fr-FR")} ${CURRENCY}`;

export const MIN_STAKE = 1000, MAX_STAKE = 20000; // mêmes limites que le serveur
/** Liste des règles (une entrée = une carte UI). */
export const rulesList = (c, game = "rami") => {
  const rules = c?.rules || {};
  if (game === "domino") {
    const half = Math.floor(Number(c?.target || 100) / 2);
    const labels = [
      rules.first50 && `${half} points sans qu'un autre joueur marque`,
      rules.big50 && `Manche ≥ ${half} points gagne immédiatement`,
      rules.outDouble6 && "Victoire spéciale en sortant sur le double 6",
    ].filter(Boolean);
    return labels.length ? labels : ["Règles classiques"];
  }
  return [
    rules.needSet && "1 brelan obligatoire",
    rules.needRun && "1 suite obligatoire",
    !rules.needSet && !rules.needRun && "Règle libre",
    rules.joker ? "Avec joker" : "Sans joker",
  ].filter(Boolean);
};

/** Liste des options (une entrée = une carte UI). */
export const optionsList = (c, game = "rami") => {
  if (game === "domino") {
    const target = Number(c?.target || 100);
    return [`Objectif : ${target} points`];
  }
  const options = c?.options || {};
  const req = (o) => (o?.needSet && o?.needRun ? "avec tri + suite" : o?.needSet ? "avec tri obligatoire" : o?.needRun ? "avec suite obligatoire" : "libre");
  const list = [
    options.x2 && "×2 proposé si le sabot est terminé",
    options.carre?.on && `Carré : ${fmt(options.carre.amount)} au premier (sans joker)`,
    options.prime?.on && `7 cartes : ${fmt(options.prime.amount)} au premier (${req(options.prime)}, sans joker)`,
    options.ten?.on && `10 cartes : ${fmt(options.ten.amount)} au premier (${req(options.ten)}, sans joker)`,
  ].filter(Boolean);
  return list.length ? list : ["Aucune option"];
};

// Compat texte plat (anciens usages éventuels)
export const rulesText = (c, game = "rami") => rulesList(c, game).join(" · ");
export const optionsText = (c, game = "rami") => optionsList(c, game).join(" · ");

export const pct = (bps) => `${(Number(bps || 0) / 100).toLocaleString("fr-FR")} %`; // 350 → « 3,5 % »
