import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
dotenv.config();                                                          // .env à la racine du projet
dotenv.config({ path: fileURLToPath(new URL("./.env", import.meta.url)) }); // ou server/.env
import { createClient } from "@libsql/client";

// Le token Turso reste ICI, côté serveur : jamais dans le code React.
export const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db", // fichier local si Turso n'est pas configuré
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const TX_SQL = `CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('deposit','withdraw','bet','win','refund','fee')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  balance_after INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

export async function migrate() {
  // Ancienne base (types deposit/withdraw seulement) : on reconstruit la table en gardant l'historique
  const old = (await db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='transactions'")).rows[0];
  if (old && !String(old.sql).includes("'fee'")) {
    const cols = String(old.sql).includes("note") ? "id,user_id,type,amount,balance_after,note,created_at" : "id,user_id,type,amount,balance_after,created_at";
    await db.batch(
      [
        "ALTER TABLE transactions RENAME TO transactions_old",
        "DROP INDEX IF EXISTS idx_tx_user",
        TX_SQL,
        `INSERT INTO transactions (${cols}) SELECT ${cols} FROM transactions_old`,
        "DROP TABLE transactions_old",
      ],
      "write"
    );
  }
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pseudo TEXT NOT NULL UNIQUE COLLATE NOCASE,
        phone TEXT NOT NULL UNIQUE,
        pin_hash TEXT NOT NULL,
        avatar TEXT,
        balance INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        expires_at TEXT NOT NULL
      )`,
      TX_SQL,
      `CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, id DESC)`,
      `CREATE TABLE IF NOT EXISTS game_tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game TEXT NOT NULL DEFAULT 'rami' CHECK (game IN ('rami','domino')),
        creator_id INTEGER NOT NULL REFERENCES users(id),
        stake INTEGER NOT NULL,
        max_players INTEGER NOT NULL,
        config TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','playing','finished','cancelled')),
        state TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS table_waitlist (
        table_id INTEGER NOT NULL REFERENCES game_tables(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        PRIMARY KEY (table_id, user_id)
      )`,
      `CREATE TABLE IF NOT EXISTS platform_fees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        base INTEGER NOT NULL,
        rate_bps INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS poker_tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        creator_id INTEGER NOT NULL REFERENCES users(id),
        sb INTEGER NOT NULL,
        bb INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
        state TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      // un joueur ne peut être assis qu'à une seule table de poker à la fois (clé primaire sur user_id)
      `CREATE TABLE IF NOT EXISTS poker_players (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        table_id INTEGER NOT NULL REFERENCES poker_tables(id)
      )`,
      `CREATE TABLE IF NOT EXISTS table_players (
        table_id INTEGER NOT NULL REFERENCES game_tables(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        locked INTEGER NOT NULL,
        PRIMARY KEY (table_id, user_id)
      )`,
    ],
    "write"
  );

  // Migration des bases créées avant l'ajout du jeu Domino.
  // CREATE TABLE IF NOT EXISTS ne modifie pas une table déjà existante.
  const gameTableColumns = (await db.execute("PRAGMA table_info(game_tables)")).rows;
  if (!gameTableColumns.some((column) => column.name === "game")) {
    await db.execute("ALTER TABLE game_tables ADD COLUMN game TEXT NOT NULL DEFAULT 'rami'");
  }

  // Commissions : on distingue celles du poker (table_id y est l'identifiant d'une table de poker, pas d'une table Rami/Domino)
  const feeColumns = (await db.execute("PRAGMA table_info(platform_fees)")).rows;
  if (!feeColumns.some((column) => column.name === "game")) {
    await db.execute("ALTER TABLE platform_fees ADD COLUMN game TEXT");
  }
}
