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
  // FOLD,
  // CHECK,
  // CALL,
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
  SET_TURN
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

  socket.on(JOIN_TABLE, ({ id, name, bet, isPrivate, createdAt }) => {

    let tableExists = false;

    Object.keys(tables).forEach(tableId => {
      if (tableId === id) {
        return tableExists = true;
      }
    });

    // Si aucune table avec cet id n'existe, on l'ajoute
    if (!tableExists) {
      tables[id] = new Table(id, name, bet, isPrivate, createdAt);
    }

    const player = players[socket.id];

    // Ajout du joueur à la table
    tables[id].addPlayer(player);

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


  socket.on(PLAY_ONE_CARD, ({ tableId, seatId, playedCard }) => {
    console.log("on socket PLAY_ONE_CARD");

    let table = tables[tableId];
    let seat = table.seats[seatId];

    console.log("seat from index : ", seat);
    console.log("seat turn from index : ", seat.turn);

    if (seat && seat.turn) {

      // Vérifier si la carte peut être jouée selon les règles
      if (table.canPlayCard(seatId, playedCard)) {
        // Nettoyer le timer puisque le joueur a joué à temps
        table.clearTurnTimer();

        // Si c'est la première carte du tour, définir la couleur demandée
        if (table.currentRoundCards.length === 0) {
          table.demandedSuit = playedCard.suit;
          console.log(`New demanded suit: ${playedCard.suit}`);
        }

        // Jouer la carte
        seat.playOneCard(playedCard);

        // Ajouter la carte à l'historique du tour
        table.currentRoundCards.push({
          seatId: seatId,
          card: playedCard
        });

        // Informer le joueur que sa carte a été jouée
        socket.emit(PLAYED_CARD, {
          tables: getCurrentTables(),
          tableId,
          seatId
        });

        // Passer au joueur suivant et démarrer son timer
        changeTurnAndBroadcast(table, seatId);
      } else {
        console.log(`Invalid card played: ${playedCard.suit} ${playedCard.rank}. Must follow suit: ${table.demandedSuit}`);
        // Informer le joueur que la carte n'est pas valide
        socket.emit(TABLE_MESSAGE, {
          message: `Vous devez jouer une carte de ${table.demandedSuit} si possible`,
          from: 'System'
        });
      }
    } else {
      console.log("wait for your turn");
    }
  });

  // socket.on(CHECK, (tableId) => {
  //   let table = tables[tableId];
  //   let res = table.handleCheck(socket.id);
  //   res && broadcastToTable(table, res.message);
  //   res && changeTurnAndBroadcast(table, res.seatId);
  // });

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

      // La partie commence quand 2 joueurs sont assis
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
    // Changer de tour immédiatement
    table.changeTurn(seatId);
    io.to(table.seats[seatId].player.socketId).emit(SET_TURN, {
      tables: getCurrentTables(),
      tableId: table.id,
      seatId: seatId
    });
    broadcastToTable(table);

    // Si la main n'est pas terminée, démarrer le timer pour le prochain joueur
    if (!table.handOver && table.turn) {
      table.startTurnTimer(
        table.turn,
        (nextSeatId) => {
          // Quand le timer expire, jouer une carte automatiquement
          const result = table.playRandomCard(nextSeatId);
          if (result) {
            // Émettre l'événement PLAYED_CARD pour informer les clients
            io.to(table.seats[nextSeatId].player.socketId).emit(PLAYED_CARD, {
              tables: getCurrentTables(),
              tableId: table.id,
              seatId: nextSeatId
            });
            // Passer au joueur suivant
            changeTurnAndBroadcast(table, nextSeatId);
          }
        });

    } else if (table.handOver) {
      // Démarrer une nouvelle main
      initNewHand(table);
    }
  }

  function initNewHand(table) {
    if (table.activePlayers().length > 1) {
      broadcastToTable(table, '---New hand starting in 5 seconds---');
    }
    setTimeout(() => {
      table.clearWinMessages();
      table.startHand();

      // Démarrer le timer pour le premier joueur
      if (table.turn && !table.handOver) {

        broadcastToTable(table, '--- New hand started ---');
        table.startTurnTimer(
          table.turn,
          (seatId) => {
            // Callback appelé quand le timer expire pour le premier joueur
            const result = table.playRandomCard(seatId);
            if (result) {
              // Émettre l'événement PLAYED_CARD pour informer les clients
              io.to(table.seats[seatId].player.socketId).emit(PLAYED_CARD, {
                tables: getCurrentTables(),
                tableId: table.id,
                seatId: seatId
              });
            }
            // Changer de tour et diffuser les mises à jour
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
    broadcastToTable(table, 'Waiting for more players');
  }

  function hideOpponentCards(table, socketId) {
    // Créer une copie de la table en excluant les propriétés qui causent des références circulaires
    let tableCopy = {
      ...table,
      turnTimer: null, // Exclure le timer pour éviter les références circulaires
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
        // Créer un tableau de cartes cachées de la même taille que la main du joueur
        seat.hand = Array(seat.hand.length).fill(hiddenCard);
      }
    }
    return tableCopy;
  }
};

module.exports = { init };