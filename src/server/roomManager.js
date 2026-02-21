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
  return { gameState: room.gameState, room };
}

function playCard(room_id, socketId, card) {
  const room = rooms[room_id];
  if (!room || room.status !== 'playing') return { error: 'Partie non active' };
  const result = playCardGame(room.gameState, socketId, card);
  if (result.error) return result;
  if (result.waiting) return { waiting: true };
  const gameOver = checkGameOver(room.gameState);
  const payload = {
    roundResult: result.roundResult,
    hands: room.gameState.hands,
  };
  if (gameOver) {
    room.status = 'finished';
    room.lastRoles = room.gameState.roles;
    room.replayReady = {};
    return { ...payload, gameOver: true, winner: gameOver.winner };
  }
  return payload;
}

function requestReplay(room_id, socketId) {
  const room = rooms[room_id];
  if (!room) return { error: 'Room introuvable' };
  if (room.status !== 'finished') return { error: 'Aucune partie terminée à rejouer' };
  if (!room.players.find(p => p.id === socketId)) return { error: 'Tu n\'es pas dans cette room' };

  room.replayReady = room.replayReady || {};
  room.replayReady[socketId] = true;

  const bothReady = room.players.length === 2 && room.players.every((p) => room.replayReady[p.id]);
  if (!bothReady) return { waitingOpponent: true };

  room.status = 'playing';
  room.gameState = createGameState(room.players, room.lastRoles);
  room.replayReady = {};
  return { gameState: room.gameState, room, started: true };
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

function getAvailableRooms() {
  return Object.values(rooms)
    .filter(room => room.status === 'waiting' && room.players.length < 2)
    .map(room => ({
      id: room.id,
      players: room.players.map(p => ({ pseudo: p.pseudo })),
      playerCount: room.players.length,
      maxPlayers: 2
    }));
}

module.exports = { createRoom, joinRoom, startGame, playCard, requestReplay, removePlayer, getAvailableRooms };
