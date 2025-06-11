const _ = require('underscore');
const lodash = require('lodash');
const Hand = require('pokersolver').Hand;
const Seat = require('./Seat');
const Deck = require('./Deck');
const SidePot = require('./SidePot');
const Player = require('./Player');

class Table {
  constructor(id, name, bet, isPrivate, createdAt) {
    this.id = id;
    this.name = name;
    this.bet = bet;
    this.isPrivate = isPrivate;
    this.createdAt = createdAt;
    this.maxPlayers = 4;
    this.players = [];
    this.seats = this.initSeats(this.maxPlayers);
    this.button = null;
    this.turn = null;
    this.lastWinningSeat = null;  // Pour garder une trace du dernier gagnant
    this.pot = 0;
    this.callAmount = null;
    this.handOver = true;
    this.winMessages = [];
    this.wentToShowdown = false;
    this.history = [];
    this.deck = null;
    this.turnTimer = null;        // Timer pour le tour actuel
    this.turnTime = 15000;        // Temps en millisecondes pour jouer (15 secondes)
    this.demandedSuit = null;     // Couleur demandée pour le tour actuel
    this.currentRoundCards = [];   // Cartes jouées dans le tour actuel
    this.roundNumber = 1;
    this.countHand = 0;         // Numéro du tour actuel (1-5)
  }

  initSeats(maxPlayers) {
    const seats = {};
    for (let i = 1; i <= maxPlayers; i++) {
      seats[i] = null;
    }
    return seats;
  }

  addPlayer(player) {
    this.players.push(player);
  }

  removePlayer(socketId) {
    this.players = this.players.filter(
      (player) => player && player.socketId !== socketId,
    );
    this.standPlayer(socketId);
  }

  sitPlayer(player, seatId, amount) {
    if (this.seats[seatId]) {
      return;
    }

    this.seats[seatId] = new Seat(seatId, player, amount, amount);
    this.seats[seatId].bet = 0;

    const firstPlayer = Object.values(this.seats).filter((seat) => seat != null).length === 1;

    this.button = firstPlayer ? seatId : this.button;
  }

  rebuyPlayer(seatId, amount) {
    if (!this.seats[seatId]) {
      throw new Error('No seated player to rebuy');
    }
    this.seats[seatId].stack += amount;
  }

  standPlayer(socketId) {
    for (let i of Object.keys(this.seats)) {
      if (this.seats[i]) {
        if (this.seats[i] && this.seats[i].player.socketId === socketId) {
          this.seats[i] = null;
        }
      }
    }

    const satPlayers = Object.values(this.seats).filter((seat) => seat != null);

    if (satPlayers.length === 1) {
      // this.endWithoutShowdown();
    }

    if (satPlayers.length === 0) {
      this.resetEmptyTable();
    }
  }

  findPlayerBySocketId(socketId) {
    for (let i = 1; i <= this.maxPlayers; i++) {
      if (this.seats[i] && this.seats[i].player.socketId === socketId) {
        return this.seats[i];
      }
    }
    // throw new Error('seat not found!');
  }
  unfoldedPlayers() {
    return Object.values(this.seats).filter(
      (seat) => seat != null && !seat.folded,
    );
  }

  activePlayers() {
    return Object.values(this.seats).filter(
      (seat) => seat != null && !seat.sittingOut,
    );
  }

  nextActivePlayer(player, places) {
    // S'assurer que player est un nombre valide
    if (!player || isNaN(player)) {
      return 1;
    }

    // Convertir en nombre et s'assurer qu'il est dans les limites
    let playerNum = parseInt(player);
    if (playerNum < 1 || playerNum > this.maxPlayers) {
      return 1;
    }

    // Vérifier s'il y a plus d'un joueur actif
    const activePlayers = this.activePlayers();
    if (activePlayers.length <= 1) {
      return parseInt(playerNum);
    }

    // Construire un tableau des seatId des joueurs actifs (en tant que nombres)
    const activePlayerIds = activePlayers.map(seat => parseInt(seat.id));

    // Garder la position de départ
    const startingSeat = parseInt(playerNum);
    let currentSeat = parseInt(playerNum);

    // Boucle pour trouver le prochain joueur actif
    do {
      // Calculer le prochain siège avec wrap-around
      currentSeat = currentSeat === this.maxPlayers ? 1 : currentSeat + 1;

      // Si on trouve un joueur actif, le retourner
      if (activePlayerIds.includes(currentSeat)) {
        return parseInt(currentSeat);
      }

    } while (currentSeat !== startingSeat); // Continue jusqu'à ce qu'on revienne au départ

    // Si on a fait le tour complet sans trouver de joueur actif, retourner le joueur initial
    return parseInt(playerNum);
  }

