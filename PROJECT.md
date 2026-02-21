# Kaiji Multiplayer Card Game — Project Bible

## Stack
- Backend: Node.js + Express + Socket.io
- Frontend: Vanilla JS (aucun framework)
- Hosting: Render (free tier, Web Service)
- Pas de base de données : état en mémoire uniquement

## Architecture
- `src/server/index.js` — serveur HTTP + wiring des events Socket.io
- `src/server/roomManager.js` — logique rooms (create/join/start/leave)
- `src/server/games/kaiji.js` — logique pure du jeu (fonctions stateless)
- `src/client/index.html` + `app.js` + `style.css` — SPA vanilla

## Events Socket.io
### Client → Server
| Event | Payload | Description |
|---|---|---|
| create_room | { pseudo } | Créer une room |
| join_room | { room_id, pseudo } | Rejoindre une room |
| start_game | { room_id } | Lancer (host uniquement) |
| play_card | { room_id, card } | Jouer une carte |

### Server → Client
| Event | Payload | Description |
|---|---|---|
| room_updated | room | Nouvel état de la room |
| game_started | gameState | Partie lancée |
| waiting_opponent | — | Attente de l'adversaire |
| round_result | result | Résultat du round |
| game_over | winner | Fin de partie (winner peut être null = égalité) |
| error | { message } | Erreur |

## Règles Kaiji — Empereur/Citoyen/Esclave
- Empereur bat Citoyen | Citoyen bat Esclave | Esclave bat Empereur
- Chaque joueur a 5 cartes en main : soit **4 Citoyens + 1 Empereur**, soit **4 Citoyens + 1 Esclave** (répartition aléatoire entre les deux joueurs)
- Révélation simultanée par round. **Dès qu'un joueur joue sa carte Empereur ou Esclave, la partie s'arrête** (l'adversaire sait qu'il ne reste que des Citoyens). Le gagnant est celui qui a le plus de rounds gagnés à ce moment-là.

## Conventions de code
- Pas de framework frontend
- Erreurs via socket.emit('error', { message })
- roomManager importe playCard de kaiji.js sous l'alias playCardGame pour éviter le conflit de nom

## Ne pas toucher sans discussion
- La structure des events Socket.io (casse le client)
- Le roomManager (logique partagée critique)

## Roadmap (ne pas implémenter avant validation)
- [ ] Chat en room
- [ ] Timer par tour
- [ ] Reconnexion après déco
- [ ] Autres jeux
