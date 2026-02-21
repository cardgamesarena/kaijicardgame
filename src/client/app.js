const socket = io();

let currentRoomId = null;
let myPseudo = '';
let myHand = [];
let lastPlayedCardType = null;
let opponentHandCount = 5;

// Générer un pseudo aléatoire
function generateRandomPseudo() {
  const adjectives = [
    'Brave', 'Rusé', 'Rapide', 'Sage', 'Noble', 'Audacieux',
    'Mystérieux', 'Chanceux', 'Puissant', 'Astucieux', 'Malin',
    'Intrépide', 'Légendaire', 'Epic', 'Génial', 'Habile'
  ];
  const nouns = [
    'Dragon', 'Phoenix', 'Tigre', 'Renard', 'Loup', 'Aigle',
    'Samourai', 'Ninja', 'Guerrier', 'Joueur', 'Champion',
    'Stratège', 'Maître', 'As', 'Pro', 'Héros'
  ];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 100);
  return adj + noun + num;
}

// Préremplir le pseudo au chargement de la page
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('input-pseudo').value = generateRandomPseudo();
});

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * Attend que les deux cartes soient sur la table avant de continuer
 */
function waitForCardsOnTable() {
  return new Promise(function (resolve) {
    var maxAttempts = 50; // Max 5 secondes (50 * 100ms)
    var attempts = 0;

    function check() {
      var slotMine = document.getElementById('table-slot-mine');
      var slotOpp = document.getElementById('table-slot-opponent');
      var myCard = slotMine ? slotMine.querySelector('.card') : null;
      var oppCard = slotOpp ? slotOpp.querySelector('.card') : null;

      if (myCard && oppCard) {
        resolve();
      } else if (attempts < maxAttempts) {
        attempts++;
        setTimeout(check, 100);
      } else {
        // Timeout - on continue quand même
        resolve();
      }
    }
    check();
  });
}

/**
 * Anime une carte d'une position vers un slot (même effet que la main vers la table).
 */
function animateCardToSlot(fromRect, slotId, cardEl, onEnd) {
  var slot = document.getElementById(slotId);
  if (!slot) {
    if (onEnd) onEnd();
    return;
  }
  var slotRect = slot.getBoundingClientRect();
  var fly = document.createElement('div');
  fly.className = 'card-flyout';
  fly.style.left = fromRect.left + 'px';
  fly.style.top = fromRect.top + 'px';
  fly.style.width = fromRect.width + 'px';
  fly.style.height = fromRect.height + 'px';
  document.body.appendChild(fly);
  cardEl.classList.add('card--on-table');
  cardEl.style.width = '100%';
  cardEl.style.height = '100%';
  cardEl.remove();
  fly.appendChild(cardEl);
  fly.addEventListener('transitionend', function onTransitionEnd() {
    fly.removeEventListener('transitionend', onTransitionEnd);
    fly.remove();
    slot.innerHTML = '';
    cardEl.style.width = '';
    cardEl.style.height = '';
    slot.appendChild(cardEl);
    if (onEnd) onEnd();
  });
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      fly.style.left = slotRect.left + 'px';
      fly.style.top = slotRect.top + 'px';
      fly.style.width = slotRect.width + 'px';
      fly.style.height = slotRect.height + 'px';
    });
  });
}

function shuffleHand(hand) {
  const a = [...hand];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const CARD_INFO = {
  emperor: { icon: '👑', name: 'Empereur' },
  citizen: { icon: '👤', name: 'Citoyen' },
  slave: { icon: '⛓️', name: 'Esclave' },
};

function createCardEl(cardType, options) {
  const info = CARD_INFO[cardType] || { icon: '?', name: '?' };
  const div = document.createElement('div');
  div.className = 'card' + (options && options.onTable ? ' card--on-table' : '') + (options && options.animateIn ? ' card--animate-in' : '') + (options && options.reveal ? ' card--reveal' : '') + (options && options.faceDownOnly ? ' card--face-down-only' : '');
  div.dataset.card = cardType;
  div.innerHTML =
    '<div class="card-inner">' +
    '<div class="card-back"></div>' +
    '<div class="card-front card--' + cardType + '">' +
    '<span class="card-icon">' + info.icon + '</span>' +
    '<span class="card-name">' + info.name + '</span>' +
    '</div></div>';
  return div;
}

function renderHand(hand, disabled) {
  const container = document.getElementById('my-hand');
  container.innerHTML = '';
  hand.forEach((cardType) => {
    const el = createCardEl(cardType);
    el.classList.add('card--face-up'); /* main visible : on voit la face */
    if (disabled) el.classList.add('card--disabled');
    el.addEventListener('click', () => {
      if (el.classList.contains('card--disabled')) return;
      document.querySelectorAll('#my-hand .card').forEach((c) => c.classList.add('card--disabled'));
      const idx = myHand.indexOf(cardType);
      if (idx >= 0) myHand.splice(idx, 1);
      socket.emit('play_card', { room_id: currentRoomId, card: cardType });
      playCardFromHandToTable(el, cardType);
    });
    container.appendChild(el);
  });
}

function playCardFromHandToTable(cardEl, cardType) {
  lastPlayedCardType = cardType;
  cardEl.classList.remove('card--face-up');
  var cardRect = cardEl.getBoundingClientRect();
  animateCardToSlot(cardRect, 'table-slot-mine', cardEl, function () {
    document.getElementById('round-result').textContent = "⏳ En attente de l'adversaire...";
  });
}

function renderOpponentHand(count) {
  const container = document.getElementById('opponent-hand');
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const el = createCardEl('citizen', { faceDownOnly: true });
    container.appendChild(el);
  }
}

