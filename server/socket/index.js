const User = require('../models/User');
const jwt = require('jsonwebtoken');
const Table = require('../pokergame/Table');
const Player = require('../pokergame/Player');
const Seat = require('../pokergame/Seat');
const {
  FETCH_LOBBY_INFO,
  RECEIVE_LOBBY_INFO,
  PLAYERS_UPDATED,
  JOIN_TABLE,
  TABLE_JOINED,
  TABLES_UPDATED,
  LEAVE_TABLE,
  TABLE_LEFT,
  TABLE_MESSAGE,
  SIT_DOWN,
  REBUY,
  STAND_UP,
  SITTING_OUT,
  SITTING_IN,
  DISCONNECT,
  TABLE_UPDATED,
  WINNER,
  PLAY_ONE_CARD,
  PLAYED_CARD,
} = require('../pokergame/actions');
const config = require('../config');

const tables = {};
const players = {};

function getCurrentPlayers() {
  return Object.values(players).map((player) => ({
    socketId: player.socketId,
    id: player.id,
    name: player.name,
  }));
}

function getCurrentTables() {
  return Object.values(tables).map((table) => ({
    id: table.id,
    name: table.name,
    bet: table.bet,
    isPrivate: table.isPrivate,
    createdAt: table.createdAt,
    maxPlayers: table.maxPlayers,
    currentNumberPlayers: table.players.length,
    smallBlind: table.bet,
    bigBlind: table.bet * 2,
  }));
}

