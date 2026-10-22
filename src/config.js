export const CURRENCY = "Ar"; // change ici la devise affichée

export const GAME_NAMES = { rami: "Rami", domino: "Domino", poker: "Poker" };
export const fmt = (n) => `${Number(n || 0).toLocaleString("fr-FR")} ${CURRENCY}`;

export const MIN_STAKE = 1000, MAX_STAKE = 20000; // mêmes limites que le serveur
/** Liste des règles (une entrée = une carte UI). */
export const rulesList = (c, game = "rami") => {
  const rules = c?.rules || {};
  if (game === "domino") {
    const labels = [
      rules.first50 && "50 points sans qu'un autre joueur marque",
      rules.big50 && "Bonus si une manche rapporte au moins 50 points",
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
  if (game === "domino") return ["Objectif : 100 points"];
  const options = c?.options || {};
  const list = [
    options.x2 && "×2 proposé si le sabot est terminé",
    options.carre?.on && `Carré : ${fmt(options.carre.amount)} au premier (sans joker)`,
    options.ten?.on && `10 cartes : ${fmt(options.ten.amount)} au premier (sans joker)`,
  ].filter(Boolean);
  return list.length ? list : ["Aucune option"];
};

// Compat texte plat (anciens usages éventuels)
export const rulesText = (c, game = "rami") => rulesList(c, game).join(" · ");
export const optionsText = (c, game = "rami") => optionsList(c, game).join(" · ");

export const pct = (bps) => `${(Number(bps || 0) / 100).toLocaleString("fr-FR")} %`; // 350 → « 3,5 % »
