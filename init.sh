#!/bin/bash
# =============================================
# init_project.sh — Kaiji Multiplayer Card Game
# Lance depuis la racine : bash init_project.sh
# =============================================

set -e

PROJECT_NAME="kaiji-game"


mkdir -p src/server/games
mkdir -p src/client

# ── package.json ──────────────────────────────
cat > package.json << 'EOF'
{
  "name": "kaiji-game",
  "version": "1.0.0",
  "main": "src/server/index.js",
  "scripts": {
    "start": "node src/server/index.js",
    "dev": "nodemon src/server/index.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.6.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
EOF

# ── .gitignore ─────────────────────────────────
cat > .gitignore << 'EOF'
node_modules/
.env
context_upload.txt
EOF

# ── src/server/index.js ───────────────────────
cat > src/server/index.js << 'EOF'
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const roomManager = require('./roomManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../../src/client')));

io.on('connection', (socket) => {
  console.log('✅ Connecté : ' + socket.id);

  socket.on('create_room', ({ pseudo }) => {
    const room = roomManager.createRoom(socket.id, pseudo);
    socket.join(room.id);
    socket.emit('room_updated', room);
    console.log('Room créée : ' + room.id + ' par ' + pseudo);
  });

  socket.on('join_room', ({ room_id, pseudo }) => {
    const result = roomManager.joinRoom(room_id, socket.id, pseudo);
    if (result.error) return socket.emit('error', { message: result.error });
    socket.join(room_id);
    io.to(room_id).emit('room_updated', result.room);
  });

  socket.on('start_game', ({ room_id }) => {
    const result = roomManager.startGame(room_id, socket.id);
    if (result.error) return socket.emit('error', { message: result.error });
    io.to(room_id).emit('game_started', result.gameState);
  });

  socket.on('play_card', ({ room_id, card }) => {
    const result = roomManager.playCard(room_id, socket.id, card);
    if (result.error) return socket.emit('error', { message: result.error });
    if (result.waiting) return socket.emit('waiting_opponent');
    io.to(room_id).emit('round_result', result.roundResult);
    if (result.gameOver) io.to(room_id).emit('game_over', result.winner);
  });

  socket.on('disconnect', () => {
    const affected = roomManager.removePlayer(socket.id);
    if (affected) io.to(affected.room_id).emit('room_updated', affected.room);
    console.log('❌ Déconnecté : ' + socket.id);
  });
});

server.listen(PORT, () => {
  console.log('🃏 Kaiji Game server running on port ' + PORT);
});
EOF

# ── src/server/roomManager.js ─────────────────
# playCard importé sous alias playCardGame pour éviter conflit
# avec la fonction locale playCard(room_id, socketId, card)
cat > src/server/roomManager.js << 'EOF'
const { createGameState, playCard: playCardGame, checkGameOver } = require('./games/kaiji');

const rooms = {};

function generateRoomId() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function createRoom(socketId, pseudo) {
  const room_id = generateRoomId();
  rooms[room_id] = {
    id: room_id,
    host: socketId,
    players: [{ id: socketId, pseudo }],
    status: 'waiting',
    gameState: null,
  };
  return rooms[room_id];
}

function joinRoom(room_id, socketId, pseudo) {
  const room = rooms[room_id];
  if (!room) return { error: 'Room introuvable' };
  if (room.status !== 'waiting') return { error: 'Partie déjà en cours' };
  if (room.players.length >= 2) return { error: 'Room pleine' };
  if (room.players.find(p => p.id === socketId)) return { error: 'Déjà dans la room' };
  room.players.push({ id: socketId, pseudo });
  return { room };
}

function startGame(room_id, socketId) {
  const room = rooms[room_id];
  if (!room) return { error: 'Room introuvable' };
  if (room.host !== socketId) return { error: 'Seul le host peut lancer' };
  if (room.players.length < 2) return { error: 'Il faut au moins 2 joueurs' };
  room.status = 'playing';
  room.gameState = createGameState(room.players);
  return { gameState: room.gameState };
}

