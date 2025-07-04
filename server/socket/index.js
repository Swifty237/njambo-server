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
  SEND_CHAT_MESSAGE,
  CHAT_MESSAGE_RECEIVED,
  RECONNECT_PLAYER,
  PLAYER_RECONNECTED
} = require('../pokergame/actions');
const config = require('../config');

const tables = {};
const players = {};

function getCurrentPlayers() {
  return Object.values(players)
    .filter(player => player && player.socketId && player.id && player.name)
    .map((player) => ({
      socketId: player.socketId,
      id: player.id,
      name: player.name,
    }));
}

function getCurrentTables() {
  return Object.values(tables).map((table) => ({
    id: table.id,
    name: table.name,
    seats: table.seats,
    players: table.players,
    bet: table.bet,
    callAmount: table.callAmount,
    pot: table.pot,
    winMessages: table.winMessages,
    button: table.button,
    handOver: table.handOver,
    isPrivate: table.isPrivate,
    createdAt: table.createdAt,
    demandedSuit: table.demandedSuit,
    currentRoundCards: table.currentRoundCards,
    roundNumber: table.roundNumber,
    chatRoom: table.chatRoom,
    link: table.link,
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
        // Au lieu de supprimer le joueur des tables, on met à jour son socketId
        delete players[found.socketId];

        // Mettre à jour le socketId du joueur dans toutes les tables
        Object.values(tables).forEach((table) => {
          const playerInTable = table.players.find(p => p.id === found.id);
          if (playerInTable) {
            playerInTable.socketId = socket.id;
          }
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

  socket.on(JOIN_TABLE, async ({ id, name, bet, isPrivate, createdAt }) => {
    try {
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

      // Vérifier si le joueur existe déjà
      let player = players[socket.id];

      // Si le joueur n'existe pas, essayer de le créer avec les données d'auth
      if (!player && socket.handshake.auth) {
        const { userId, userName, chipsAmount } = socket.handshake.auth;
        if (userId && userName) {
          players[socket.id] = new Player(
            socket.id,
            userId,
            userName,
            chipsAmount || 0
          );
          player = players[socket.id];
        }
      }

      // Vérifier si le joueur est valide
      if (!player || !player.id || !player.name) {
        console.error('Invalid player data');
        socket.emit('error', { message: 'Invalid player data' });
        return;
      }

      // Vérifier que la table existe toujours
      if (!tables[id]) {
        socket.emit('error', { message: 'Table not found' });
        return;
      }

      let isOnTable = true;

      // Si le joueur n'est pas déjà sur la table, on l'ajoute
      if (!tables[id].isPlayerAlreadyOnTable(player.id, player.name)) {
        isOnTable = false;
        tables[id].addPlayer(player);
      }

      // S'assurer que l'id est bien défini avant de l'envoyer
      const tableId = tables[id].id;
      if (!tableId) {
        socket.emit('error', { message: 'Invalid table ID' });
        return;
      }

      setTimeout(() => {
        socket.emit(TABLE_JOINED, { tables: getCurrentTables(), id: tableId });
        socket.broadcast.emit(TABLES_UPDATED, getCurrentTables());
      }, 1000);

      if (tables[id].players && tables[id].players.length > 0 && !isOnTable) {
        let message = `${player.name} joined the table.`;
        broadcastToTable(tables[id], message, 'Le katika');
        isOnTable = true;
      }

    } catch (error) {
      console.error('Error in JOIN_TABLE:', error);
      socket.emit('error', { message: 'Failed to join table' });
    }
  });

  socket.on(LEAVE_TABLE, async (tableId) => {
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
      (seat) => seat && seat.player && seat.player.socketId === socket.id,
    );

    if (seat && player) {
      updatePlayerBankroll(player, seat.stack);

      // Si c'était le tour de ce joueur et qu'une main est en cours
      if (table.turn === seat.id && !table.handOver) {
        // Nettoyer le timer
        table.clearTurnTimer();

        // Retirer le joueur de la liste des participants à la main
        table.handParticipants = table.handParticipants.filter(id => id !== seat.id);

        // Retirer le joueur de la table
        table.removePlayer(socket.id);

        // Trouver le prochain joueur actif
        const remainingPlayers = table.activePlayers();
        if (remainingPlayers.length >= 2) {
          const nextPlayer = table.nextActivePlayer(seat.id, 1);
          if (nextPlayer && table.seats[nextPlayer]) {
            changeTurnAndBroadcast(table, nextPlayer);
          }
        } else {
          table.handOver = true;
          if (remainingPlayers.length === 1) {
            clearForOnePlayer(table);
          }
        }
      } else {
        // Si ce n'était pas son tour ou pas de main en cours
        if (!table.handOver && table.handParticipants.includes(seat.id)) {
          // Retirer de la liste des participants
          table.handParticipants = table.handParticipants.filter(id => id !== seat.id);
        }

        // Retirer le joueur de la table
        table.removePlayer(socket.id);

        // Vérifier s'il reste assez de joueurs
        const remainingPlayers = table.activePlayers();
        if (remainingPlayers.length < 2 && !table.handOver) {
          table.handOver = true;
          if (remainingPlayers.length === 1) {
            clearForOnePlayer(table);
          }
        }
      }
    } else {
      // Si pas de siège trouvé, juste retirer le joueur
      table.removePlayer(socket.id);
    }

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

    socket.emit(RECEIVE_LOBBY_INFO, {
      tables: getCurrentTables(),
      players: getCurrentPlayers(),
      socketId: socket.id,
    });
  });

  socket.on(SEND_CHAT_MESSAGE, async ({ tableId, seatId, message }) => {
    const table = tables[tableId];
    const seat = table?.seats[seatId];

    if (table && message) {
      // Ajouter le message au chatRoom avec les métadonnées
      const newMessage = table.chatRoom.addMessage(message, seat, new Date());

      if (newMessage) {
        // Diffuser le message à tous les joueurs de la table
        for (let i = 0; i < table.players.length; i++) {
          const player = table.players[i];
          if (player && player.socketId) {
            let playerSocketId = player.socketId;
            io.to(playerSocketId).emit(CHAT_MESSAGE_RECEIVED, {
              tables: getCurrentTables(),
              tableId,
              chatMessage: newMessage
            });
          }
        }
      }
    }
  })

  socket.on(PLAY_ONE_CARD, async ({ tableId, seatId, playedCard }) => {
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

      // Vérifier si on peut démarrer une nouvelle main
      const activePlayers = table.currentHandPlayers();

      if (activePlayers.length >= 2) {
        // Si la main est terminée ou si la table était en attente
        if (table.handOver || !table.turn) {
          table.handCompleted = false; // S'assurer qu'une nouvelle main peut démarrer
          initNewHand(table);
        }
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
      return;
    }

    const seat = Object.values(table.seats).find(
      (seat) => seat && seat.player && seat.player.socketId === socket.id,
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
    if (table.handOver && table.currentHandPlayers().length >= 2) {
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

    if (seat && seat.player && seat.player.socketId === socket.id) {
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

  socket.on(DISCONNECT, async () => {
    try {
      // Attendre un court instant pour voir si c'est une reconnexion
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Vérifier si le joueur existe encore dans une table avec un nouveau socketId
      const player = Object.values(players).find(p => p.id === socket.id);
      if (!player) {
        // Si le joueur n'existe plus, c'est une vraie déconnexion
        const seat = findSeatBySocketId(socket.id);
        if (seat && seat.player && typeof seat.stack === 'number') {
          await updatePlayerBankroll(seat.player, seat.stack);
        }

        if (socket.id) {
          delete players[socket.id];
          removeFromTables(socket.id);
        }

        socket.broadcast.emit(TABLES_UPDATED, getCurrentTables());
        socket.broadcast.emit(PLAYERS_UPDATED, getCurrentPlayers());
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });

  async function updatePlayerBankroll(player, amount) {
    try {
      if (!player || !player.id) {
        return;
      }

      const user = await User.findById(player.id);
      if (!user) {
        return;
      }

      user.chipsAmount += amount;
      await user.save();

      // Vérifier si le joueur est toujours connecté
      if (players[socket.id] && players[socket.id].bankroll !== undefined) {
        players[socket.id].bankroll = user.chipsAmount;
        io.to(socket.id).emit(PLAYERS_UPDATED, getCurrentPlayers());
      }
    } catch (error) {
      console.error('Error in updatePlayerBankroll:', error);
    }
  }

  function findSeatBySocketId(socketId) {
    if (!socketId) return null;

    let foundSeat = null;
    Object.values(tables).forEach((table) => {
      if (!table || !table.seats) return;

      Object.values(table.seats).forEach((seat) => {
        if (seat && seat.player && seat.player.socketId === socketId) {
          foundSeat = seat;
        }
      });
    });
    return foundSeat;
  }

  function removeFromTables(socketId) {
    if (!socketId) return;

    for (let i = 0; i < Object.keys(tables).length; i++) {
      const tableId = Object.keys(tables)[i];
      if (tables[tableId] && typeof tables[tableId].removePlayer === 'function') {
        tables[tableId].removePlayer(socketId);
      }
    }
  }

  function broadcastToTable(table, message = null, from = null) {
    if (!table || !table.players || !Array.isArray(table.players)) {
      return;
    }

    for (let i = 0; i < table.players.length; i++) {
      const player = table.players[i];
      if (player && player.socketId) {
        let socketId = player.socketId;
        let tableCopy = hideOpponentCards(table, socketId);
        io.to(socketId).emit(TABLE_UPDATED, {
          table: tableCopy,
          message,
          from,
        });
      }
    }
  }

  // Fonction pour configurer les callbacks de la table
  function setupTableCallbacks(table) {
    // Callback pour le jeu automatique
    table.onAutoPlayCard = async (seatId, playedCard) => {
      // Notifier tous les joueurs qu'une carte a été jouée automatiquement
      if (table.seats[seatId]) {
        let seat = table.seats[seatId];

        seat.playOneCard(playedCard);

        table.currentRoundCards.push({
          seatId: seatId,
          card: playedCard
        });
        socket.emit(PLAYED_CARD, {
          tables: getCurrentTables(),
          tableId: table.id,
          seatId
        });

        changeTurnAndBroadcast(table, seatId);
      }
    };

    // Callback pour les changements de tour automatiques
    table.onTurnChanged = (table, message) => {
      broadcastToTable(table, message, 'Le katika');
    };

    // Callback pour la fin de la main
    table.onHandComplete = () => {
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
          table.handCompleted = false; // Réinitialiser pour la prochaine main
          initNewHand(table);
        } else {
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

      // Diffuser les notifications de jeu
      if (table.gameNotifications && table.gameNotifications.length > 0) {
        table.gameNotifications.forEach(message => {
          broadcastToTable(table, message, 'Le katika');
        });
      }

      // Le timer est maintenant géré dans updateSeatsForNewTurn
    } else if (table.handOver && !table.handCompleted) {
      // Annoncer le gagnant du dernier tour
      const lastRoundWinner = table.seats[table.lastWinningSeat];
      if (lastRoundWinner) {
        const roundWinMessage = `${lastRoundWinner.player.name} gagne le dernier tour!`;
        broadcastToTable(table, roundWinMessage, 'Le katika');
      }

      // Attendre un peu avant de démarrer une nouvelle main
      setTimeout(() => {
        const activePlayers = table.currentHandPlayers();

        if (activePlayers.length > 1) {
          table.handCompleted = false; // Réinitialiser pour la prochaine main
          initNewHand(table);
        } else {
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
      table.clearGameNotifications();

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
    table.clearGameNotifications();
    table.clearSeatHands();
    table.clearSeatPlayedHands();
    table.resetPot();
    table.handOver = true;
    table.handCompleted = false;  // Important : permettre le démarrage d'une nouvelle main
    table.roundNumber = 1;
    table.currentRoundCards = [];
    table.demandedSuit = null;
    table.turn = null;
    table.handParticipants = [];
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
        seat.hand &&
        Array.isArray(seat.hand) &&
        seat.hand.length > 0 &&
        seat.player &&
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

module.exports = {
  init
};
