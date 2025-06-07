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
    this.mainPot = 0;
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

    // Place initial bet equal to bet amount
    const betAmount = Number(this.bet);
    this.seats[seatId].bet = betAmount;
    this.seats[seatId].stack -= betAmount;

    const firstPlayer =
      Object.values(this.seats).filter((seat) => seat != null).length === 1;

    this.button = firstPlayer ? seatId : this.button;

    console.log("Player seated:", {
      seatId,
      playerName: player.name,
      initialBet: betAmount,
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

    // if (satPlayers.length === 1) {
    //   this.endWithoutShowdown();
    // }

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

  nextUnfoldedPlayer(player, places) {
    console.log(`Finding next unfolded player from ${player}, places: ${places}`);
    let i = 0;
    let current = parseInt(player); // S'assurer que current est un nombre
    let loopCount = 0;
    const maxLoops = this.maxPlayers * 2; // Limiter le nombre de boucles

    while (i < places && loopCount < maxLoops) {
      // Calculer le prochain siège en s'assurant qu'il reste dans les limites
      current = current === this.maxPlayers ? 1 : current + 1;
      let seat = this.seats[current];

      console.log(`Checking seat ${current}:`, seat ?
        `folded=${seat.folded}, cards=${seat.hand.length}` :
        'empty');

      // Un joueur valide doit avoir des cartes et ne pas être folded
      if (seat && !seat.folded && seat.hand.length > 0) {
        i++;
        console.log(`Found valid player at seat ${current}, count: ${i}`);
      }

      loopCount++;

      // Si on a fait le tour complet sans trouver de joueur valide
      if (loopCount >= this.maxPlayers && i === 0) {
        console.log("No valid players found after checking all seats");
        return parseInt(player); // Retourner le joueur initial
      }
    }

    if (loopCount >= maxLoops) {
      console.log("Warning: Max loop count reached in nextUnfoldedPlayer");
      return parseInt(player); // Retourner le joueur initial en cas de problème
    }

    console.log(`nextUnfoldedPlayer returning: ${current}`);
    return current;
  }

  nextActivePlayer(player, places) {
    console.log(`nextActivePlayer called with player: ${player}, places: ${places}`);
    let i = 0;
    let current = parseInt(player); // S'assurer que current est un nombre
    let loopCount = 0;
    const maxLoops = this.maxPlayers * 2; // Limiter le nombre de boucles

    while (i < places && loopCount < maxLoops) {
      // Calculer le prochain siège en s'assurant qu'il reste dans les limites
      current = current === this.maxPlayers ? 1 : current + 1;
      let seat = this.seats[current];

      console.log(`Checking seat ${current}:`, seat ?
        `Player: ${seat.player.name}, sittingOut: ${seat.sittingOut}` :
        'Empty');

      if (seat && !seat.sittingOut) {
        i++;
        console.log(`Found active player at seat ${current}, count: ${i}`);
      }

      loopCount++;

      // Si on a fait le tour complet sans trouver de joueur actif
      if (loopCount >= this.maxPlayers && i === 0) {
        console.log("No active players found after checking all seats");
        return parseInt(player); // Retourner le joueur initial
      }
    }

    if (loopCount >= maxLoops) {
      console.log("Warning: Max loop count reached in nextActivePlayer");
      return parseInt(player); // Retourner le joueur initial en cas de problème
    }

    console.log(`nextActivePlayer returning: ${current}`);
    return current;
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
      this.resetBetsAndActions();
      this.unfoldPlayers();
      this.history = [];

      console.log("Active players:", this.activePlayers().length);
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

      if (this.activePlayers().length > 1) {
        console.log("Multiple players detected, initializing game...");

        console.log("Moving button...");
        // Si on a un gagnant de la main précédente, il devient le nouveau dealer
        if (
          this.lastWinningSeat &&
          this.seats[this.lastWinningSeat] &&
          !this.seats[this.lastWinningSeat].sittingOut) {
          this.button = this.lastWinningSeat;
          console.log("New button position (last winner):", this.button);
        } else {
          this.button = this.nextActivePlayer(this.button, 1);
          console.log("New button position (next active):", this.button);
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
      console.log("3 or fewer players, setting turn to button:", this.button);
      this.turn = this.nextActivePlayer(this.button, 1);
    } else {
      this.turn = this.activePlayers[0]
    }
    console.log("Turn set to:", this.turn);
  }

  setBlinds() {
    console.log("Setting blinds...");

    try {
      // Trouver la position du prochain joueur actif
      // const nextPlayer = this.nextActivePlayer(this.button, 1);
      // console.log("Next active player position:", nextPlayer);

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

  // endWithoutShowdown() {
  //   const winner = this.unfoldedPlayers()[0];
  //   winner && winner.winHand(this.pot);
  //   winner &&
  //     this.winMessages.push(
  //       `${winner.player.name} wins $${this.pot.toFixed(2)}`,
  //     );
  //   this.endHand();
  // }

  resetEmptyTable() {
    this.button = null;
    this.turn = null;
    this.handOver = true;
    this.deck = null;
    this.wentToShowdown = false;
    this.resetPot();
    this.clearWinMessages();
    this.clearSeats();
  }

  resetPot() {
    this.pot = 0;
    this.mainPot = 0;
  }

  updateHistory() {
    this.history.push({
      pot: +this.pot.toFixed(2),
      mainPot: +this.mainPot.toFixed(2),
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
      console.log("Changing turn from seat:", lastTurn);
      this.updateHistory();

      // Vérifier que lastTurn est valide
      if (!lastTurn || lastTurn < 1 || lastTurn > this.maxPlayers) {
        console.log("Invalid lastTurn:", lastTurn);
        return;
      }

      if (!this.handOver) {
        console.log("Current state of hands:");
        Object.entries(this.seats).forEach(([seatId, seat]) => {
          if (seat) {
            console.log(`Seat ${seatId}: ${seat.hand.length} cards, folded: ${seat.folded}`);
          }
        });

        // Vérifier si tous les joueurs ont joué toutes leurs cartes
        const activePlayers = Object.values(this.seats).filter(seat =>
          seat && !seat.folded && !seat.sittingOut
        );

        const allPlayersFinished = activePlayers.every(seat => seat.hand.length === 0);

        if (allPlayersFinished) {
          console.log("All players have played all their cards");
          this.handOver = true;

          // Déterminer le gagnant de la main
          this.determineMainPotWinner();

          // Réinitialiser les mains jouées
          for (let i = 1; i <= this.maxPlayers; i++) {
            if (this.seats[i]) {
              this.seats[i].playedHand = [];
            }
          }

          return;
        }

        // Trouver le prochain joueur qui a encore des cartes
        let nextPlayer = lastTurn;
        let checkedAllPlayers = false;
        let loopCount = 0;
        const maxLoops = this.maxPlayers + 1; // Éviter une boucle infinie

        while (!checkedAllPlayers && loopCount < maxLoops) {
          nextPlayer = this.nextUnfoldedPlayer(nextPlayer, 1);
          console.log("Checking next player:", nextPlayer);

          const nextSeat = this.seats[nextPlayer];
          if (nextSeat) {
            console.log(`Seat ${nextPlayer} status: cards=${nextSeat.hand.length}, folded=${nextSeat.folded}`);
          }

          // Si on est revenu au joueur initial ou si on a fait le tour complet
          if (nextPlayer === lastTurn || loopCount === this.maxPlayers) {
            console.log("Completed player check cycle");
            checkedAllPlayers = true;
          }

          // Si le joueur a encore des cartes, c'est son tour
          if (nextSeat && !nextSeat.folded && nextSeat.hand.length > 0) {
            this.turn = nextPlayer;
            console.log("Found next player:", nextPlayer);
            break;
          }

          loopCount++;
        }

        if (loopCount >= maxLoops) {
          console.log("Warning: Max loop count reached");
          this.handOver = true;
          return;
        }

        console.log("Next turn set to:", this.turn);
      }

      // Mettre à jour le tour pour tous les sièges
      for (let i = 1; i <= this.maxPlayers; i++) {
        if (this.seats[i]) {
          this.seats[i].turn = i === this.turn;
        }
      }
    } catch (error) {
      console.error("Error in changeTurn:", error);
      this.handOver = true;
    }
  }

  determineMainPotWinner() {
    this.determineWinner(this.pot, Object.values(this.seats).slice());
    this.wentToShowdown = true;
    this.endHand();
  }

  determineWinner(amount, seats) {
    const participants = seats
      .filter((seat) => seat && !seat.folded)
      .map((seat) => {
        // Utiliser les cartes jouées au lieu des cartes en main
        const cards = seat.playedHand.slice();
        const solverCards = this.mapCardsForPokerSolver(cards);
        return {
          seatId: seat.id,
          solverCards,
          handDesc: `${cards.length} cartes jouées` // Description pour le message de victoire
        };
      });

    const findHandOwner = (cards) => {
      const participant = participants.find((participant) =>
        lodash.isEqual(participant.solverCards.sort(), cards),
      );
      return participant.seatId;
    };

    const solverWinners = Hand.winners(
      participants.map((p) => Hand.solve(p.solverCards)),
    );

    const winners = solverWinners.map((winner) => {
      const winningCards = winner.cardPool
        .map((card) => card.value + card.suit)
        .sort();
      const seatId = findHandOwner(winningCards);
      return [seatId, winner.descr];
    });

    for (let i = 0; i < winners.length; i++) {
      const seat = this.seats[winners[i][0]];
      const handDesc = winners[i][1];
      const winAmount = amount / winners.length;

      seat.winHand(winAmount);
      if (winAmount > 0) {
        this.lastWinningSeat = seat.id;  // On sauvegarde le siège gagnant
        // Trouver la description de la main du gagnant
        const winner = participants.find(p => p.seatId === seat.id);
        this.winMessages.push(
          `${seat.player.name} wins $${winAmount.toFixed(2)} (${winner.handDesc})`,
        );
      }
    }

    this.updateHistory();
  }

  mapCardsForPokerSolver(cards) {
    const newCards = cards.map((card) => {
      const suit = card.suit.slice(0, 1);
      let rank;
      if (card.rank === '10') {
        rank = 'T';
      } else {
        rank =
          card.rank.length > 1
            ? card.rank.slice(0, 1).toUpperCase()
            : card.rank;
      }
      return rank + suit;
    });
    return newCards;
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
      console.log("Deal order:", order);

      // deal 5 cards to each seated player
      for (let i = 0; i < 5; i++) {
        console.log(`Dealing round ${i + 1}...`);
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
      console.log("Preflop dealing complete");
    } catch (error) {
      console.error("Error in dealCard:", error);
      throw error;
    }
  }

  // dealFlop() {
  //   for (let i = 0; i < 3; i++) {
  //     this.board.push(this.deck.draw());
  //   }
  // }

  // dealTurnOrRiver() {
  //   this.board.push(this.deck.draw());
  // }

  handleFold(socketId) {
    let seat = this.findPlayerBySocketId(socketId);

    if (seat) {
      seat.fold();

      return {
        seatId: seat.id,
        message: `${seat.player.name} folds`,
      };
    } else {
      return null;
    }
  }

  handleCall(socketId) {
    let seat = this.findPlayerBySocketId(socketId);

    if (seat) {
      let addedToPot =
        this.callAmount > seat.stack + seat.bet
          ? seat.stack
          : this.callAmount - seat.bet;

      seat.callRaise(this.callAmount);
      this.pot += addedToPot;

      return {
        seatId: seat.id,
        message: `${seat.player.name} calls $${addedToPot.toFixed(2)}`,
      };
    } else {
      return null;
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

  handleRaise(socketId, amount) {
    let seat = this.findPlayerBySocketId(socketId);

    if (seat) {
      let addedToPot = amount - seat.bet;

      seat.raise(amount);
      this.pot += addedToPot;

      this.callAmount = amount;

      return {
        seatId: seat.id,
        message: `${seat.player.name} raises to $${amount.toFixed(2)}`,
      };
    } else {
      return null;
    }
  }
}

module.exports = Table;