function playCard(room_id, socketId, card) {
  const room = rooms[room_id];
  if (!room || room.status !== 'playing') return { error: 'Partie non active' };
  const result = playCardGame(room.gameState, socketId, card);
  if (result.error) return result;
  if (result.waiting) return { waiting: true };
  const gameOver = checkGameOver(room.gameState);
  if (gameOver) {
    room.status = 'finished';
    return { roundResult: result.roundResult, gameOver: true, winner: gameOver.winner };
  }
  return { roundResult: result.roundResult };
}

function removePlayer(socketId) {
  for (const room_id in rooms) {
    const room = rooms[room_id];
    const idx = room.players.findIndex(p => p.id === socketId);
    if (idx !== -1) {
      room.players.splice(idx, 1);
      if (room.players.length === 0) {
        delete rooms[room_id];
        return null;
      }
      room.host = room.players[0].id;
      room.status = 'waiting';
      room.gameState = null;
      return { room_id, room };
    }
  }
  return null;
}

module.exports = { createRoom, joinRoom, startGame, playCard, removePlayer };
EOF

# ── src/server/games/kaiji.js ─────────────────
cat > src/server/games/kaiji.js << 'EOF'
const CARDS = ['emperor', 'citizen', 'slave'];

const BEATS = {
  emperor: 'citizen',
  citizen: 'slave',
  slave: 'emperor',
};

function createGameState(players) {
  return {
    players: players.map(p => ({ id: p.id, pseudo: p.pseudo, score: 0 })),
    round: 1,
    maxRounds: 3,
    currentPlays: {},
  };
}

function playCard(gameState, socketId, card) {
  if (!CARDS.includes(card)) return { error: 'Carte invalide' };
  if (gameState.currentPlays[socketId]) return { error: 'Carte déjà jouée ce round' };

  gameState.currentPlays[socketId] = card;

  const playedCount = Object.keys(gameState.currentPlays).length;
  if (playedCount < 2) return { waiting: true };

  const [p1, p2] = gameState.players;
  const card1 = gameState.currentPlays[p1.id];
  const card2 = gameState.currentPlays[p2.id];

  let roundWinner = null;
  if (BEATS[card1] === card2) {
    p1.score++;
    roundWinner = p1.id;
  } else if (BEATS[card2] === card1) {
    p2.score++;
    roundWinner = p2.id;
  }

  const roundResult = {
    round: gameState.round,
    plays: { [p1.id]: card1, [p2.id]: card2 },
    winner: roundWinner,
    scores: { [p1.id]: p1.score, [p2.id]: p2.score },
  };

  gameState.round++;
  gameState.currentPlays = {};

  return { roundResult };
}

function checkGameOver(gameState) {
  if (gameState.round > gameState.maxRounds) {
    const [p1, p2] = gameState.players;
    let winner = null;
    if (p1.score > p2.score) winner = p1;
    else if (p2.score > p1.score) winner = p2;
    return { winner };
  }
  return null;
}

module.exports = { createGameState, playCard, checkGameOver };
EOF

# ── src/client/index.html ─────────────────────
cat > src/client/index.html << 'EOF'
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Kaiji — Empereur Esclave</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div id="app">
    <h1>🃏 Kaiji — Empereur / Esclave</h1>

    <div id="screen-lobby">
      <input id="input-pseudo" type="text" placeholder="Ton pseudo" maxlength="16" />
      <button id="btn-create">Créer une room</button>
      <hr/>
      <input id="input-room-id" type="text" placeholder="ID de la room" maxlength="5" />
      <button id="btn-join">Rejoindre</button>
    </div>

    <div id="screen-room" class="hidden">
      <p>Room : <strong id="display-room-id"></strong></p>
      <ul id="players-list"></ul>
      <button id="btn-start" class="hidden">Lancer la partie</button>
      <p id="waiting-msg">En attente d'un adversaire...</p>
    </div>

    <div id="screen-game" class="hidden">
      <p>Round <span id="round-number">1</span> / 3</p>
      <div id="scores"></div>
      <div id="cards">
        <button class="card-btn" data-card="emperor">👑 Empereur</button>
        <button class="card-btn" data-card="citizen">👤 Citoyen</button>
        <button class="card-btn" data-card="slave">⛓️ Esclave</button>
      </div>
      <div id="round-result"></div>
    </div>

    <div id="screen-gameover" class="hidden">
      <h2 id="winner-text"></h2>
      <button id="btn-replay">Rejouer</button>
    </div>

    <div id="error-msg" class="hidden"></div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="app.js"></script>
