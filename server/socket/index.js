const User = require('../models/User');
const jwt = require('jsonwebtoken');
const Table = require('../pokergame/Table');
const Player = require('../pokergame/Player');
const {
  FETCH_LOBBY_INFO,
  RECEIVE_LOBBY_INFO,
  PLAYERS_UPDATED,
  JOIN_TABLE,
  TABLE_JOINED,
  TABLES_UPDATED,
  LEAVE_TABLE,
  TABLE_LEFT,
  FOLD,
  CHECK,
  CALL,
  RAISE,
  TABLE_MESSAGE,
  SIT_DOWN,
  REBUY,
  STAND_UP,
  SITTING_OUT,
  SITTING_IN,
  DISCONNECT,
  TABLE_UPDATED,
  WINNER,
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
    price: table.price,
    isPrivate: table.isPrivate,
    createdAt: table.createdAt,
    maxPlayers: table.maxPlayers,
    currentNumberPlayers: table.players.length,
    smallBlind: table.price,
    bigBlind: table.price * 2,
  }));
}

const init = (socket, io) => {
  socket.on(FETCH_LOBBY_INFO, async (token) => {
    let user;

    jwt.verify(token, config.JWT_SECRET, (err, decoded) => {
      if (err) console.log(err);
      else {
        user = decoded.user;
      }
    });

    if (user) {
      const found = Object.values(players).find((player) => {
        return player.id == user.id;
      });

      if (found) {
        delete players[found.socketId];
        Object.values(tables).map((table) => {
          table.removePlayer(found.socketId);
          broadcastToTable(table);
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

  socket.on(JOIN_TABLE, ({ id, name, price, isPrivate, createdAt }) => {

    let tableExists = false;

    Object.keys(tables).forEach(tableId => {
      if (tableId === id) {
        return tableExists = true;
      }
    });

    // Si aucune table avec cet id n'existe, on l'ajoute
    if (!tableExists) {
      tables[id] = new Table(id, name, price, isPrivate, createdAt);
    }

    const player = players[socket.id];

    // console.log(`Avant ajout de ${player.name}`);
    // console.log(tables[id].players);

    // Ajout du joueur à la table
    tables[id].addPlayer(player);

    // console.log(`Après ajout de ${player.name}`);
    // console.log(tables[id].players);

    socket.emit(TABLE_JOINED, { tables: getCurrentTables(), id });
    socket.broadcast.emit(TABLES_UPDATED, getCurrentTables());

    if (
      tables[id].players &&
      tables[id].players.length > 0 &&
      player
    ) {
      let message = `${player.name} joined the table.`;
      broadcastToTable(tables[id], message);
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
      console.log(`table with id = ${tableId} deleted`);
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
      broadcastToTable(table, message);
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

  socket.on(FOLD, (tableId) => {
    let table = tables[tableId];
    let res = table.handleFold(socket.id);
    res && broadcastToTable(table, res.message);
    res && changeTurnAndBroadcast(table, res.seatId);
  });

  socket.on(CHECK, (tableId) => {
    let table = tables[tableId];
    let res = table.handleCheck(socket.id);
    res && broadcastToTable(table, res.message);
    res && changeTurnAndBroadcast(table, res.seatId);
  });

  socket.on(CALL, (tableId) => {
    let table = tables[tableId];
    let res = table.handleCall(socket.id);
    res && broadcastToTable(table, res.message);
    res && changeTurnAndBroadcast(table, res.seatId);
  });

  socket.on(RAISE, ({ tableId, amount }) => {
    let table = tables[tableId];
    let res = table.handleRaise(socket.id, amount);
    res && broadcastToTable(table, res.message);
    res && changeTurnAndBroadcast(table, res.seatId);
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

      broadcastToTable(table, message);
      // if (table.activePlayers().length === 2) {
      //   initNewHand(table);
      // }

      socket.emit(RECEIVE_LOBBY_INFO, {
        tables: getCurrentTables(),
        players: getCurrentPlayers(),
        socketId: socket.id,
      });
    }
  });

  socket.on(REBUY, ({ tableId, seatId, amount }) => {
    const table = tables[tableId];
    const player = players[socket.id];

    table.rebuyPlayer(seatId, amount);
    updatePlayerBankroll(player, -amount);

    broadcastToTable(table);
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

    broadcastToTable(table, message);
    if (table.activePlayers().length === 1) {
      clearForOnePlayer(table);
    }
  });

  socket.on(SITTING_OUT, ({ tableId, seatId }) => {
    const table = tables[tableId];
    const seat = table.seats[seatId];
    seat.sittingOut = true;

    broadcastToTable(table);
  });

  socket.on(SITTING_IN, ({ tableId, seatId }) => {
    const table = tables[tableId];
    const seat = table.seats[seatId];
    seat.sittingOut = false;

    broadcastToTable(table);
    if (table.handOver && table.activePlayers().length === 2) {
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
    setTimeout(() => {
      table.changeTurn(seatId);
      broadcastToTable(table);

      if (table.handOver) {
        initNewHand(table);
      }
    }, 1000);
  }

  function initNewHand(table) {
    if (table.activePlayers().length > 1) {
      broadcastToTable(table, '---New hand starting in 5 seconds---');
    }
    setTimeout(() => {
      table.clearWinMessages();
      table.startHand();
      broadcastToTable(table, '--- New hand started ---');
    }, 5000);
  }

  function clearForOnePlayer(table) {
    table.clearWinMessages();
    setTimeout(() => {
      table.clearSeatHands();
      table.resetBoardAndPot();
      broadcastToTable(table, 'Waiting for more players');
    }, 5000);
  }

  function hideOpponentCards(table, socketId) {
    let tableCopy = JSON.parse(JSON.stringify(table));
    let hiddenCard = { suit: 'hidden', rank: 'hidden' };
    let hiddenHand = [hiddenCard, hiddenCard];

    for (let i = 1; i <= tableCopy.maxPlayers; i++) {
      let seat = tableCopy.seats[i];
      if (
        seat &&
        seat.hand.length > 0
        &&
        seat.player.socketId !== socketId &&
        !(seat.lastAction === WINNER && tableCopy.wentToShowdown)
      ) {
        seat.hand = hiddenHand;
      }
    }
    return tableCopy;
  }
};

module.exports = { init };