function playOpponentCardToTable() {
  var slot = document.getElementById('table-slot-opponent');
  var hand = document.getElementById('opponent-hand');
  if (slot.querySelector('.card') || !hand || !hand.lastElementChild) return;
  var cardEl = hand.lastElementChild;
  var fromRect = cardEl.getBoundingClientRect();
  cardEl.remove();
  opponentHandCount = Math.max(0, opponentHandCount - 1);
  animateCardToSlot(fromRect, 'table-slot-opponent', cardEl, function () {});
}

function revealTableCards(myCardType, opponentCardType, onDone) {
  // Attendre que les deux cartes soient bien sur la table (animations terminées)
  waitForCardsOnTable().then(function () {
    var slotMine = document.getElementById('table-slot-mine');
    var slotOpp = document.getElementById('table-slot-opponent');

    // Récupérer les cartes (elles doivent exister maintenant)
    var myCard = slotMine.querySelector('.card');
    var oppCard = slotOpp.querySelector('.card');

    // Si pour une raison quelconque les cartes n'existent pas, on les crée
    if (!myCard) {
      myCard = createCardEl(myCardType, { onTable: true });
      slotMine.appendChild(myCard);
    }
    if (!oppCard) {
      oppCard = createCardEl(opponentCardType, { onTable: true });
      slotOpp.appendChild(oppCard);
    }

    // Configurer les faces des cartes (sans les révéler encore)
    if (myCard) {
      myCard.classList.remove('card--face-up', 'card--flipped');
      myCard.querySelector('.card-front').className = 'card-front card--' + myCardType;
      var icon = CARD_INFO[myCardType];
      if (icon) {
        var iconEl = myCard.querySelector('.card-icon');
        var nameEl = myCard.querySelector('.card-name');
        if (iconEl) iconEl.textContent = icon.icon;
        if (nameEl) nameEl.textContent = icon.name;
      }
    }

    if (oppCard) {
      oppCard.classList.remove('card--flipped');
      oppCard.querySelector('.card-front').className = 'card-front card--' + opponentCardType;
      var opIcon = CARD_INFO[opponentCardType];
      if (opIcon) {
        var iconEl = oppCard.querySelector('.card-icon');
        var nameEl = oppCard.querySelector('.card-name');
        if (iconEl) iconEl.textContent = opIcon.icon;
        if (nameEl) nameEl.textContent = opIcon.name;
      }
    }

    // Séquence de révélation simplifiée
    // Petit délai après que les cartes soient arrivées pour que l'utilisateur les voie bien
    delay(500)
      .then(function () {
        return delay(3000); // 3 secondes de suspense avec les deux cartes face cachée
      })
      .then(function () {
        // Révéler les deux cartes en même temps
        myCard = slotMine.querySelector('.card');
        oppCard = slotOpp.querySelector('.card');
        if (myCard) myCard.classList.add('card--reveal');
        if (oppCard) oppCard.classList.add('card--reveal');
        return delay(1000); // Rester révélées 1 seconde
      })
      .then(function () {
        // Faire disparaître les cartes
        myCard = slotMine.querySelector('.card');
        oppCard = slotOpp.querySelector('.card');
        if (myCard) myCard.classList.add('card--disappear');
        if (oppCard) oppCard.classList.add('card--disappear');
        return delay(600); // Temps de l'animation de disparition
      })
      .then(function () {
        if (typeof onDone === 'function') onDone();
      });
  });
}

function clearTable() {
  document.getElementById('table-slot-mine').innerHTML = '';
  document.getElementById('table-slot-opponent').innerHTML = '';
}

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// Gestion des onglets
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tabName = btn.dataset.tab;

    // Retirer la classe active de tous les boutons et contenus
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    // Ajouter la classe active au bouton et contenu cliqués
    btn.classList.add('active');
    document.getElementById('tab-' + tabName).classList.add('active');

    // Si on ouvre l'onglet "rejoindre", charger la liste des rooms
    if (tabName === 'join') {
      loadAvailableRooms();
    }
  });
});

// Charger les rooms disponibles
function loadAvailableRooms() {
  socket.emit('get_available_rooms');
}

