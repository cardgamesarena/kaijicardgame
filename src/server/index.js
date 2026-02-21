const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const roomManager = require('./roomManager');
const { getGameStateForPlayer } = require('./games/kaiji');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../../src/client')));

app.get('/health', (req, res) => res.sendStatus(200));

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
    result.room.players.forEach((p) => {
      io.to(p.id).emit('game_started', getGameStateForPlayer(result.gameState, p.id));
    });
  });

  socket.on('request_replay', ({ room_id }) => {
    const result = roomManager.requestReplay(room_id, socket.id);
    if (result.error) return socket.emit('error', { message: result.error });
    if (result.waitingOpponent) return socket.emit('replay_waiting');
    if (result.started) {
      result.room.players.forEach((p) => {
        io.to(p.id).emit('game_started', getGameStateForPlayer(result.gameState, p.id));
      });
    }
  });

  socket.on('play_card', ({ room_id, card }) => {
    const result = roomManager.playCard(room_id, socket.id, card);
    if (result.error) return socket.emit('error', { message: result.error });
    if (result.waiting) {
      socket.emit('waiting_opponent');
      socket.to(room_id).emit('opponent_played');
      return;
    }
    const playerIds = Object.keys(result.roundResult.plays);
    playerIds.forEach((playerId) => {
      io.to(playerId).emit('round_result', {
        ...result.roundResult,
        hand: result.hands[playerId],
      });
    });
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