</body>
</html>
EOF

# ── src/client/style.css ──────────────────────
cat > src/client/style.css << 'EOF'
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Segoe UI', sans-serif;
  background: #1a1a2e;
  color: #eee;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}
#app {
  background: #16213e;
  border-radius: 12px;
  padding: 2rem;
  width: 360px;
  text-align: center;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
}
h1 { margin-bottom: 1.5rem; font-size: 1.4rem; }
input {
  width: 100%; padding: 0.6rem;
  margin-bottom: 0.6rem;
  border-radius: 6px; border: none;
  background: #0f3460; color: #eee;
}
button {
  width: 100%; padding: 0.7rem;
  margin-bottom: 0.5rem;
  border-radius: 6px; border: none;
  background: #e94560; color: white;
  cursor: pointer; font-size: 1rem;
}
button:hover { background: #c73652; }
.card-btn { background: #0f3460; }
.card-btn:hover { background: #1a5288; }
hr { margin: 1rem 0; border-color: #0f3460; }
.hidden { display: none !important; }
#error-msg {
  background: #e94560; border-radius: 6px;
  padding: 0.5rem; margin-top: 1rem;
}
#round-result { margin-top: 1rem; min-height: 2rem; }
#scores { margin-bottom: 1rem; }
EOF

# ── src/client/app.js ─────────────────────────
cat > src/client/app.js << 'EOF'
const socket = io();

let currentRoomId = null;
let myPseudo = '';

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

document.getElementById('btn-create').addEventListener('click', () => {
  myPseudo = document.getElementById('input-pseudo').value.trim();
  if (!myPseudo) return showError('Entre un pseudo');
  socket.emit('create_room', { pseudo: myPseudo });
});

document.getElementById('btn-join').addEventListener('click', () => {
  myPseudo = document.getElementById('input-pseudo').value.trim();
  const room_id = document.getElementById('input-room-id').value.trim().toUpperCase();
  if (!myPseudo) return showError('Entre un pseudo');
  if (!room_id) return showError('Entre un ID de room');
  socket.emit('join_room', { room_id, pseudo: myPseudo });
});

socket.on('room_updated', (room) => {
  currentRoomId = room.id;
  hide('screen-lobby');
  show('screen-room');
  document.getElementById('display-room-id').textContent = room.id;

  const list = document.getElementById('players-list');
  list.innerHTML = room.players.map(p =>
    '<li>' + p.pseudo + (p.id === room.host ? ' 👑' : '') + '</li>'
  ).join('');

  const me = room.players.find(p => p.id === socket.id);
  const isHost = me && me.id === room.host;
  const canStart = room.players.length >= 2;

  if (isHost && canStart) {
    show('btn-start');
    hide('waiting-msg');
  } else {
    hide('btn-start');
    show('waiting-msg');
  }
});

document.getElementById('btn-start').addEventListener('click', () => {
  socket.emit('start_game', { room_id: currentRoomId });
});

socket.on('game_started', (gameState) => {
  hide('screen-room');
  show('screen-game');
  document.getElementById('scores').textContent =
    gameState.players.map(p => p.pseudo + ': 0').join(' | ');
});

document.querySelectorAll('.card-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    socket.emit('play_card', { room_id: currentRoomId, card: btn.dataset.card });
    document.querySelectorAll('.card-btn').forEach(b => b.disabled = true);
  });
});