// Afficher les rooms disponibles
socket.on('available_rooms', (rooms) => {
  const container = document.getElementById('rooms-list');

  if (!rooms || rooms.length === 0) {
    container.innerHTML = '<p class="no-rooms-text">Aucune room disponible pour le moment.<br/>Créez-en une nouvelle !</p>';
    return;
  }

  container.innerHTML = rooms.map(room => {
    const playersText = room.players.map(p => p.pseudo).join(', ');
    return `
      <div class="room-item" data-room-id="${room.id}">
        <div class="room-header">
          <span class="room-id">${room.id}</span>
          <span class="room-status">${room.playerCount}/${room.maxPlayers}</span>
        </div>
        <div class="room-players">
          <strong>Joueur${room.playerCount > 1 ? 's' : ''} :</strong> ${playersText}
        </div>
        <button class="btn-join-room">Rejoindre cette room</button>
      </div>
    `;
  }).join('');

  // Ajouter les event listeners pour les boutons de rejoindre
  container.querySelectorAll('.room-item').forEach((item) => {
    const roomId = item.dataset.roomId;
    const joinBtn = item.querySelector('.btn-join-room');
    joinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      myPseudo = document.getElementById('input-pseudo').value.trim();
      if (!myPseudo) return showError('Entre un pseudo d\'abord');
      socket.emit('join_room', { room_id: roomId, pseudo: myPseudo });
    });
  });
});

// Actualiser la liste des rooms
document.getElementById('btn-refresh-rooms').addEventListener('click', () => {
  loadAvailableRooms();
});

// Actualiser automatiquement quand les rooms changent
socket.on('rooms_changed', () => {
  // Seulement si l'onglet "rejoindre" est actif
  const joinTab = document.getElementById('tab-join');
  if (joinTab && joinTab.classList.contains('active')) {
    loadAvailableRooms();
  }
});

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
  hide('screen-gameover');
  show('screen-game');
  document.getElementById('btn-replay').disabled = false;
  document.getElementById('replay-waiting-msg').classList.add('hidden');
  clearTable();
  lastPlayedCardType = null;
  myHand = shuffleHand(gameState.hand || []);
  opponentHandCount = 5;
  document.getElementById('scores').textContent =
    gameState.players.map((p) => p.pseudo + ': 0').join(' | ');
  document.getElementById('round-number').textContent = '1';
  document.getElementById('round-result').textContent = '';
  renderHand(myHand, false);
  renderOpponentHand(5);
});

socket.on('waiting_opponent', () => {
  document.getElementById('round-result').textContent = "⏳ En attente de l'adversaire...";
});

socket.on('opponent_played', function () {
  playOpponentCardToTable();
  var alreadyPlayed = document.getElementById('table-slot-mine').querySelector('.card');
  document.getElementById('round-result').textContent = alreadyPlayed
    ? "⏳ L'adversaire a joué sa carte..."
    : "⏳ À toi de jouer !";
});

socket.on('round_result', (result) => {
  const myCard = result.plays[socket.id];
  const opEntry = Object.entries(result.plays).find((e) => e[0] !== socket.id);
  const opCard = opEntry ? opEntry[1] : 'citizen';
  const won = result.winner === socket.id;
  const draw = result.winner === null;

  document.getElementById('round-number').textContent = result.round;
  document.getElementById('scores').textContent =
    Object.entries(result.scores)
      .map((e) => (e[0] === socket.id ? 'Toi' : 'Adv') + ': ' + e[1])
      .join(' | ');

  opponentHandCount = 5 - result.round;
  const resultMessage = draw ? '🤝 Égalité' : won ? '✅ Round gagné' : '❌ Round perdu';

  // Message pendant la révélation
  document.getElementById('round-result').textContent = "🃏 Révélation des cartes...";

  revealTableCards(lastPlayedCardType || myCard, opCard, () => {
    // Afficher le résultat du round
    document.getElementById('round-result').textContent = resultMessage;

    // Attendre un peu pour que le joueur voie le résultat
    delay(800).then(() => {
      clearTable();
      if (result.hand) myHand = shuffleHand(result.hand);
      renderHand(myHand, false);
      renderOpponentHand(opponentHandCount);
      lastPlayedCardType = null;
      document.getElementById('round-result').textContent = '';
    });
  });
});

socket.on('game_over', (winner) => {
  // Attendre que l'animation du dernier round soit terminée (environ 8 secondes)
  delay(8000).then(() => {
    hide('screen-game');
    show('screen-gameover');
    const draw = winner === null;
    const won = winner && winner.id === socket.id;
    document.getElementById('winner-text').textContent =
      draw ? '🤝 Match nul !' : won ? '🏆 Tu as gagné !' : '💀 Tu as perdu...';
  });
});

document.getElementById('btn-replay').addEventListener('click', () => {
  if (!currentRoomId) return showError('Erreur: room perdue');
  socket.emit('request_replay', { room_id: currentRoomId });
  document.getElementById('replay-waiting-msg').classList.remove('hidden');
  document.getElementById('btn-replay').disabled = true;
});

socket.on('replay_waiting', () => {
  document.getElementById('replay-waiting-msg').classList.remove('hidden');
  document.getElementById('btn-replay').disabled = true;
});

socket.on('error', function(data) { showError(data.message); });