  startHand() {
    try {
      this.deck = new Deck();

      this.wentToShowdown = false;
      this.resetPot();
      this.clearSeatHands();
      this.clearSeatPlayedHands();
      this.resetBetsAndActions();
      this.unfoldPlayers();
      this.history = [];
      this.turn = null;

      // Initialiser les variables pour le nouveau système de jeu
      this.demandedSuit = null;
      this.currentRoundCards = [];
      this.roundNumber = 1;

      const activePlayers = this.activePlayers();

      if (activePlayers.length > 1) {

        if (this.countHand !== 0) {
          // Si on a un gagnant de la main précédente, il devient le nouveau dealer
          if (
            this.lastWinningSeat &&
            this.seats[this.lastWinningSeat] &&
            !this.seats[this.lastWinningSeat].sittingOut) {
            this.button = this.lastWinningSeat;
          } else {
            // S'assurer que this.button est un nombre valide avant d'appeler nextActivePlayer
            const currentButton = parseInt(this.button) || 1;
            this.button = this.nextActivePlayer(currentButton, 1);
          }
        }

        this.setBlinds();
        this.setTurn();
        this.dealCard();
        this.updateHistory();

        this.handOver = false;
        this.countHand++;
      }
    } catch (error) {
      console.error("Error in startHand:", error);
      throw error;
    }
  }