const init = (socket, io) => {
  socket.on(FETCH_LOBBY_INFO, async (token) => {
    let user;

    jwt.verify(token, config.JWT_SECRET, (err, decoded) => {
      if (err) return;
      user = decoded.user;
    });

    if (user) {
      const found = Object.values(players).find((player) => {
        return player.id == user.id;
      });

      if (found) {
        delete players[found.socketId];
        Object.values(tables).map((table) => {
          table.removePlayer(found.socketId);
          broadcastToTable(table, null, 'Le katika');
        });
      }

      const userInfo = await User.findById(user.id).select('-password');

      players[socket.id] = new Player(
        socket.id,
        userInfo._id,
        userInfo.name,
        userInfo.chipsAmount,
      );

      socket.emit(RECEIVE_LOBBY_INFO, {
        tables: getCurrentTables(),
        players: getCurrentPlayers(),
        socketId: socket.id,
      });
      socket.broadcast.emit(PLAYERS_UPDATED, getCurrentPlayers());
    }
  });

  socket.on(JOIN_TABLE, ({ id, name, bet, isPrivate, createdAt }) => {
    let tableExists = false;

    Object.keys(tables).forEach(tableId => {
      if (tableId === id) {
        return tableExists = true;
      }
    });

    if (!tableExists) {
      tables[id] = new Table(id, name, bet, isPrivate, createdAt);
    }

    const player = players[socket.id];

    tables[id].addPlayer(player);

    socket.emit(TABLE_JOINED, { tables: getCurrentTables(), id });
    socket.broadcast.emit(TABLES_UPDATED, getCurrentTables());

    if (
      tables[id].players &&
      tables[id].players.length > 0 &&
      player
    ) {
      let message = `${player.name} joined the table.`;
      broadcastToTable(tables[id], message, 'Le katika');
    }
  });

  socket.on(LEAVE_TABLE, (tableId) => {
    const table = tables[tableId];
    const player = players[socket.id];
    const seat = Object.values(table.seats).find(
      (seat) => seat && seat.player.socketId === socket.id,
    );

    if (seat && player) {
      updatePlayerBankroll(player, seat.stack);
    }

    table.removePlayer(socket.id);

    if (table.players.length == 0) {
      delete tables[tableId];
    }

    socket.broadcast.emit(TABLES_UPDATED, getCurrentTables());
    socket.emit(TABLE_LEFT, { tables: getCurrentTables(), tableId });

    if (
      tables[tableId] &&
      tables[tableId].players &&
      tables[tableId].players.length > 0 &&
      player
    ) {
      let message = `${player.name} left the table.`;
      broadcastToTable(table, message, 'Le katika');
    }

    if (table.activePlayers().length === 1) {
      clearForOnePlayer(table);
    }

    socket.emit(RECEIVE_LOBBY_INFO, {
      tables: getCurrentTables(),
      players: getCurrentPlayers(),
      socketId: socket.id,
    });
  });

  socket.on(PLAY_ONE_CARD, ({ tableId, seatId, playedCard }) => {
    let table = tables[tableId];
    let seat = table.seats[seatId];

    if (seat && seat.turn) {
      if (table.canPlayCard(seatId, playedCard)) {
        table.clearTurnTimer();

        if (table.currentRoundCards.length === 0) {
          table.demandedSuit = playedCard.suit;
        }

        seat.playOneCard(playedCard);

        table.currentRoundCards.push({
          seatId: seatId,
          card: playedCard
        });

        socket.emit(PLAYED_CARD, {
          tables: getCurrentTables(),
          tableId,
          seatId
        });

        changeTurnAndBroadcast(table, seatId);
      } else {
        socket.emit(TABLE_MESSAGE, {
          message: `Vous devez jouer une carte de ${table.demandedSuit} si possible`,
          from: 'Katika'
        });
      }
    }
  });

  socket.on(TABLE_MESSAGE, ({ message, from, tableId }) => {
    let table = tables[tableId];
    broadcastToTable(table, message, from);
  });

  socket.on(SIT_DOWN, ({ tableId, seatId, amount }) => {
    const table = tables[tableId];
    const player = players[socket.id];

    if (player) {
      table.sitPlayer(player, seatId, amount);
      let message = `${player.name} sat down in Seat ${seatId}`;
      updatePlayerBankroll(player, -amount);
      broadcastToTable(table, message, 'Le katika');

      if (table.activePlayers().length === 2) {
        initNewHand(table);
      }
    }
  });

  socket.on(REBUY, ({ tableId, seatId, amount }) => {
    const table = tables[tableId];
    const player = players[socket.id];

    table.rebuyPlayer(seatId, amount);
    updatePlayerBankroll(player, -amount);

    broadcastToTable(table, null, 'Le katika');
  });

  socket.on(STAND_UP, (tableId) => {
    const table = tables[tableId];
    const player = players[socket.id];
    const seat = Object.values(table.seats).find(
      (seat) => seat && seat.player.socketId === socket.id,
    );

    let message = '';
    if (seat) {
      updatePlayerBankroll(player, seat.stack);
      message = `${player.name} left the table`;
    }

    table.standPlayer(socket.id);

    broadcastToTable(table, message, 'Le katika');
    if (table.activePlayers().length === 1) {
      clearForOnePlayer(table);
    }

    if (table.activePlayers().length > 1) {
      initNewHand(table);
    }
  });

  socket.on(SITTING_OUT, ({ tableId, seatId }) => {
    const table = tables[tableId];
    const seat = table.seats[seatId];
    seat.sittingOut = true;

    broadcastToTable(table, null, 'Le katika');

    if (table.activePlayers().length > 1) {
      initNewHand(table);
    }
  });

  socket.on(SITTING_IN, ({ tableId, seatId }) => {
    const table = tables[tableId];
    const seat = table.seats[seatId];
    seat.sittingOut = false;

    broadcastToTable(table, null, 'Le katika');
    if (table.handOver && table.activePlayers().length > 1) {
      initNewHand(table);
    }
  });

  socket.on(DISCONNECT, () => {
    const seat = findSeatBySocketId(socket.id);
    if (seat) {
      updatePlayerBankroll(seat.player, seat.stack);
    }

    delete players[socket.id];
    removeFromTables(socket.id);

    socket.broadcast.emit(TABLES_UPDATED, getCurrentTables());
    socket.broadcast.emit(PLAYERS_UPDATED, getCurrentPlayers());
  });

  async function updatePlayerBankroll(player, amount) {
    const user = await User.findById(player.id);
    user.chipsAmount += amount;
    await user.save();

    players[socket.id].bankroll += amount;
    io.to(socket.id).emit(PLAYERS_UPDATED, getCurrentPlayers());
  }

  function findSeatBySocketId(socketId) {
    let foundSeat = null;
    Object.values(tables).forEach((table) => {
      Object.values(table.seats).forEach((seat) => {
        if (seat && seat.player.socketId === socketId) {
          foundSeat = seat;
        }
      });
    });
    return foundSeat;
  }

  function removeFromTables(socketId) {
    for (let i = 0; i < Object.keys(tables).length; i++) {
      tables[Object.keys(tables)[i]].removePlayer(socketId);
    }
  }

  function broadcastToTable(table, message = null, from = null) {
    for (let i = 0; i < table.players.length; i++) {
      let socketId = table.players[i].socketId;
      let tableCopy = hideOpponentCards(table, socketId);
      io.to(socketId).emit(TABLE_UPDATED, {
        table: tableCopy,
        message,
        from,
      });
    }
  }

  function changeTurnAndBroadcast(table, seatId) {
    table.changeTurn(seatId);

    if (!table.handOver && table.turn) {
      broadcastToTable(table, `---Le tour passe---`, 'Le katika');
      table.startTurnTimer(
        table.turn,
        (nextSeatId) => {
          const result = table.playRandomCard(nextSeatId);
          if (result) {
            io.to(table.seats[nextSeatId].player.socketId).emit(PLAYED_CARD, {
              tables: getCurrentTables(),
              tableId: table.id,
              seatId: nextSeatId
            });
            changeTurnAndBroadcast(table, nextSeatId);
          }
        });
    } else if (table.handOver) {
      // Diffuser les messages de victoire s'il y en a
      if (table.winMessages && table.winMessages.length > 0) {
        table.winMessages.forEach(winMessage => {
          broadcastToTable(table, winMessage, 'Le katika');
        });
      }

      // Diffuser l'état de la table après la victoire
      broadcastToTable(table, null, 'Le katika');

      // Démarrer une nouvelle main immédiatement
      // (initNewHand gère son propre délai de 5 secondes)
      if (table && table.activePlayers().length > 1) {
        initNewHand(table);
      }
    }
  }

  function initNewHand(table) {
    if (table.activePlayers().length > 1) {
      broadcastToTable(table, '---New hand starting in 5 seconds---', 'Le katika');
    }
    setTimeout(() => {
      table.clearWinMessages();
      table.startHand();

      if (table.turn && !table.handOver) {
        broadcastToTable(table, '--- New hand started ---', 'Le katika');
        table.startTurnTimer(
          table.turn,
          (seatId) => {
            const result = table.playRandomCard(seatId);
            if (result) {
              io.to(table.seats[seatId].player.socketId).emit(PLAYED_CARD, {
                tables: getCurrentTables(),
                tableId: table.id,
                seatId: seatId
              });
            }
            changeTurnAndBroadcast(table, seatId);
          });
      }
    }, 5000);
  }

  function clearForOnePlayer(table) {
    table.clearWinMessages();
    table.clearSeatHands();
    table.clearSeatPlayedHands();
    table.resetPot();
    broadcastToTable(table, 'Waiting for more players', 'Le katika');
  }

  function hideOpponentCards(table, socketId) {
    let tableCopy = {
      ...table,
      turnTimer: null,
    };
    tableCopy = JSON.parse(JSON.stringify(tableCopy));
    let hiddenCard = { suit: 'hidden', rank: 'hidden' };

    for (let i = 1; i <= tableCopy.maxPlayers; i++) {
      let seat = tableCopy.seats[i];
      if (
        seat &&
        seat.hand.length > 0
        &&
        seat.player.socketId !== socketId &&
        !(seat.lastAction === WINNER && tableCopy.wentToShowdown)
      ) {
        seat.hand = Array(seat.hand.length).fill(hiddenCard);
      }
    }
    return tableCopy;
  }
};

module.exports = { init };