socket.on('waiting_opponent', () => {
  document.getElementById('round-result').textContent = "⏳ En attente de l'adversaire...";
});

socket.on('round_result', (result) => {
  document.querySelectorAll('.card-btn').forEach(b => b.disabled = false);
  document.getElementById('round-number').textContent = result.round;

  const myCard = result.plays[socket.id];
  const opEntry = Object.entries(result.plays).find(function(e) { return e[0] !== socket.id; });
  const opCard = opEntry ? opEntry[1] : '?';
  const won = result.winner === socket.id;
  const draw = result.winner === null;

  document.getElementById('round-result').textContent =
    'Tu : ' + myCard + ' | Adv : ' + opCard + ' → ' +
    (draw ? 'Égalité' : won ? '✅ Round gagné' : '❌ Round perdu');

  document.getElementById('scores').textContent =
    Object.entries(result.scores)
      .map(function(e) { return (e[0] === socket.id ? 'Toi' : 'Adv') + ': ' + e[1]; })
      .join(' | ');
});

socket.on('game_over', (winner) => {
  hide('screen-game');
  show('screen-gameover');
  const draw = winner === null;
  const won = winner && winner.id === socket.id;
  document.getElementById('winner-text').textContent =
    draw ? '🤝 Match nul !' : won ? '🏆 Tu as gagné !' : '💀 Tu as perdu...';
});

document.getElementById('btn-replay').addEventListener('click', () => {
  hide('screen-gameover');
  show('screen-lobby');
});

socket.on('error', function(data) { showError(data.message); });
EOF

# ── PROJECT.md ────────────────────────────────
cat > PROJECT.md << 'EOF'
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
- Empereur bat Citoyen
- Citoyen bat Esclave
- Esclave bat Empereur
- 3 rounds, révélation simultanée, le plus de rounds gagnés l'emporte

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
EOF

# ── CONTEXT.md ────────────────────────────────
cat > CONTEXT.md << 'EOF'
# Context Snapshot — [METTRE LA DATE ICI]

## État d'avancement
- [x] Structure du projet initialisée
- [x] Serveur Express + Socket.io
- [x] roomManager (create/join/start/leave)
- [x] Logique Kaiji (kaiji.js)
- [x] UI client (lobby, room, game, gameover)
- [ ] Testé en local
- [ ] Déployé sur Render

## Fichiers clés
- `src/server/index.js` — point d'entrée, wiring des events
- `src/server/roomManager.js` — toute la logique rooms
- `src/server/games/kaiji.js` — logique du jeu pure

## Bugs connus
- Aucun connu après fix du conflit de nom playCard/playCardGame

## Ce que je demande à Claude aujourd'hui
[REMPLIS ICI AVANT CHAQUE SESSION]
EOF

# ── collect_context.sh ────────────────────────
cat > collect_context.sh << 'EOF'
#!/bin/bash
OUTPUT="context_upload.txt"
> "$OUTPUT"

FILES=(
  "PROJECT.md"
  "CONTEXT.md"
  "src/server/index.js"
  "src/server/roomManager.js"
  "src/server/games/kaiji.js"
  "src/client/app.js"
  "src/client/index.html"
  "package.json"
)

for f in "${FILES[@]}"; do
  echo "" >> "$OUTPUT"
  echo "=== $f ===" >> "$OUTPUT"
  [ -f "$f" ] && cat "$f" >> "$OUTPUT" || echo "[NON EXISTANT]" >> "$OUTPUT"
done

echo "✅ context_upload.txt généré"
wc -c "$OUTPUT" | awk '{print "📦 Taille : " $1 " octets"}'
EOF
chmod +x collect_context.sh

# ── npm install ───────────────────────────────
echo ""
echo "📦 Installation des dépendances npm..."
npm install

echo ""
echo "✅ Projet prêt dans ./$PROJECT_NAME/"
echo ""
echo "▶  cd $PROJECT_NAME && npm run dev"
echo "🌐 Ouvre deux onglets sur http://localhost:3000"