  dealCard() {
    try {
      const arr = _.range(1, this.maxPlayers + 1);
      const order = arr.slice(this.button).concat(arr.slice(0, this.button));

      // deal 5 cards to each seated player
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < order.length; j++) {
          const seat = this.seats[order[j]];
          if (seat && !seat.sittingOut) {
            const card = this.deck.draw();
            if (!card) {
              throw new Error("No card drawn from deck!");
            }
            seat.hand.push(card);
            seat.turn = order[j] === this.turn;
          }
        }
      }
    } catch (error) {
      console.error("Error in dealCard:", error);
      throw error;
    }
  }

  unfoldPlayers() {
    for (let i = 1; i <= this.maxPlayers; i++) {
      const seat = this.seats[i];
      if (seat) {
        seat.folded = seat.sittingOut ? true : false;
      }
    }
  }

  setTurn() {
    if (this.activePlayers().length > 1) {
      if (this.countHand === 0) {
        this.turn = parseInt(this.button);
      } else {
        this.turn = this.nextActivePlayer(this.turn, 1);
      }
    } else {
      this.turn = parseInt(this.activePlayers()[0].id);
    }

    // Mettre à jour le tour pour tous les sièges
    this.updateSeatsForNewTurn();
  }

  setBlinds() {
    try {
      // Placer les blinds - tous les joueurs actifs placent la même mise
      const betAmount = Number(this.bet);
      const activePlayers = this.activePlayers();
      let totalBets = 0;

      // Tous les joueurs actifs placent une blind égale à la mise de départ
      for (let i = 1; i <= this.maxPlayers; i++) {
        const seat = this.seats[i];
        if (seat && !seat.sittingOut) {
          seat.placeBet(betAmount);
          totalBets += betAmount;
        }
      }

      this.pot = Number(this.pot || 0) + totalBets;
      this.callAmount = betAmount;

    } catch (error) {
      console.error("Error setting blinds:", error);
      throw error;
    }
  }

  clearSeats() {
    for (let i of Object.keys(this.seats)) {
      this.seats[i] = null;
    }
  }

  clearSeatHands() {
    for (let i of Object.keys(this.seats)) {
      if (this.seats[i]) {
        this.seats[i].hand = [];
      }
    }
  }

  clearSeatPlayedHands() {
    for (let i of Object.keys(this.seats)) {
      if (this.seats[i]) {
        this.seats[i].playedHand = [];
      }
    }
  }


  clearSeatTurns() {
    for (let i of Object.keys(this.seats)) {
      if (this.seats[i]) {
        this.seats[i].turn = false;
      }
    }
  }

  clearWinMessages() {
    this.winMessages = [];
  }

  endHand() {
    this.clearSeatTurns();
    this.handOver = true;
    this.sitOutFeltedPlayers();
  }

  sitOutFeltedPlayers() {
    for (let i of Object.keys(this.seats)) {
      const seat = this.seats[i];
      if ((seat && seat.stack == 0) || (seat && seat.stack < 0)) {
        seat.sittingOut = true;
      }
    }
  }

  resetEmptyTable() {
    this.button = null;
    this.turn = null;
    this.handOver = true;
    this.deck = null;
    this.wentToShowdown = false;
    this.resetPot();
    this.clearWinMessages();
    this.clearSeats();
    this.clearTurnTimer();
    this.demandedSuit = null;
    this.currentRoundCards = [];
    this.roundNumber = 0;
  }

  // Trouver la carte la plus haute d'une couleur donnée
  findHighestCardOfSuit(cards, suit) {
    const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J'];
    const suitCards = cards.filter(card => card.suit === suit);

    if (suitCards.length === 0) return null;

    return suitCards.reduce((highest, current) => {
      return ranks.indexOf(current.rank) > ranks.indexOf(highest.rank) ? current : highest;
    });
  }

  // Vérifier si un joueur a une carte de la couleur demandée
  hasCardOfSuit(seatId, suit) {
    const seat = this.seats[seatId];
    return seat && seat.hand.some(card => card.suit === suit);
  }

  // Démarrer un nouveau tour
  startNewRound() {
    this.roundNumber++;

    // Vérifier si c'est le dernier tour (5ème tour)
    if (this.roundNumber > 5) {
      this.handOver = true;
      return;
    }

    // Nettoyer le timer existant
    this.clearTurnTimer();

    // Réinitialiser les variables du tour
    this.currentRoundCards = [];
    this.demandedSuit = null;

    // Vérifier s'il reste des joueurs actifs avec des cartes
    const activePlayers = this.activePlayers().filter(seat => seat.hand.length > 0);
    if (activePlayers.length < 2) {
      this.handOver = true;
      return;
    }

    // Mettre à jour le tour pour tous les sièges
    const currentTurn = parseInt(this.turn);
    for (let i = 1; i <= this.maxPlayers; i++) {
      if (this.seats[i]) {
        this.seats[i].turn = i === currentTurn;
      }
    }

    // Démarrer le timer pour le premier joueur du tour
    if (this.turn && !this.handOver) {
      this.startTurnTimer(
        this.turn,
        (seatId) => {
          const result = this.playRandomCard(seatId);
          if (result) {
            this.changeTurn(seatId);
          }
        });
    }
  }

  // Trouver le gagnant du tour actuel
  findRoundWinner() {
    if (this.currentRoundCards.length === 0) {
      return null;
    }

    // Le premier joueur du tour
    const firstPlayer = this.currentRoundCards[0].seatId;

    // Vérifier si tous les joueurs actifs ont joué
    const activePlayers = this.activePlayers().filter(seat => seat.hand.length > 0 || this.currentRoundCards.some(card => card.seatId === seat.id));
    const playersWhoPlayed = this.currentRoundCards.map(card => card.seatId);

    if (!activePlayers.every(seat => playersWhoPlayed.includes(seat.id))) {
      return null;
    }

    // Trouver toutes les cartes de la couleur demandée
    const suitCards = this.currentRoundCards.filter(card => card.card.suit === this.demandedSuit);

    // Si aucune carte n'est de la couleur demandée, le premier joueur gagne automatiquement
    if (suitCards.length === 0) {
      return firstPlayer;
    }

    // Trouver la carte la plus haute parmi les cartes de la couleur demandée
    const ranks = ['3', '4', '5', '6', '7', '8', '9', '10'];
    let highestCard = suitCards[0];
    let highestRank = ranks.indexOf(highestCard.card.rank);

    for (let i = 1; i < suitCards.length; i++) {
      const currentRank = ranks.indexOf(suitCards[i].card.rank);

      if (currentRank > highestRank) {
        highestCard = suitCards[i];
        highestRank = currentRank;
      }
    }

    // Si c'est le dernier tour (5ème), ce gagnant sera le gagnant de la partie
    if (this.roundNumber >= 5) {
      this.lastWinningSeat = highestCard.seatId;
    }
    return highestCard.seatId;
  }

  // Vérifier si un tour est terminé
  isRoundComplete() {
    // Obtenir tous les joueurs actifs au début du tour
    const activePlayers = this.activePlayers();
    const playersWithCards = activePlayers.filter(seat => seat.hand.length > 0);

    // Obtenir les joueurs qui ont joué ce tour
    const playersWhoPlayed = this.currentRoundCards.map(card => card.seatId);

    // Un tour est complet quand tous les joueurs actifs au début du tour ont joué
    const allPlayersPlayed = playersWithCards.every(seat =>
      playersWhoPlayed.includes(seat.id)
    );

    return allPlayersPlayed && playersWhoPlayed.length === playersWithCards.length;
  }

  // Méthodes pour gérer le timer de tour
  startTurnTimer(seatId, callback) {
    // Vérifier si le siège est toujours valide
    if (!this.seats[seatId] || this.handOver) {
      return;
    }

    // S'assurer qu'il n'y a pas de timer actif
    this.clearTurnTimer();

    // Créer un nouveau timer
    this.turnTimer = setTimeout(() => {
      // Vérifier à nouveau si le siège est toujours valide
      if (this.seats[seatId] && !this.handOver && this.turn === seatId) {
        if (callback) {
          callback(seatId);
        }
      }
      this.turnTimer = null;
    }, this.turnTime);
  }

  clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  // Trouver la carte la plus haute d'une couleur donnée parmi les cartes jouées
  findHighestPlayedCard(suit) {
    const suitCards = this.currentRoundCards.filter(card => card.card.suit === suit);

    if (suitCards.length === 0) {
      return null;
    }

    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let highest = suitCards[0];
    let highestRank = ranks.indexOf(highest.card.rank);

    for (let i = 1; i < suitCards.length; i++) {
      const currentRank = ranks.indexOf(suitCards[i].card.rank);

      if (currentRank > highestRank) {
        highest = suitCards[i];
        highestRank = currentRank;
      }
    }

    return highest;
  }

  // Vérifier si une carte peut être jouée selon les règles
  canPlayCard(seatId, card) {
    // Premier joueur du tour peut jouer n'importe quelle carte
    if (this.currentRoundCards.length === 0) {
      return true;
    }

    // Si le joueur a une carte de la couleur demandée, il doit la jouer
    if (this.hasCardOfSuit(seatId, this.demandedSuit)) {
      const canPlay = card.suit === this.demandedSuit;
      return canPlay;
    }

    // Si le joueur n'a pas la couleur demandée, il peut jouer n'importe quelle carte
    return true;
  }

  playRandomCard(seatId, callback) {
    const seat = this.seats[seatId];
    if (!seat || seat.hand.length === 0) {
      return null;
    }

    let cardToPlay;
    const isFirstPlayer = this.currentRoundCards.length === 0;

    // Si c'est le premier joueur du tour
    if (isFirstPlayer) {
      cardToPlay = seat.hand[0]; // Jouer la première carte
      this.demandedSuit = cardToPlay.suit; // Définir la couleur demandée
    } else {
      // Chercher une carte de la couleur demandée
      const validCards = seat.hand.filter(card => card.suit === this.demandedSuit);

      if (validCards.length > 0) {
        // Jouer la plus haute carte de la couleur demandée
        const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        cardToPlay = validCards.reduce((highest, current) => {
          return ranks.indexOf(current.rank) > ranks.indexOf(highest.rank) ? current : highest;
        });
      } else {
        // Si pas de carte de la couleur demandée, jouer la plus basse carte
        cardToPlay = seat.hand[0];
      }
    }

    // Jouer la carte
    seat.playOneCard(cardToPlay);

    // Créer l'objet carte jouée
    const playedCard = {
      seatId: seatId,
      card: cardToPlay
    };

    // Ajouter la carte jouée à l'historique du tour
    this.currentRoundCards.push(playedCard);

    // Appeler le callback pour continuer le jeu
    if (callback) {
      callback(seatId);
    }

    // Retourner la carte jouée pour que le socket puisse émettre PLAYED_CARD
    return {
      card: cardToPlay,
      nextSeatId: this.turn
    };
  }

  resetPot() {
    this.pot = 0;
  }

  updateHistory() {
    this.history.push({
      pot: +this.pot.toFixed(2),
      seats: this.cleanSeatsForHistory(),
      button: this.button,
      turn: this.turn,
      winMessages: this.winMessages.slice(),
    });
  }

  cleanSeatsForHistory() {
    const cleanSeats = JSON.parse(JSON.stringify(this.seats));
    for (let i = 0; i < this.maxPlayers; i++) {
      const seat = cleanSeats[i];
      if (seat) {
        seat.player = {
          id: seat.player.id,
          username: seat.player.name,
        };
        seat.bet = +seat.bet.toFixed(2);
        seat.stack = +seat.stack.toFixed(2);
      }
    }
    return cleanSeats;
  }

  changeTurn(lastTurn) {
    try {
      // Nettoyer le timer du tour précédent
      this.clearTurnTimer();

      if (this.handOver) {
        return;
      }

      // Vérifier si le tour actuel est terminé
      if (this.isRoundComplete()) {
        const roundWinner = this.findRoundWinner();

        // Vérifier si tous les joueurs ont joué toutes leurs cartes
        const activePlayers = this.activePlayers();
        // const playersWithCards = activePlayers.filter(seat => seat.hand.length > 0);

        if (this.roundNumber > 5) {
          this.handOver = true;
          this.turn = null;
          this.lastWinningSeat = roundWinner;
          this.determinePotWinner();
          return;
        }

        // Démarrer un nouveau tour avec le gagnant comme premier joueur
        this.turn = parseInt(roundWinner);
        this.startNewRound();

        // Mettre à jour le tour pour tous les sièges
        this.updateSeatsForNewTurn();
        return;
      }

      // Si le tour n'est pas terminé, passer au joueur suivant
      let nextPlayer = this.nextActivePlayer(lastTurn, 1);

      if (nextPlayer && this.seats[nextPlayer] && this.seats[nextPlayer].hand.length > 0) {
        // Nettoyer l'ancien timer avant de changer de tour
        this.clearTurnTimer();

        this.turn = parseInt(nextPlayer);

        // Mettre à jour le tour pour tous les sièges
        this.updateSeatsForNewTurn();

        // Démarrer le timer pour le nouveau joueur
        this.startTurnTimer(
          this.turn,
          (seatId) => {
            const result = this.playRandomCard(seatId);
            if (result) {
              this.changeTurn(seatId);
            }
          });

      } else {
        this.handOver = true;

        // Déterminer le gagnant du dernier tour joué
        if (this.currentRoundCards.length > 0) {
          const lastRoundWinner = this.findRoundWinner();
          this.lastWinningSeat = lastRoundWinner;
        }

        this.determinePotWinner();
      }
    } catch (error) {
      console.error("Error in changeTurn:", error);
      this.handOver = true;

      if (this.currentRoundCards.length > 0) {
        const lastRoundWinner = this.findRoundWinner();
        this.lastWinningSeat = lastRoundWinner;
      }
      this.determinePotWinner();
    }
  }

  // Mettre à jour le tour pour tous les sièges
  updateSeatsForNewTurn() {
    // S'assurer que this.turn est un nombre
    const currentTurn = parseInt(this.turn);

    for (let i = 1; i <= this.maxPlayers; i++) {
      if (this.seats[i]) {
        // Comparer les nombres pour éviter les problèmes de type
        this.seats[i].turn = i === currentTurn;
      }
    }
  }

  determinePotWinner() {
    if (this.lastWinningSeat) {
      const winner = this.seats[this.lastWinningSeat];

      if (winner) {
        const winMessage = `${winner.player.name} wins $${this.pot.toFixed(2)}`;
        this.winMessages.push(winMessage);

        // Mettre le bet de tous les joueurs à zéro d'abord (même pour le gagnant)
        for (let i = 1; i <= this.maxPlayers; i++) {
          if (this.seats[i]) {
            this.seats[i].bet = 0;
          }
        }

        // Ensuite exécuter le setTimeout qui ajoute le montant du pot au stack du gagnant
        setTimeout(() => {
          winner.winHand(this.pot);
        }, 2000);
      }
    }

    this.wentToShowdown = true;
    this.endHand();
  }

  resetBetsAndActions() {
    for (let i = 1; i <= this.maxPlayers; i++) {
      if (this.seats[i]) {
        this.seats[i].bet = 0;
        this.seats[i].checked = false;
        this.seats[i].lastAction = null;
      }
    }
    this.callAmount = null;
  }

  handleCheck(socketId) {
    let seat = this.findPlayerBySocketId(socketId);
    if (seat) {
      seat.check();

      return {
        seatId: seat.id,
        message: `${seat.player.name} checks`,
      };
    } else {
      return null;
    }
  }
}

module.exports = Table;
