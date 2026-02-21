const CARDS = ['emperor', 'citizen', 'slave'];

const BEATS = {
  emperor: 'citizen',
  citizen: 'slave',
  slave: 'emperor',
};

const HAND_EMPEROR = ['citizen', 'citizen', 'citizen', 'citizen', 'emperor'];
const HAND_SLAVE = ['citizen', 'citizen', 'citizen', 'citizen', 'slave'];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createGameState(players, lastRoles) {
  const [p1, p2] = players;
  let roles;
  let hands;
  if (lastRoles && lastRoles[p1.id] != null) {
    // Rematch : inverser les rôles (celui qui avait esclave a empereur et vice versa)
    roles = {
      [p1.id]: lastRoles[p1.id] === 'emperor' ? 'slave' : 'emperor',
      [p2.id]: lastRoles[p2.id] === 'emperor' ? 'slave' : 'emperor',
    };
    hands = {
      [p1.id]: shuffle(roles[p1.id] === 'emperor' ? [...HAND_EMPEROR] : [...HAND_SLAVE]),
      [p2.id]: shuffle(roles[p2.id] === 'emperor' ? [...HAND_EMPEROR] : [...HAND_SLAVE]),
    };
  } else {
    const firstGetsEmperor = Math.random() < 0.5;
    roles = {
      [p1.id]: firstGetsEmperor ? 'emperor' : 'slave',
      [p2.id]: firstGetsEmperor ? 'slave' : 'emperor',
    };
    hands = {
      [p1.id]: shuffle(roles[p1.id] === 'emperor' ? [...HAND_EMPEROR] : [...HAND_SLAVE]),
      [p2.id]: shuffle(roles[p2.id] === 'emperor' ? [...HAND_EMPEROR] : [...HAND_SLAVE]),
    };
  }
  return {
    players: players.map(p => ({ id: p.id, pseudo: p.pseudo, score: 0 })),
    round: 1,
    maxRounds: 5,
    currentPlays: {},
    hands,
    roles,
  };
}

function getGameStateForPlayer(gameState, playerId) {
  const { hands, ...rest } = gameState;
  return { ...rest, hand: hands ? [...(hands[playerId] || [])] : [] };
}

function playCard(gameState, socketId, card) {
  if (!CARDS.includes(card)) return { error: 'Carte invalide' };
  if (gameState.currentPlays[socketId]) return { error: 'Carte déjà jouée ce round' };

  const hand = gameState.hands[socketId];
  if (!hand || !hand.includes(card)) return { error: "Tu n'as pas cette carte en main" };

  const idx = hand.indexOf(card);
  hand.splice(idx, 1);
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

  // Dès qu'un joueur révèle Empereur ou Esclave, la partie s'arrête (l'autre sait qu'il ne reste que des citoyens)
  const specialPlayed = card1 === 'emperor' || card1 === 'slave' || card2 === 'emperor' || card2 === 'slave';
  if (specialPlayed) gameState.round = gameState.maxRounds + 1;

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

module.exports = { createGameState, playCard, checkGameOver, getGameStateForPlayer };
