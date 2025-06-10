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

    console.log("Player seated:", {
      seatId,
      playerName: player.name,
      initialBet: this.seats[seatId].bet,
      remainingStack: this.seats[seatId].stack
    });
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
      console.log("Invalid player position, returning 1");
      return 1;
    }

    // Convertir en nombre et s'assurer qu'il est dans les limites
    let playerNum = parseInt(player);
    if (playerNum < 1 || playerNum > this.maxPlayers) {
      console.log("Player position out of bounds, returning 1");
      return 1;
    }

    console.log(`nextActivePlayer called with player: ${playerNum}, places: ${places}`);

    // Vérifier s'il y a plus d'un joueur actif
    const activePlayers = this.activePlayers();
    if (activePlayers.length <= 1) {
      console.log("Not enough active players");
      return parseInt(playerNum);
    }

    // Construire un tableau des seatId des joueurs actifs (en tant que nombres)
    const activePlayerIds = activePlayers.map(seat => parseInt(seat.id));
    console.log("Active player IDs:", activePlayerIds);

    // Garder la position de départ
    const startingSeat = parseInt(playerNum);
    let currentSeat = parseInt(playerNum);

    // Boucle pour trouver le prochain joueur actif
    do {
      // Calculer le prochain siège avec wrap-around
      currentSeat = currentSeat === this.maxPlayers ? 1 : currentSeat + 1;

      // Si on trouve un joueur actif, le retourner
      if (activePlayerIds.includes(currentSeat)) {
        console.log(`Found active player at seat ${currentSeat}`);
        return parseInt(currentSeat);
      }

      console.log(`Seat ${currentSeat} not active, trying next seat`);
    } while (currentSeat !== startingSeat); // Continue jusqu'à ce qu'on revienne au départ

    // Si on a fait le tour complet sans trouver de joueur actif, retourner le joueur initial
    console.log("Made full circle, returning initial player");
    return parseInt(playerNum);
  }

  startHand() {
    console.log("Starting new hand...");
    try {
      console.log("Creating new deck...");
      this.deck = new Deck();
      console.log("Deck created with", this.deck.count(), "cards");

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
      console.log("Active players:", activePlayers.length);
      console.log("Current button:", this.button);
      console.log("Current seats state:", Object.values(this.seats).map(seat =>
        seat ? {
          id: seat.id,
          playerName: seat.player.name,
          stack: seat.stack,
          bet: seat.bet,
          folded: seat.folded
        } : null
      ));
      console.log("Number hands play: ", this.countHand);

      if (activePlayers.length > 1) {
        console.log("Multiple players detected, initializing game...");

        if (this.countHand !== 0) {
          console.log("Moving button...");
          // Si on a un gagnant de la main précédente, il devient le nouveau dealer
          if (
            this.lastWinningSeat &&
            this.seats[this.lastWinningSeat] &&
            !this.seats[this.lastWinningSeat].sittingOut) {
            this.button = this.lastWinningSeat;
            console.log("New button position (last winner):", this.button);
          } else {
            // S'assurer que this.button est un nombre valide avant d'appeler nextActivePlayer
            const currentButton = parseInt(this.button) || 1;
            this.button = this.nextActivePlayer(currentButton, 1);
            console.log("New button position (next active):", this.button);
          }
        }

        console.log("Setting blinds...");
        this.setBlinds();

        console.log("Setting turn...");
        this.setTurn();
        console.log("Turn set to:", this.turn);

        console.log("Dealing...");
        this.dealCard();

        console.log("Updating history...");
        this.updateHistory();

        this.handOver = false;
        console.log("Hand started successfully");

        this.countHand++;
      }
    } catch (error) {
      console.error("Error in startHand:", error);
      throw error;
    }
  }

  dealCard() {
    try {
      console.log("Starting dealCard...");
      const arr = _.range(1, this.maxPlayers + 1);
      const order = arr.slice(this.button).concat(arr.slice(0, this.button));
      console.log("Deal order:", order);

      // deal 5 cards to each seated player
      for (let i = 0; i < 5; i++) {
        // console.log(`Dealing round ${i + 1}...`);
        for (let j = 0; j < order.length; j++) {
          const seat = this.seats[order[j]];
          if (seat && !seat.sittingOut) {
            const card = this.deck.draw();
            if (!card) {
              throw new Error("No card drawn from deck!");
            }
            seat.hand.push(card);
            // console.log(`Dealt ${card.rank} of ${card.suit} to player ${seat.player.name} in seat ${order[j]}`);
            seat.turn = order[j] === this.turn;
          }
        }
      }
      console.log("dealing complete");
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
    console.log("Setting turn with active players:", this.activePlayers().length);

    if (this.activePlayers().length > 1) {
      if (this.countHand === 0) {
        this.turn = parseInt(this.button);
      } else {
        this.turn = this.nextActivePlayer(this.turn, 1);
      }
    } else {
      this.turn = parseInt(this.activePlayers()[0].id);
    }
    console.log("Turn set to:", this.turn);

    // Mettre à jour le tour pour tous les sièges
    this.updateSeatsForNewTurn();
  }

  setBlinds() {
    console.log("Setting blinds...");

    try {
      // Placer les blinds - tous les joueurs actifs placent la même mise
      const betAmount = Number(this.bet);
      const activePlayers = this.activePlayers();
      let totalBets = 0;

      console.log("Placing blinds for all active players...");

      // Tous les joueurs actifs placent une blind égale à la mise de départ
      for (let i = 1; i <= this.maxPlayers; i++) {
        const seat = this.seats[i];
        if (seat && !seat.sittingOut) {
          seat.placeBet(betAmount);
          totalBets += betAmount;
          console.log(`Player ${seat.player.name} in seat ${i} placed blind: ${betAmount}`);
        }
      }

      this.pot = Number(this.pot || 0) + totalBets;
      this.callAmount = betAmount;

      console.log("Blinds set successfully:", {
        totalPlayers: activePlayers.length,
        betAmountPerPlayer: betAmount,
        totalBets: totalBets,
        pot: this.pot,
        callAmount: this.callAmount
      });
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
    console.log(`\n=== Starting Round ${this.roundNumber} ===`);

    // Vérifier si c'est le dernier tour (5ème tour)
    if (this.roundNumber > 5) {
      console.log("Maximum rounds reached (5) - Game will end after this round");
      this.handOver = true;
      return;
    }

    // Nettoyer le timer existant
    this.clearTurnTimer();

    // Réinitialiser les variables du tour
    this.currentRoundCards = [];
    this.demandedSuit = null;

    // Afficher l'état des mains des joueurs
    console.log("Players' hands at start of round:");
    const activePlayers = this.activePlayers().filter(seat => seat.hand.length > 0);
    activePlayers.forEach(seat => {
      console.log(`Seat ${seat.id}: ${seat.hand.length} cards remaining`);
    });

    // Vérifier s'il reste des joueurs actifs avec des cartes
    if (activePlayers.length < 2) {
      console.log("Not enough active players with cards - ending hand");
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

    console.log(`Current turn: Seat ${this.turn}`);

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
    console.log("\n=== Finding Round Winner ===");
    console.log("Current round cards:", this.currentRoundCards);
    console.log("Demanded suit:", this.demandedSuit);
    console.log("Round number:", this.roundNumber);

    if (this.currentRoundCards.length === 0) {
      console.log("No cards played this round");
      return null;
    }

    // Le premier joueur du tour
    const firstPlayer = this.currentRoundCards[0].seatId;
    console.log("First player of the round:", firstPlayer);

    // Vérifier si tous les joueurs actifs ont joué
    const activePlayers = this.activePlayers().filter(seat => seat.hand.length > 0 || this.currentRoundCards.some(card => card.seatId === seat.id));
    const playersWhoPlayed = this.currentRoundCards.map(card => card.seatId);

    console.log("Active players:", activePlayers.map(p => p.id));
    console.log("Players who played:", playersWhoPlayed);

    if (!activePlayers.every(seat => playersWhoPlayed.includes(seat.id))) {
      console.log("Not all players have played yet");
      return null;
    }

    // Trouver toutes les cartes de la couleur demandée
    const suitCards = this.currentRoundCards.filter(card => card.card.suit === this.demandedSuit);
    console.log("Cards of demanded suit:", suitCards);

    // Si aucune carte n'est de la couleur demandée, le premier joueur gagne automatiquement
    if (suitCards.length === 0) {
      console.log(`No cards of demanded suit (${this.demandedSuit}), first player (${firstPlayer}) wins the round`);
      return firstPlayer;
    }

    // Trouver la carte la plus haute parmi les cartes de la couleur demandée
    const ranks = ['3', '4', '5', '6', '7', '8', '9', '10'];
    let highestCard = suitCards[0];
    let highestRank = ranks.indexOf(highestCard.card.rank);

    for (let i = 1; i < suitCards.length; i++) {
      const currentRank = ranks.indexOf(suitCards[i].card.rank);
      console.log(`Comparing ${suitCards[i].card.rank} (${currentRank}) vs ${highestCard.card.rank} (${highestRank})`);

      if (currentRank > highestRank) {
        highestCard = suitCards[i];
        highestRank = currentRank;
      }
    }

    console.log(`Round winner is seat ${highestCard.seatId} with ${highestCard.card.rank} of ${highestCard.card.suit}`);

    // Si c'est le dernier tour (5ème), ce gagnant sera le gagnant de la partie
    if (this.roundNumber >= 5) {
      console.log("This is the final round - winner will win the game");
      this.lastWinningSeat = highestCard.seatId;
    }
    return highestCard.seatId;
  }

  // Vérifier si un tour est terminé
  isRoundComplete() {
    console.log("\n=== Checking if round is complete ===");

    // Obtenir tous les joueurs actifs au début du tour
    const activePlayers = this.activePlayers();
    const playersWithCards = activePlayers.filter(seat => seat.hand.length > 0);
    console.log("Active players at start of round:", playersWithCards.map(seat => seat.id));

    // Obtenir les joueurs qui ont joué ce tour
    const playersWhoPlayed = this.currentRoundCards.map(card => card.seatId);
    console.log("Players who played this round:", playersWhoPlayed);

    // Un tour est complet quand tous les joueurs actifs au début du tour ont joué
    const allPlayersPlayed = playersWithCards.every(seat =>
      playersWhoPlayed.includes(seat.id)
    );

    console.log("Round complete?", allPlayersPlayed);
    console.log("Current round cards:", this.currentRoundCards);

    return allPlayersPlayed && playersWhoPlayed.length === playersWithCards.length;
  }

  // Méthodes pour gérer le timer de tour
  startTurnTimer(seatId, callback) {
    // Vérifier si le siège est toujours valide
    if (!this.seats[seatId] || this.handOver) {
      console.log(`Cannot start timer - invalid seat ${seatId} or hand is over`);
      return;
    }

    // S'assurer qu'il n'y a pas de timer actif
    this.clearTurnTimer();

    console.log(`Starting turn timer for seat ${seatId} - ${this.turnTime / 1000} seconds`);

    // Créer un nouveau timer
    this.turnTimer = setTimeout(() => {
      // Vérifier à nouveau si le siège est toujours valide
      if (this.seats[seatId] && !this.handOver && this.turn === seatId) {
        console.log(`Time's up for seat ${seatId}! Playing random card.`);
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
      console.log("Turn timer cleared");
    }
  }

  // Trouver la carte la plus haute d'une couleur donnée parmi les cartes jouées
  findHighestPlayedCard(suit) {
    console.log("\n=== Finding Highest Card ===");
    console.log("Looking for suit:", suit);
    console.log("Cards played:", this.currentRoundCards);

    const suitCards = this.currentRoundCards.filter(card => card.card.suit === suit);
    console.log("Cards of suit:", suitCards);

    if (suitCards.length === 0) {
      console.log("No cards of suit found");
      return null;
    }

    const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    let highest = suitCards[0];
    let highestRank = ranks.indexOf(highest.card.rank);

    for (let i = 1; i < suitCards.length; i++) {
      const currentRank = ranks.indexOf(suitCards[i].card.rank);
      console.log(`Comparing ${suitCards[i].card.rank} (${currentRank}) vs ${highest.card.rank} (${highestRank})`);

      if (currentRank > highestRank) {
        highest = suitCards[i];
        highestRank = currentRank;
      }
    }

    console.log(`Highest card: ${highest.card.rank} of ${highest.card.suit} from seat ${highest.seatId}`);
    return highest;
  }

  // Vérifier si une carte peut être jouée selon les règles
  canPlayCard(seatId, card) {
    console.log(`\n=== Checking if card can be played ===`);
    console.log(`Seat ${seatId} wants to play: ${card.rank} of ${card.suit}`);
    console.log(`Current round cards: ${this.currentRoundCards.length}`);
    console.log(`Demanded suit: ${this.demandedSuit}`);

    // Premier joueur du tour peut jouer n'importe quelle carte
    if (this.currentRoundCards.length === 0) {
      console.log("First player of round - can play any card");
      return true;
    }

    // Si le joueur a une carte de la couleur demandée, il doit la jouer
    if (this.hasCardOfSuit(seatId, this.demandedSuit)) {
      const canPlay = card.suit === this.demandedSuit;
      console.log(`Player has cards of demanded suit (${this.demandedSuit}) - must follow suit: ${canPlay}`);
      return canPlay;
    }

    // Si le joueur n'a pas la couleur demandée, il peut jouer n'importe quelle carte
    console.log(`Player doesn't have cards of demanded suit (${this.demandedSuit}) - can play any card`);
    return true;
  }

  playRandomCard(seatId, callback) {
    console.log("\n=== Playing Random Card ===");
    console.log(`Attempting to play card for seat ${seatId}`);

    const seat = this.seats[seatId];
    if (!seat || seat.hand.length === 0) {
      console.log(`Invalid seat or no cards in hand`);
      return null;
    }

    let cardToPlay;
    const isFirstPlayer = this.currentRoundCards.length === 0;

    // Si c'est le premier joueur du tour
    if (isFirstPlayer) {
      cardToPlay = seat.hand[0]; // Jouer la première carte
      this.demandedSuit = cardToPlay.suit; // Définir la couleur demandée
      console.log(`First player - setting demanded suit to: ${cardToPlay.suit}`);
    } else {
      // Chercher une carte de la couleur demandée
      const validCards = seat.hand.filter(card => card.suit === this.demandedSuit);
      console.log(`Looking for cards of suit ${this.demandedSuit}:`, validCards);

      if (validCards.length > 0) {
        // Jouer la plus haute carte de la couleur demandée
        const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        cardToPlay = validCards.reduce((highest, current) => {
          return ranks.indexOf(current.rank) > ranks.indexOf(highest.rank) ? current : highest;
        });
        console.log(`Playing highest card of demanded suit:`, cardToPlay);
      } else {
        // Si pas de carte de la couleur demandée, jouer la plus basse carte
        cardToPlay = seat.hand[0];
        console.log(`No cards of demanded suit, playing:`, cardToPlay);
      }
    }

    console.log(`Playing card for seat ${seatId}:`, cardToPlay);

    // Jouer la carte
    seat.playOneCard(cardToPlay);

    // Créer l'objet carte jouée
    const playedCard = {
      seatId: seatId,
      card: cardToPlay
    };

    // Ajouter la carte jouée à l'historique du tour
    this.currentRoundCards.push(playedCard);

    console.log(`Current round cards:`, this.currentRoundCards);
    console.log(`Demanded suit: ${this.demandedSuit}`);
    console.log(`Cards remaining in hand: ${seat.hand.length}`);

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
      console.log("\n=== Changing Turn ===");
      console.log("Last turn:", lastTurn);
      // this.updateHistory();

      // Nettoyer le timer du tour précédent
      this.clearTurnTimer();

      if (this.handOver) {
        console.log("Hand is over - no more turns");
        return;
      }

      // Afficher l'état actuel des mains
      console.log("Current state of hands:");
      Object.entries(this.seats).forEach(([seatId, seat]) => {
        if (seat) {
          console.log(`Seat ${seatId}: ${seat.hand.length} cards, folded: ${seat.folded}`);
        }
      });

      // Vérifier si le tour actuel est terminé
      if (this.isRoundComplete()) {
        console.log("Round is complete - determining winner...");
        const roundWinner = this.findRoundWinner();
        console.log(`Round winner determined: ${roundWinner}`);

        // Vérifier si tous les joueurs ont joué toutes leurs cartes
        const activePlayers = this.activePlayers();
        const playersWithCards = activePlayers.filter(seat => seat.hand.length > 0);
        console.log("Players with cards remaining:", playersWithCards.map(p => p.id));

        if (this.roundNumber > 5) {
          console.log("Game over condition met:");
          console.log("- Players with cards:", playersWithCards.length);
          console.log("- Round number:", this.roundNumber);

          this.handOver = true;
          this.lastWinningSeat = roundWinner;
          this.determinePotWinner();
          return;
        }

        // Démarrer un nouveau tour avec le gagnant comme premier joueur
        this.turn = parseInt(roundWinner);
        this.startNewRound();
        console.log(`Starting round ${this.roundNumber} with winner of last round (${roundWinner})`);

        // Mettre à jour le tour pour tous les sièges
        this.updateSeatsForNewTurn();
        return;
      }

      // Si le tour n'est pas terminé, passer au joueur suivant
      let nextPlayer = this.nextActivePlayer(lastTurn, 1);
      console.log("Next player in current round:", nextPlayer);

      if (nextPlayer && this.seats[nextPlayer] && this.seats[nextPlayer].hand.length > 0) {
        // Nettoyer l'ancien timer avant de changer de tour
        this.clearTurnTimer();

        this.turn = parseInt(nextPlayer);
        console.log("Setting turn to:", this.turn);

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
        console.log("No valid next player found - ending hand");
        this.handOver = true;
      }
    } catch (error) {
      console.error("Error in changeTurn:", error);
      this.handOver = true;
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

        console.log(`i : ${i}`);
        console.log(`seatId : ${this.seats[i].id}`);
        console.log(`seat turn : ${this.seats[i].turn}`);
        console.log(`Table turn : ${this.turn} (parsed: ${currentTurn})`);
      }
    }
    console.log(`Turn updated for all seats. Current turn: ${this.turn}`);
  }

  determinePotWinner() {
    // Le gagnant est le dernier joueur qui aurait commencé le tour suivant
    if (this.lastWinningSeat) {
      const winner = this.seats[this.lastWinningSeat];
      if (winner) {
        winner.winHand(this.pot);
        this.winMessages.push(
          `${winner.player.name} wins $${this.pot.toFixed(2)}`
        );
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

  dealCard() {
    try {
      console.log("Starting dealCard...");
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
            console.log(`Dealt ${card.rank} of ${card.suit} to player ${seat.player.name} in seat ${order[j]}`);
            seat.turn = order[j] === this.turn;
          }
        }
      }
      console.log("Dealing complete");
    } catch (error) {
      console.error("Error in dealCard:", error);
      throw error;
    }
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
