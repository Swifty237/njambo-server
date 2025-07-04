const _ = require('underscore');
const lodash = require('lodash');
const Hand = require('pokersolver').Hand;
const Seat = require('./Seat');
const Deck = require('./Deck');
const SidePot = require('./SidePot');
const Player = require('./Player');
const { findBestCombination, compareCombinations } = require('./Combinations');
const ChatRoom = require('./ChatRoom');

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
    this.lastRoundWinner = null;
    this.pot = 0;
    this.callAmount = null;
    this.handOver = true;
    this.handCompleted = false;   // Pour éviter les doubles démarrages de main
    this.winMessages = [];
    this.gameNotifications = [];
    this.history = [];
    this.deck = null;
    this.turnTimer = null;        // Timer pour le tour actuel
    this.turnTime = 30000;        // Temps en millisecondes pour jouer (30 secondes)
    this.demandedSuit = null;     // Couleur demandée pour le tour actuel
    this.currentRoundCards = [];   // Cartes jouées dans le tour actuel
    this.roundNumber = 1;
    this.countHand = 0;         // Numéro du tour actuel (1-5)
    this.handParticipants = [];   // Mémoire tampon des joueurs qui participent à la main en cours
    this.wonByCombination = false; // Flag pour indiquer une victoire par combinaison
    this.onTurnChanged = null;    // Callback pour notifier du changement de tour
    this.chatRoom = new ChatRoom();
    this.link = null;
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
    if (!socketId) return;

    this.players = this.players.filter(
      (player) => player && player.socketId && player.socketId !== socketId,
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
    if (!socketId) return;

    for (let i of Object.keys(this.seats)) {
      if (this.seats[i] && this.seats[i].player && this.seats[i].player.socketId === socketId) {
        this.seats[i] = null;
      }
    }

    const satPlayers = Object.values(this.seats).filter((seat) => seat != null);

    if (satPlayers.length === 0) {
      this.resetEmptyTable();
    }
  }

  findPlayerBySocketId(socketId) {
    if (!socketId) return null;

    for (let i = 1; i <= this.maxPlayers; i++) {
      if (this.seats[i] && this.seats[i].player && this.seats[i].player.socketId === socketId) {
        return this.seats[i];
      }
    }
    return null;
  }

  activePlayers() {
    return Object.values(this.seats).filter(
      (seat) => seat != null && !seat.sittingOut,
    );
  }

  // Retourne les joueurs qui participent à la main en cours
  // Si une main est en cours, utilise handParticipants, sinon utilise activePlayers
  currentHandPlayers() {
    if (!this.handOver && this.handParticipants.length > 1) {
      // Pendant une main, utiliser seulement les participants enregistrés
      return this.handParticipants.filter(seatId =>
        this.seats[seatId] && !this.seats[seatId].sittingOut
      ).map(seatId => this.seats[seatId]);
    } else {
      // Hors main, utiliser tous les joueurs actifs
      return this.activePlayers();
    }
  }

  nextActivePlayer(player, places) {
    // S'assurer que player et places sont des nombres valides
    if (!player || isNaN(player) || !places || isNaN(places)) {
      return 1;
    }

    // Convertir en nombres et s'assurer qu'ils sont dans les limites
    let playerNum = parseInt(player);
    let placesToMove = parseInt(places);

    if (playerNum < 1 || playerNum > this.maxPlayers || placesToMove < 1) {
      return 1;
    }

    // Obtenir les joueurs actifs
    const currentPlayers = this.currentHandPlayers();

    // S'il n'y a pas de joueurs ou un seul joueur
    if (currentPlayers.length === 0) {
      return 1;
    }
    if (currentPlayers.length === 1) {
      return playerNum;
    }

    // Construire un tableau des seatId des joueurs participants
    const activePlayerIds = currentPlayers.map(seat => parseInt(seat.id));

    // Garder la position de départ
    const startingSeat = playerNum;
    let currentSeat = playerNum;
    let iterations = 0;
    const maxIterations = this.maxPlayers + 1; // Éviter les boucles infinies

    // Boucle pour trouver le prochain joueur actif
    do {
      // Calculer le prochain siège avec wrap-around
      currentSeat = currentSeat + placesToMove;
      if (currentSeat > this.maxPlayers) {
        currentSeat = currentSeat - this.maxPlayers;
      }

      // Si on trouve un joueur actif, le retourner
      if (activePlayerIds.includes(currentSeat)) {
        return currentSeat;
      }

      iterations++;
    } while (currentSeat !== startingSeat && iterations < maxIterations);

    // Si on a fait le tour complet sans trouver de joueur actif
    return activePlayerIds[0] || 1;
  }

  startHand() {
    try {
      this.deck = new Deck();

      this.resetPot();
      this.clearSeatHands();
      this.clearSeatPlayedHands();
      this.resetBetsAndActions();
      this.unfoldPlayers();
      this.history = [];
      this.clearWinMessages();
      this.clearGameNotifications();
      this.handCompleted = false;  // Réinitialiser le flag pour permettre les callbacks

      // Initialiser les variables pour le nouveau système de jeu
      this.demandedSuit = null;
      this.currentRoundCards = [];
      this.roundNumber = 1;

      // Au début d'une nouvelle main, on utilise activePlayers() pour obtenir tous les joueurs disponibles
      const availablePlayers = this.activePlayers();

      if (availablePlayers.length > 1) {
        // Enregistrer les participants à cette main
        this.handParticipants = availablePlayers.map(seat => seat.id);

        if (this.countHand > 0) {
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

        this.handOver = false; // Définir handOver à false AVANT de configurer les tours

        this.setBlinds();
        this.setButton();
        this.dealCard();
        this.updateHistory();

        this.countHand++;

        // S'assurer que le callback est configuré avant de démarrer les timers
        if (!this.onAutoPlayCard) {
          console.warn('Warning: onAutoPlayCard callback is not configured in startHand');
        }
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
          if (seat && !seat.sittingOut && seat.bet !== 0) {
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

  // Méthode utilitaire pour gérer l'attribution du tour et le timer
  setPlayerTurn(newTurn) {
    // Éviter de définir un nouveau tour si la main est terminée
    if (this.handCompleted) {
      return;
    }

    // Nettoyer tout timer existant
    this.clearTurnTimer();

    // Mettre à jour le tour
    this.turn = parseInt(newTurn);

    // Vérifier que le siège existe avant d'accéder aux propriétés
    if (this.seats[this.turn] && this.seats[this.turn].player) {
      let gameNotification = `C'est à ${this.seats[this.turn].player.name} de jouer!`;
      this.gameNotifications.push(gameNotification);
    } else {
      console.error(`[setPlayerTurn] Invalid seat or player for turn ${this.turn}`);
      return;
    }

    // Mettre à jour le statut des sièges
    for (let i = 1; i <= this.maxPlayers; i++) {
      if (this.seats[i]) {
        this.seats[i].turn = (i === this.turn);
      }
    }

    // Démarrer immédiatement un nouveau timer si c'est un tour valide
    if (this.turn && this.seats[this.turn] && !this.handOver) {
      this.startTurnTimer(
        this.turn,
        (seatId) => {
          const result = this.chooseRandomCard(seatId);
          if (result) {
            if (this.onAutoPlayCard) {
              // Le changement de tour sera géré par le callback onAutoPlayCard
              this.onAutoPlayCard(seatId, result.card);
            }
            // Ne pas appeler changeTurn ici car il sera appelé par le callback
          }
        }
      );
    }
  }

  setButton() {
    const currentPlayers = this.currentHandPlayers();

    // Vérifier s'il y a des joueurs actifs
    if (currentPlayers.length === 0) {
      return;
    }

    // Si c'est la première main (this.countHand === 0), le button est déjà défini
    // mais il faut quand même définir le premier joueur
    if (this.countHand === 0) {
      if (this.button && this.seats[this.button]) {
        this.setPlayerTurn(this.button);
      } else {
        // Si le button n'est pas valide, prendre le premier joueur actif
        this.button = currentPlayers[0].id;
        this.setPlayerTurn(this.button);
      }
    } else {
      // Sinon, le bouton devient le précédent vainqueur
      const nextButton = this.lastWinningSeat;
      if (nextButton && this.seats[nextButton]) {
        this.button = nextButton;
      } else {
        // Si pas de vainqueur valide, prendre le premier joueur actif
        this.button = currentPlayers[0].id;
      }
    }

    // S'il y a moins d'un joueur sur la table, le bouton c'est le dernier joueur restant
    if (currentPlayers.length === 1) {
      this.button = currentPlayers[0].id;
    }

    // Si ce n'est pas la première main de la partie, mais que c'est le premier joueur de la nouvelle main
    // (currentRoundCards = [] ou roundNumber = 1), le joueur button doit être le premier à jouer
    if (this.countHand > 0 && (this.currentRoundCards.length === 0 || this.roundNumber === 1)) {
      if (this.button && this.seats[this.button]) {
        this.setPlayerTurn(this.button);
      }
    }
  }

  setBlinds() {
    try {
      // Placer les blinds - seuls les joueurs participants à cette main placent une mise
      const betAmount = Number(this.bet);
      const currentPlayers = this.currentHandPlayers();
      let totalBets = 0;

      // Seuls les joueurs participants placent une blind égale à la mise de départ
      for (let i = 1; i <= this.maxPlayers; i++) {
        const seat = this.seats[i];
        if (seat && this.handParticipants.includes(seat.id) && !seat.sittingOut) {
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
        this.seats[i].showingCards = false; // Réinitialiser l'état des cartes montrées
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

  clearGameNotifications() {
    this.gameNotifications = [];
  }

  endHand() {
    this.clearSeatTurns();
    this.handOver = true;
    this.sitOutFeltedPlayers();
    this.handlePendingSitoutSitin();
    this.handParticipants = [];  // Réinitialiser la liste des participants
  }

  sitOutFeltedPlayers() {
    for (let i of Object.keys(this.seats)) {
      const seat = this.seats[i];
      if ((seat && seat.stack == 0) || (seat && seat.stack < 0)) {
        seat.sittingOut = true;
      }
    }
  }

  handlePendingSitoutSitin() {
    // Gérer les joueurs qui ont demandé à passer en sitout pendant la main
    for (let i of Object.keys(this.seats)) {
      const seat = this.seats[i];
      if (seat) {
        if (seat.wantsSitout) {
          seat.sittingOut = true;
          seat.wantsSitout = false;
        }
        if (seat.wantsSitin) {
          seat.sittingOut = false;
          seat.wantsSitin = false;
        }
      }
    }
  }

  resetEmptyTable() {
    this.button = null;
    this.turn = null;
    this.handOver = true;
    this.deck = null;
    this.resetPot();
    this.clearWinMessages();
    this.clearGameNotifications();
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

    // Réinitialiser les variables du tour
    this.currentRoundCards = [];
    this.demandedSuit = null;

    // S'assurer que le dernier gagnant commence le nouveau round
    if (this.lastRoundWinner) {
      this.turn = this.lastRoundWinner;
    }

    // Vérifier s'il reste des joueurs participants avec des cartes
    const currentPlayers = this.currentHandPlayers().filter(seat => seat.hand.length > 0);
    if (currentPlayers.length < 2) {
      this.handOver = true;
      return;
    }
  }

  // Trouver le gagnant du tour actuel
  findRoundWinner() {
    try {
      if (this.currentRoundCards.length === 0) {
        return this.turn; // Retourner le joueur actuel si aucune carte n'a été jouée
      }

      // Le premier joueur du tour
      const firstPlayer = parseInt(this.currentRoundCards[0].seatId);
      if (!this.seats[firstPlayer]) {
        console.error(`[findRoundWinner] Invalid first player seat: ${firstPlayer}`);
        return null;
      }

      // Vérifier si tous les joueurs participants ont joué
      const currentPlayers = this.currentHandPlayers().filter(seat =>
        seat.hand.length > 0 || this.currentRoundCards.some(card => parseInt(card.seatId) === parseInt(seat.id))
      );
      const playersWhoPlayed = [...new Set(this.currentRoundCards.map(card => parseInt(card.seatId)))];

      if (!currentPlayers.every(seat => playersWhoPlayed.includes(parseInt(seat.id)))) {
        return firstPlayer;
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
        this.lastWinningSeat = parseInt(highestCard.seatId);
      }
      return parseInt(highestCard.seatId);

    } catch (error) {
      console.error(`[findRoundWinner] Error:`, error);
      // En cas d'erreur, retourner le premier joueur comme fallback
      return this.currentRoundCards.length > 0 ? parseInt(this.currentRoundCards[0].seatId) : this.turn;
    }
  }

  // Vérifier si un tour est terminé
  isRoundComplete() {
    // Obtenir tous les joueurs participants qui ont encore des cartes
    const currentPlayers = this.currentHandPlayers();
    const playersWithCards = currentPlayers.filter(seat => seat.hand.length > 0);

    // Obtenir les joueurs qui ont joué ce tour (sans doublons, en s'assurant que tous sont des nombres)
    const playersWhoPlayed = [...new Set(this.currentRoundCards.map(card => parseInt(card.seatId)))];

    // Si aucun joueur n'a de cartes, le jeu est terminé
    if (playersWithCards.length === 0) {
      return true;
    }

    // Un tour est complet quand tous les joueurs avec des cartes ont joué une fois dans ce tour
    return playersWithCards.every(seat =>
      playersWhoPlayed.includes(parseInt(seat.id))
    );
  }

  // Méthodes pour gérer le timer de tour
  startTurnTimer(seatId, callback) {
    // Vérifier si le siège est toujours valide
    if (!this.seats[seatId] || this.handOver) {
      return;
    }

    // Créer un nouveau timer
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;

      // Vérifier à nouveau si le siège est toujours valide
      if (this.seats[seatId] && !this.handOver && this.turn === seatId) {
        // Exécuter le callback dans un try-catch
        if (callback) {
          try {
            callback(seatId);
          } catch (error) {
            console.error(`Error in timer callback for seat ${seatId}:`, error);
          }
        }
      } else {
        // Passer au joueur suivant si les conditions ne sont pas remplies
        const nextPlayer = this.nextActivePlayer(seatId, 1);
        if (nextPlayer && nextPlayer !== seatId) {
          this.changeTurn(seatId);
          // Exécuter le callback onTurnChanged si défini
          if (this.onTurnChanged) {
            this.onTurnChanged(this, `${this.seats[seatId]?.player?.name || 'Le joueur'} a quitté la table`);
          }
        }
      }
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

  chooseRandomCard(seatId, callback) {
    const seat = this.seats[seatId];
    if (!seat || seat.hand.length === 0) {
      this.endHand()
      return null;
    }

    let cardToPlay;
    const isFirstPlayer = this.currentRoundCards.length === 0;

    // Si c'est le premier joueur du tour
    if (isFirstPlayer && this.demandedSuit === null) {
      // Pour le premier joueur, choisir une carte au hasard
      const randomIndex = Math.floor(Math.random() * seat.hand.length);
      cardToPlay = seat.hand[randomIndex];
      this.demandedSuit = cardToPlay.suit; // Définir la couleur demandée
    } else {
      // Chercher toutes les cartes de la couleur demandée
      const validCards = seat.hand.filter(card => card.suit === this.demandedSuit);

      if (validCards.length > 0) {
        // Choisir une carte au hasard parmi les cartes valides
        const randomIndex = Math.floor(Math.random() * validCards.length);
        cardToPlay = validCards[randomIndex];
      } else {
        // Si pas de carte de la couleur demandée, choisir une carte au hasard
        const randomIndex = Math.floor(Math.random() * seat.hand.length);
        cardToPlay = seat.hand[randomIndex];
      }
    }

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
      // Éviter les changements de tour multiples
      if (this.handCompleted) {
        return;
      }

      // Nettoyer le timer du tour précédent
      this.clearTurnTimer();

      if (this.handOver) {
        return;
      }

      const roundComplete = this.isRoundComplete();

      // Vérifier si le tour actuel est terminé
      if (roundComplete) {
        this.lastRoundWinner = this.findRoundWinner();

        // Vérifier si c'est la fin du jeu (5 tours ou plus)
        if (this.roundNumber >= 5) {
          this.handOver = true;
          this.turn = null;
          this.lastWinningSeat = this.lastRoundWinner;
          this.determinePotWinner();
          return;
        }

        // Vérifier s'il reste des joueurs avec des cartes pour le prochain tour
        const currentPlayers = this.currentHandPlayers();
        const playersWithCards = currentPlayers.filter(seat => seat.hand.length > 0);

        if (playersWithCards.length < 2) {
          this.handOver = true;
          this.turn = null;
          //Le gagnant dans ce cas c'est le dernier joueur restant
          this.lastWinningSeat = this.lastRoundWinner;
          this.determinePotWinner();
          return;
        }

        // Démarrer un nouveau tour avec le gagnant comme premier joueur
        this.startNewRound();
        this.setPlayerTurn(this.lastRoundWinner);
        return;
      }

      // Si le tour n'est pas terminé, passer au joueur suivant
      let nextPlayer = this.nextActivePlayer(lastTurn, 1);

      // Vérifier s'il reste des joueurs avec des cartes
      const playersWithCards = this.currentHandPlayers().filter(seat => seat.hand.length > 0);
      if (playersWithCards.length === 0) {
        this.handOver = true;
        this.lastWinningSeat = this.findRoundWinner();
        this.determinePotWinner();
        return;
      }

      if (nextPlayer && this.seats[nextPlayer] && this.seats[nextPlayer].hand.length > 0) {
        this.setPlayerTurn(nextPlayer);
      } else {
        this.handOver = true;

        // Déterminer le gagnant du dernier tour joué
        if (this.currentRoundCards.length > 0) {
          this.lastRoundWinner = this.findRoundWinner();
        }

        // Si c'est le dernier tour (5ème), déterminer le gagnant final
        if (this.roundNumber >= 5) {
          this.lastWinningSeat = this.lastRoundWinner;
          this.determinePotWinner();
        } else {
          // Sinon, commencer un nouveau tour avec le dernier gagnant
          this.startNewRound();
          this.setPlayerTurn(this.lastRoundWinner);
        }
      }
    } catch (error) {
      console.error("[changeTurn] Error:", error);
      this.handOver = true;

      if (this.currentRoundCards.length > 0) {
        this.lastRoundWinner = this.findRoundWinner();
      }
      this.lastWinningSeat = this.lastRoundWinner;
      this.determinePotWinner();
    }
  }


  determinePotWinner() {
    // Vérifier d'abord les combinaisons gagnantes des joueurs qui montrent leurs cartes
    let bestCombo = null;
    let winnerByCombination = null;

    for (let i = 1; i <= this.maxPlayers; i++) {
      const seat = this.seats[i];
      // On vérifie que le joueur montre ses cartes ET qu'il a toujours ses 5 cartes
      if (seat && seat.showingCards && seat.hand.length === 5) {
        const combo = findBestCombination(seat.hand);
        if (combo) {
          if (!bestCombo || compareCombinations(combo, bestCombo) > 0) {
            bestCombo = combo;
            winnerByCombination = seat;
          }
        }
      }
    }

    // Si un joueur a une combinaison gagnante, il gagne immédiatement
    if (winnerByCombination) {
      this.lastWinningSeat = winnerByCombination.id;

      const comboNames = {
        'FOUR_OF_A_KIND': 'carré',
        'THREE_SEVENS': 'trois sept',
        'TIA': 'tia'
      };

      const winMessage = `${winnerByCombination.player.name} gagne avec un ${comboNames[bestCombo.type]}!`;
      this.winMessages.push(winMessage);

      // Mettre le bet de tous les joueurs à zéro
      for (let i = 1; i <= this.maxPlayers; i++) {
        if (this.seats[i]) {
          this.seats[i].bet = 0;
        }
      }

      // Attribuer le pot au gagnant
      winnerByCombination.winHand(this.pot);

      // Marquer qu'il y a eu une victoire par combinaison
      this.wonByCombination = true;

      // Terminer la main actuelle
      this.endHand();

      // Déclencher le callback pour notifier la fin de la main
      if (this.onHandComplete && !this.handCompleted) {
        this.handCompleted = true;
        this.onHandComplete();
      }
      return;
    }

    // Si personne n'a de combinaison gagnante, utiliser la logique normale du dernier gagnant
    if (this.lastWinningSeat) {
      const winner = this.seats[this.lastWinningSeat];

      // Vérifier si c'est un showdown sans combinaison gagnante
      let wasShowdown = false;
      for (let i = 1; i <= this.maxPlayers; i++) {
        if (this.seats[i] && this.seats[i].showingCards) {
          wasShowdown = true;
          break;
        }
      }

      // Si c'était un showdown sans combinaison gagnante, continuer la partie normalement
      if (wasShowdown) {
        return;
      }

      if (winner) {
        let winMessage = `${winner.player.name} gagne la main!`;
        this.winMessages.push(winMessage);

        // Vérifier la dernière carte du gagnant
        const lastCard = this.getLastPlayedCard(this.lastWinningSeat);
        if (lastCard && this.isRankThree(lastCard)) {
          // Vérifier les deux dernières cartes
          const lastTwoCards = this.getLastTwoPlayedCards(this.lastWinningSeat);
          if (lastTwoCards.length === 2 && this.isRankThree(lastTwoCards[0]) && this.isRankThree(lastTwoCards[1])) {
            winMessage = `${winner.player.name} à mis la 33 et vous avez bu!`;
            this.winMessages.push(winMessage);

            // Collecter les mises deux fois
            this.collectBetsExcept(this.lastWinningSeat);
            this.collectBetsExcept(this.lastWinningSeat);
          } else {
            winMessage = `${winner.player.name} à mis le korat, c'est dedans!`;
            this.winMessages.push(winMessage);

            // Collecter les mises une fois
            this.collectBetsExcept(this.lastWinningSeat);
          }
        }

        // Mettre le bet de tous les joueurs à zéro
        for (let i = 1; i <= this.maxPlayers; i++) {
          if (this.seats[i]) {
            this.seats[i].bet = 0;
          }
        }

        // Attribuer le pot au gagnant et terminer la main
        winner.winHand(this.pot);
        this.endHand();

        // Déclencher le callback pour notifier la fin de la main
        if (this.onHandComplete && !this.handCompleted) {
          this.handCompleted = true;
          this.onHandComplete();
        }
      } else {
        console.error(`[determinePotWinner] Winner seat ${this.lastWinningSeat} not found`);
      }
    } else {
      console.error(`[determinePotWinner] No winner determined`);
    }
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

  /**
   * Collecte les mises des joueurs ayant participé au dernier tour sauf celui spécifié
   * @param {number} exceptSeatId - L'ID du siège dont la mise ne doit pas être collectée
   * @returns {number} Le montant total collecté
   */
  collectBetsExcept(exceptSeatId) {
    let totalCollected = 0;

    // Vérifier si des cartes ont été jouées ce tour
    if (this.currentRoundCards.length === 0) {
      return 0;
    }

    // Récupérer les IDs uniques des joueurs ayant participé
    const playersWhoPlayed = [...new Set(this.currentRoundCards.map(card => parseInt(card.seatId)))];

    // Pour chaque joueur ayant joué
    playersWhoPlayed.forEach(seatId => {
      // Ne pas collecter pour le siège excepté
      if (seatId !== exceptSeatId) {
        const seat = this.seats[seatId];
        if (seat) {
          // Soustraire le bet du stack du joueur
          seat.stack -= parseInt(this.bet);
          // Ajouter au pot
          this.pot += parseInt(this.bet);
          // Ajouter au total collecté
          totalCollected += parseInt(this.bet);
        }
      }
    });

    return totalCollected;
  }

  /**
   * Récupère la dernière carte jouée par un joueur spécifique
   * @param {number} seatId - L'ID du siège du joueur
   * @returns {Object|null} La dernière carte jouée par le joueur ou null si aucune carte trouvée
   */
  getLastPlayedCard(seatId) {
    // Si aucune carte n'a été jouée ce tour
    if (this.currentRoundCards.length === 0) {
      return null;
    }

    // Parcourir les cartes en sens inverse pour trouver la dernière carte du joueur
    for (let i = this.currentRoundCards.length - 1; i >= 0; i--) {
      const playedCard = this.currentRoundCards[i];
      if (parseInt(playedCard.seatId) === parseInt(seatId)) {
        return playedCard.card;
      }
    }

    return null;
  }

  /**
   * Récupère les deux dernières cartes jouées par un joueur spécifique
   * @param {number} seatId - L'ID du siège du joueur
   * @returns {Array} Un tableau contenant les deux dernières cartes jouées (peut contenir 0, 1 ou 2 cartes)
   */
  getLastTwoPlayedCards(seatId) {
    const lastCards = [];

    // Si aucune carte n'a été jouée ce tour
    if (this.currentRoundCards.length === 0) {
      return lastCards;
    }

    // Parcourir les cartes en sens inverse pour trouver les deux dernières cartes du joueur
    for (let i = this.currentRoundCards.length - 1; i >= 0 && lastCards.length < 2; i--) {
      const playedCard = this.currentRoundCards[i];
      if (parseInt(playedCard.seatId) === parseInt(seatId)) {
        lastCards.push(playedCard.card);
      }
    }

    return lastCards;
  }

  /**
   * Vérifie si une carte est de rang 3
   * @param {Object} card - La carte à vérifier
   * @returns {boolean} true si la carte est un 3, false sinon
   */
  isRankThree(card) {
    if (!card || !card.rank) {
      return false;
    }

    return card.rank === '3';
  }
}

module.exports = Table;
