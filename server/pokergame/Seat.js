const { FOLD, CHECK, RAISE, WINNER, CALL, PLAY_ONE_CARD } = require('./actions');

class Seat {
  constructor(id, player, buyin, stack) {
    this.id = id;
    this.player = player;
    this.buyin = buyin;
    this.stack = stack;
    this.hand = [];
    this.playedHand = [];
    this.bet = 0;
    this.turn = false;
    this.checked = true;
    this.folded = false;
    this.lastAction = null;
    this.sittingOut = false;
  }

  playOneCard(card) {
    // Vérifier si la carte existe dans la main
    const cardIndex = this.hand.findIndex(c => c.suit === card.suit && c.rank === card.rank);

    if (cardIndex !== -1) {
      // Créer une nouvelle copie de la main sans la carte
      const newHand = [...this.hand];
      newHand.splice(cardIndex, 1);
      this.hand = newHand;

      // Ajouter la carte à playedHand si elle n'y est pas déjà
      const cardExists = this.playedHand.some(c => c.suit === card.suit && c.rank === card.rank);
      if (!cardExists) {
        this.playedHand = [...this.playedHand, card];
      }
    }

    this.lastAction = PLAY_ONE_CARD;
  }

  fold() {
    this.bet = 0;
    this.folded = true;
    this.lastAction = FOLD;
    this.turn = false;
  }

  check() {
    this.checked = true;
    this.lastAction = CHECK;
    this.turn = false;
  }

  raise(amount) {
    const reRaiseAmount = amount - this.bet;
    if (reRaiseAmount > this.stack) return;

    this.bet = amount;
    this.stack -= reRaiseAmount;
    this.turn = false;
    this.lastAction = RAISE;
  }
  placeBet(amount) {
    this.bet = amount;
    this.stack -= amount;
  }

  callRaise(amount) {
    let amountCalled = amount - this.bet;
    if (amountCalled >= this.stack) amountCalled = this.stack;

    this.bet += amountCalled;
    this.stack -= amountCalled;
    this.turn = false;
    this.lastAction = CALL;
  }

  winHand(amount) {
    this.bet = amount;
    this.stack += amount;
    this.turn = false;
    this.lastAction = WINNER;
  }
}

module.exports = Seat;
