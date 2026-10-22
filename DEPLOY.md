# Mise en ligne sur Render (le site ET l'API sur un seul service)

## 1. Turso
```
turso db create rami
turso db show rami --url          # → TURSO_DATABASE_URL
turso db tokens create rami       # → TURSO_AUTH_TOKEN
```

## 2. Render
1. Mets ce projet sur GitHub (la racine du dépôt = ce dossier, avec `render.yaml`).
2. Render → **New +** → **Blueprint** → choisis le dépôt. Render lit `render.yaml`.
3. Renseigne `TURSO_DATABASE_URL` et `TURSO_AUTH_TOKEN` quand Render les demande.
4. Déploie. Quand c'est « Live », ouvre `https://<ton-service>.onrender.com` : le site s'affiche et `/api/health` répond `{"ok":true}`.

Sans Blueprint (service créé à la main) : Build `npm install && npm run build`, Start `npm start`, Health check `/api/health`,
variables `NODE_ENV=production`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.

- Garde le plan **Starter** (ou plus) : le plan gratuit s'endort après 15 min d'inactivité, ce qui bloque les parties en cours.
- Reste sur **une seule instance** : les parties en cours et le chronomètre des tours vivent dans le processus
  (elles sont sauvegardées dans Turso et reprennent après un redémarrage).
- Pas de `CORS_ORIGIN` ni de `VITE_API_URL` à régler : le site et l'API ont la même adresse.

## 3. Nom de domaine / Cloudflare (facultatif)
Ajoute ton domaine dans Render (Settings → Custom Domains), puis crée l'enregistrement DNS chez Cloudflare.
Le site continue d'appeler `/api` sur le même domaine.

## Autres cas
- Site sur Cloudflare Pages + API sur Render : build avec `VITE_API_URL=https://<service>.onrender.com/api`
  (voir `.env.production.example`) et `CORS_ORIGIN=https://ton-site.pages.dev` côté Render.
- En local : `npm run dev:server` (API, port 3001) + `npm run dev` (site, port 5173).

## Commission et revenus
- `FEE_BPS` (par défaut 350 = 3,5 %) : commission prélevée sur le **gain net** de chaque joueur (reçu du pot − sa mise).
  Exemple : 3 joueurs × 10 000 Ar → pot 30 000 → gain net 20 000 → commission 700 → le gagnant reçoit 29 300.
- Chaque prélèvement est écrit dans l'historique du joueur (ligne « Commission ») et dans la table `platform_fees`.
- Consulter tes revenus : `GET /api/admin/fees` avec l'en-tête `x-admin-key: <ADMIN_KEY>` (clé générée par Render, visible dans Environment).

## Invitations
Lien à partager : `https://ton-site/?table=<numéro>` (bouton « Copier le lien / Partager » dans la salle d'attente).
Si la personne n'a pas de compte, elle s'inscrit puis arrive directement sur la table.

## Poker (cash game, 9 places)
- Texas Hold'em No-Limit. Petite et grosse blinde saisies librement par le créateur (buy-in ≥ 10 grosses blindes). Le buy-in (2 000 à 20 000 Ar, 1 jeton = 1 Ar) est fixé par le créateur et identique pour tous : les invités ne le choisissent pas. Débité du solde à l'arrivée.
- Table de 2 à 9 joueurs réels (aucun bot), lien d'invitation `https://ton-site/?poker=<numéro>`. La main démarre dès que deux joueurs sont assis. Quand un joueur part, il récupère ses jetons sur son solde ; il ne peut partir que lorsque le bouton dealer est sur lui (ou s'il est seul / sans jetons). La commission `FEE_BPS` est prélevée sur le gain net de chaque main gagnée (gain du pot − sa mise dans la main), directement sur les jetons du gagnant ; rien à la sortie. Chaque prélèvement apparaît dans `/api/admin/fees` avec `game = poker`.
- Deux tours sans réponse : le joueur est retiré et ses jetons lui sont rendus. Une table sans joueur humain est fermée.
- L'argent circule uniquement entre les joueurs : la plateforme ne gagne que la commission.
- Tests du moteur : `npm run test:poker`.

## Sons et affichage de la commission
- Les sons de jeu (Domino, Rami en ligne et solo, Poker) sont synthétisés par le navigateur (WebAudio) : aucun fichier à héberger. Bouton 🔊/🔇 dans chaque jeu, choix mémorisé sur l'appareil. Le navigateur n'active le son qu'après le premier toucher de l'écran.
- La commission n'est plus mentionnée avant ou pendant le jeu. Domino / Rami : une ligne « Commission » dans le récapitulatif de fin de partie, visible uniquement du gagnant. Poker : une petite ligne « commission » à la fin de chaque main, visible de tous les joueurs.

## Chat de table
- Chat en direct dans chaque table (Domino et Rami : salle d'attente + partie ; Poker : à table). Il vit uniquement en mémoire du serveur : aucun historique n'est enregistré, la salle est détruite à la fin de la partie (ou quand la table est annulée / fermée) et un redémarrage du serveur la vide. Comme le reste du jeu, il suppose une seule instance Render.
- Accès réservé aux joueurs de la table (vérifié côté serveur). Limites : 300 caractères, 6 messages / 5 s par joueur. Fonctions : indicateur « écrit… », présence, réactions emoji volantes, aperçu des nouveaux messages, bulle déplaçable.

