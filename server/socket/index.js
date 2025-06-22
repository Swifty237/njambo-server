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
  SHOW_DOWN,
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
      // Configurer les callbacks dès la création de la table
      setupTableCallbacks(tables[id]);
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

    // Vérifier si la table existe
    if (!table) {
      socket.emit(TABLE_LEFT, { tables: getCurrentTables(), tableId });
      socket.emit(RECEIVE_LOBBY_INFO, {
        tables: getCurrentTables(),
        players: getCurrentPlayers(),
        socketId: socket.id,
      });
      return;
    }

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
      // Vérifier si c'est le premier joueur du tour
      const isFirstPlayer = table.currentRoundCards.length === 0;

      if (isFirstPlayer || table.canPlayCard(seatId, playedCard)) {
        table.clearTurnTimer();

        if (isFirstPlayer) {
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
          message: `Vous devez jouer une carte de ${table.demandedSuit}`,
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

      // Ne pas démarrer de nouvelle main si une main est en cours
      if (table.handOver && table.currentHandPlayers().length > 1) {
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

    if (!table) {
      console.error(`Table ${tableId} not found for STAND_UP`);
      return;
    }

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

    // Ne pas démarrer de nouvelle main si une main est en cours
    if (table.handOver && table.currentHandPlayers().length > 1) {
      initNewHand(table);
    }
  });

  socket.on(SITTING_OUT, ({ tableId, seatId }) => {
    const table = tables[tableId];
    const seat = table.seats[seatId];

    // Si une main est en cours et que ce joueur y participe, 
    // on attend la fin de la main avant de le mettre en sitout
    if (!table.handOver && seat.hand && seat.hand.length > 0) {
      seat.wantsSitout = true;  // Marquer qu'il veut passer en sitout
      broadcastToTable(table, `${seat.player.name} passera en pause à la fin de la main`, 'Le katika');
    } else {
      seat.sittingOut = true;
      broadcastToTable(table, `${seat.player.name} est en pause`, 'Le katika');
    }

    // Ne démarrer une nouvelle main que si la main en cours est terminée
    if (table.handOver && table.currentHandPlayers().length > 1) {
      initNewHand(table);
    }
  });

  socket.on(SITTING_IN, ({ tableId, seatId }) => {
    const table = tables[tableId];
    const seat = table.seats[seatId];

    // Si une main est en cours, le joueur ne sera actif qu'à la prochaine main
    if (!table.handOver) {
      seat.wantsSitin = true;  // Marquer qu'il veut revenir au jeu
      broadcastToTable(table, `${seat.player.name} rejoindra la prochaine main`, 'Le katika');
    } else {
      seat.sittingOut = false;
      broadcastToTable(table, `${seat.player.name} est de retour`, 'Le katika');
    }

    // Ne démarrer une nouvelle main que si la main en cours est terminée
    if (table.handOver && table.currentHandPlayers().length > 1) {
      initNewHand(table);
    }
  });

  socket.on(SHOW_DOWN, ({ tableId, seatId }) => {
    const table = tables[tableId];
    const seat = table.seats[seatId];

    if (seat && seat.player.socketId === socket.id) {
      // Basculer l'état showingCards
      const isShowingCards = !seat.showingCards;
      seat.showingCards = isShowingCards;

      let message = isShowingCards
        ? `${seat.player.name} montre ses cartes`
        : `${seat.player.name} cache ses cartes`;
      broadcastToTable(table, message, 'Le katika');

      // Ne vérifier les combinaisons que si le joueur montre ses cartes
      if (isShowingCards) {
        const winnerByCombination = table.determinePotWinner();

        // Si une combinaison gagnante est trouvée
        if (winnerByCombination && table.lastWinningSeat === winnerByCombination) {
          message = `${seat.player.name} a une combinaison gagnante`;
          broadcastToTable(table, message, 'Le katika');

          // Terminer la main actuelle et en démarrer une nouvelle
          table.endHand();

          // Ne pas démarrer de nouvelle main si une main est en cours
          if (table.handOver && table.currentHandPlayers().length > 1) {
            initNewHand(table);
          }
        }
      }
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

  // Fonction pour configurer les callbacks de la table
  function setupTableCallbacks(table) {
    // Callback pour le jeu automatique
    table.onAutoPlayCard = (seatId, playedCard) => {
      // Notifier tous les joueurs qu'une carte a été jouée automatiquement
      if (table.seats[seatId]) {
        let seat = table.seats[seatId];

        seat.playOneCard(playedCard);

        table.currentRoundCards.push({
          seatId: seatId,
          card: playedCard
        });
        console.log(`[chooseRandomCard] Added card to current round cards. Total cards: ${table.currentRoundCards.length}`);

        socket.emit(PLAYED_CARD, {
          tables: getCurrentTables(),
          tableId: table.id,
          seatId
        });

        changeTurnAndBroadcast(table, seatId);
      }
    };

    // Callback pour la fin de la main
    table.onHandComplete = () => {
      console.log(`[onHandComplete] Hand completed for table ${table.id}`);

      // Diffuser les messages de victoire
      if (table.winMessages && table.winMessages.length > 0) {
        table.winMessages.forEach(message => {
          broadcastToTable(table, message, 'Le katika');
        });
      }

      // Diffuser l'état final de la table
      broadcastToTable(table, null, 'Le katika');

      // Marquer que la main est terminée pour éviter les doubles démarrages
      table.handCompleted = true;

      // Attendre un peu avant de démarrer une nouvelle main
      setTimeout(() => {
        const activePlayers = table.currentHandPlayers();
        if (activePlayers.length > 1) {
          console.log(`[onHandComplete] Starting new hand with ${activePlayers.length} players`);
          table.handCompleted = false; // Réinitialiser pour la prochaine main
          initNewHand(table);
        } else {
          console.log(`[onHandComplete] Not enough players (${activePlayers.length}) for new hand`);
          broadcastToTable(table, 'En attente de plus de joueurs pour commencer une nouvelle main', 'Le katika');
        }
      }, 3000);
    };
  }

  function changeTurnAndBroadcast(table, seatId) {
    // Nettoyer l'ancien timer avant de changer de tour
    table.clearTurnTimer();

    // Éviter les changements de tour pendant que la main est terminée
    if (table.handCompleted) {
      return;
    }

    table.changeTurn(seatId);

    // Configurer les callbacks de la table après le changement de tour
    setupTableCallbacks(table);

    if (!table.handOver && table.turn) {
      broadcastToTable(table, `---Le tour passe---`, 'Le katika');

      // Le timer est maintenant géré dans updateSeatsForNewTurn
    } else if (table.handOver && !table.handCompleted) {
      console.log(`[changeTurnAndBroadcast] Hand is over, processing end of hand`);

      // Annoncer le gagnant du dernier tour
      const lastRoundWinner = table.seats[table.lastWinningSeat];
      if (lastRoundWinner) {
        const roundWinMessage = `${lastRoundWinner.player.name} gagne le dernier tour!`;
        broadcastToTable(table, roundWinMessage, 'Le katika');
      }

      // Attendre un peu avant de démarrer une nouvelle main
      setTimeout(() => {
        console.log(`[changeTurnAndBroadcast] Checking if new hand should start`);
        const activePlayers = table.currentHandPlayers();
        console.log(`[changeTurnAndBroadcast] Active players: ${activePlayers.length}`);

        if (activePlayers.length > 1) {
          console.log(`[changeTurnAndBroadcast] Starting new hand`);
          table.handCompleted = false; // Réinitialiser pour la prochaine main
          initNewHand(table);
        } else {
          console.log(`[changeTurnAndBroadcast] Not enough players (${activePlayers.length}) for new hand`);
          broadcastToTable(table, 'En attente de plus de joueurs pour commencer une nouvelle main', 'Le katika');
        }
      }, 3000);
    }
  }

  function initNewHand(table) {
    if (table.currentHandPlayers().length > 1) {
      broadcastToTable(table, '---New hand starting in 5 seconds---', 'Le katika');
    }
    setTimeout(() => {
      table.clearWinMessages();

      // Configurer les callbacks de la table
      setupTableCallbacks(table);

      table.startHand();

      if (table.turn && !table.handOver) {
        broadcastToTable(table, '--- New hand started ---', 'Le katika');
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
        !(seat.lastAction === WINNER && tableCopy.wentToShowdown) &&
        !seat.showingCards  // Ne pas cacher si le joueur montre ses cartes
      ) {
        seat.hand = Array(seat.hand.length).fill(hiddenCard);
      }
    }
    return tableCopy;
  }
};

module.exports = { init };
