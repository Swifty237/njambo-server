const _ = require('underscore');
const lodash = require('lodash');
const Hand = require('pokersolver').Hand;
const Seat = require('./Seat');
const Deck = require('./Deck');
const SidePot = require('./SidePot');
const Player = require('./Player');

class Table {
  constructor(id, name, price, isPrivate, createdAt) {
    this.id = id;
    this.name = name;
    this.price = price;
    this.isPrivate = isPrivate;
    this.createdAt = createdAt;
    this.maxPlayers = 4;
    this.players = [];
    this.seats = this.initSeats(this.maxPlayers);
    this.board = [];
    this.button = null;
    this.turn = null;
    this.pot = 0;
    this.callAmount = null;
    this.smallBlind = this.price;
    this.handOver = true;
    this.winMessages = [];
    this.wentToShowdown = false;
    this.history = [];
    this.deck = null;
    this.sidePots = [];
    this.bigBlind = null;
    this.minRaise = this.price / 100;
    this.minBet = this.price / 200;
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

    // Place initial bet equal to price (small blind)
    const betAmount = Number(this.price);
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

    if (satPlayers.length === 1) {
      this.endWithoutShowdown();
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

  nextUnfoldedPlayer(player, places) {
    let i = 0;
    let current = player;

    while (i < places) {
      current = current === this.maxPlayers ? 1 : current + 1;
      let seat = this.seats[current];

      if (seat && !seat.folded) i++;
    }
    return current;
  }

  nextActivePlayer(player, places) {
    console.log(`nextActivePlayer called with player: ${player}, places: ${places}`);
    let i = 0;
    let current = parseInt(player); // Convertir en nombre
    let checkedPositions = new Set();

    while (i < places && checkedPositions.size < this.maxPlayers) {
      // Avancer à la position suivante
      current = current === this.maxPlayers ? 1 : current + 1;

      // Marquer cette position comme vérifiée
      checkedPositions.add(current);

      let seat = this.seats[current];
      console.log(`Checking seat ${current}:`, seat ? `Player: ${seat.player.name}, sittingOut: ${seat.sittingOut}` : 'Empty');

      if (seat && !seat.sittingOut) {
        i++;
        console.log(`Found active player at seat ${current}, count: ${i}`);
      }
    }

    if (checkedPositions.size >= this.maxPlayers && i < places) {
      console.log("Warning: Checked all positions without finding enough active players");
      return parseInt(player);
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
      this.resetBoardAndPot();
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
        this.button = this.nextActivePlayer(this.button, 1);
        console.log("New button position:", this.button);

        console.log("Setting blinds...");
        this.setBlinds();

        console.log("Setting turn...");
        this.setTurn();
        console.log("Turn set to:", this.turn);

        console.log("Dealing preflop...");
        this.dealPreflop();

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

  dealPreflop() {
    try {
      console.log("Starting dealPreflop...");
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
      console.error("Error in dealPreflop:", error);
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
    if (this.activePlayers().length <= 3) {
      console.log("3 or fewer players, setting turn to button:", this.button);
      this.turn = this.button;
    } else {
      console.log("More than 3 players, finding next active player");
      this.turn = this.nextActivePlayer(this.button, 3);
    }
    console.log("Turn set to:", this.turn);
  }
  setBlinds() {
    console.log("Setting blinds...");
    const activePlayers = this.activePlayers();
    const isHeadsUp = activePlayers.length === 2;

    console.log("Active players:", activePlayers.length, "Heads up:", isHeadsUp);
    console.log("Current button position:", this.button);

    try {
      // Trouver les positions des blinds
      if (isHeadsUp) {
        this.smallBlind = parseInt(this.button);
        this.bigBlind = this.nextActivePlayer(this.button, 1);
      } else {
        this.smallBlind = this.nextActivePlayer(this.button, 1);
        this.bigBlind = this.nextActivePlayer(this.smallBlind, 1); // Utiliser smallBlind comme point de départ
      }

      console.log("Small blind position:", this.smallBlind);
      console.log("Big blind position:", this.bigBlind);

      // Placer les blinds - tous les joueurs actifs placent la même mise
      const blindAmount = Number(this.price);
      const activePlayers = this.activePlayers();
      let totalBlinds = 0;

      console.log("Placing blinds for all active players...");

      // Tous les joueurs actifs placent une blind égale au price
      for (let i = 1; i <= this.maxPlayers; i++) {
        const seat = this.seats[i];
        if (seat && !seat.sittingOut) {
          seat.placeBlind(blindAmount);
          totalBlinds += blindAmount;
          console.log(`Player ${seat.player.name} in seat ${i} placed blind: ${blindAmount}`);
        }
      }

      this.pot = Number(this.pot || 0) + totalBlinds;
      this.callAmount = blindAmount;
      this.minRaise = blindAmount * 2;

      console.log("Blinds set successfully:", {
        totalPlayers: activePlayers.length,
        blindAmountPerPlayer: blindAmount,
        totalBlinds: totalBlinds,
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
  endWithoutShowdown() {
    const winner = this.unfoldedPlayers()[0];
    winner && winner.winHand(this.pot);
    winner &&
      this.winMessages.push(
        `${winner.player.name} wins $${this.pot.toFixed(2)}`,
      );
    this.endHand();
  }
  resetEmptyTable() {
    this.button = null;
    this.turn = null;
    this.handOver = true;
    this.deck = null;
    this.wentToShowdown = false;
    this.resetBoardAndPot();
    this.clearWinMessages();
    this.clearSeats();
  }

  resetBoardAndPot() {
    this.board = [];
    this.pot = 0;
    this.mainPot = 0;
    this.sidePots = [];
  }
  updateHistory() {
    this.history.push({
      pot: +this.pot.toFixed(2),
      mainPot: +this.mainPot.toFixed(2),
      sidePots: this.sidePots.slice(),
      board: this.board.slice(),
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
    this.updateHistory();

    if (this.unfoldedPlayers().length === 1) {
      this.endWithoutShowdown();
      return;
    }

    if (this.actionIsComplete()) {
      this.calculateSidePots();
      while (this.board.length <= 5 && !this.handOver) {
        this.dealNextStreet();
      }
    }

    if (this.allCheckedOrCalled()) {
      this.calculateSidePots();
      this.dealNextStreet();
      this.turn = this.handOver
        ? null
        : this.nextUnfoldedPlayer(this.button, 1);
    } else {
      this.turn = this.nextUnfoldedPlayer(lastTurn, 1);
    }

    for (let i = 1; i <= this.maxPlayers; i++) {
      if (this.seats[i]) {
        this.seats[i].turn = i === this.turn ? true : false;
      }
    }
  }
  allCheckedOrCalled() {
    if (
      this.seats[this.bigBlind] &&
      this.seats[this.bigBlind].bet === this.limit / 100 &&
      !this.seats[this.bigBlind].checked &&
      this.board.length === 0
    ) {
      return false;
    }

    for (let i of Object.keys(this.seats)) {
      const seat = this.seats[i];
      if (seat && !seat.folded && seat.stack > 0) {
        if (
          (this.callAmount &&
            seat.bet.toFixed(2) !== this.callAmount.toFixed(2)) ||
          (!this.callAmount && !seat.checked)
        ) {
          return false;
        }
      }
    }
    return true;
  }
  actionIsComplete() {
    const seats = Object.values(this.seats);

    // everyone but one person is all in and the last person called:
    const seatsToAct = seats.filter(
      (seat) => seat && !seat.folded && seat.stack > 0,
    );
    if (seatsToAct.length === 0) return true;
    return seatsToAct.length === 1 && seatsToAct[0].lastAction === 'CALL';
  }
  playersAllInThisTurn() {
    const seats = Object.values(this.seats);
    return seats.filter(
      (seat) => seat && !seat.folded && seat.bet > 0 && seat.stack === 0,
    );
  }
  calculateSidePots() {
    const allInPlayers = this.playersAllInThisTurn();
    const unfoldedPlayers = this.unfoldedPlayers();
    if (allInPlayers.length < 1) return;

    let sortedAllInPlayers = allInPlayers.sort((a, b) => a.bet - b.bet);
    if (
      sortedAllInPlayers.length > 1 &&
      sortedAllInPlayers.length === unfoldedPlayers.length
    ) {
      sortedAllInPlayers.pop();
    }

    const allInSeatIds = sortedAllInPlayers.map((seat) => seat.id);

    for (const seatId of allInSeatIds) {
      const allInSeat = this.seats[seatId];
      const sidePot = new SidePot();
      if (allInSeat.bet > 0) {
        for (let i = 1; i <= this.maxPlayers; i++) {
          const seat = this.seats[i];
          if (seat && !seat.folded && i !== seatId) {
            const amountOver = seat.bet - allInSeat.bet;
            if (amountOver > 0) {
              if (this.sidePots.length > 0) {
                this.sidePots[this.sidePots.length - 1].amount -= amountOver;
              } else {
                this.pot -= amountOver;
              }
              seat.bet -= allInSeat.bet;
              sidePot.amount += amountOver;
              sidePot.players.push(seat.id);
            }
          }
        }
        allInSeat.bet = 0;
        this.sidePots.push(sidePot);
      }
    }
  }
  dealNextStreet() {
    const length = this.board.length;
    this.resetBetsAndActions();
    this.mainPot = this.pot;
    if (length === 0) {
      this.dealFlop();
    } else if (length === 3 || length === 4) {
      this.dealTurnOrRiver();
    } else if (length === 5) {
      this.determineSidePotWinners();
      this.determineMainPotWinner();
    }
  }
  determineSidePotWinners() {
    if (this.sidePots.length < 1) return;

    this.sidePots.forEach((sidePot) => {
      const seats = sidePot.players.map((id) => this.seats[id]);
      this.determineWinner(sidePot.amount, seats);
    });
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
        const cards = seat.hand.slice().concat(this.board.slice());
        const solverCards = this.mapCardsForPokerSolver(cards);
        return {
          seatId: seat.id,
          solverCards,
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
        this.winMessages.push(
          `${seat.player.name} wins $${winAmount.toFixed(2)} with ${handDesc}`,
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
    this.minRaise = this.price / 200;
  }

  dealPreflop() {
    try {
      console.log("Starting dealPreflop...");
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
      console.error("Error in dealPreflop:", error);
      throw error;
    }
  }

  dealFlop() {
    for (let i = 0; i < 3; i++) {
      this.board.push(this.deck.draw());
    }
  }
  dealTurnOrRiver() {
    this.board.push(this.deck.draw());
  }
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

      if (this.sidePots.length > 0) {
        this.sidePots[this.sidePots.length - 1].amount += addedToPot;
      } else {
        this.pot += addedToPot;
      }

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

      if (this.sidePots.length > 0) {
        this.sidePots[this.sidePots.length - 1].amount += addedToPot;
      } else {
        this.pot += addedToPot;
      }

      this.minRaise = this.callAmount
        ? this.callAmount + (seat.bet - this.callAmount) * 2
        : seat.bet * 2;
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
