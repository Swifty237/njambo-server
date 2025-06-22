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
    this.wantsSitout = false;  // Pour indiquer que le joueur veut passer en sitout à la fin de la main
    this.wantsSitin = false;   // Pour indiquer que le joueur veut revenir au jeu à la prochaine main
    this.showingCards = false; // Pour indiquer si le joueur montre ses cartes
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

  check() {
    this.checked = true;
    this.lastAction = CHECK;
    this.turn = false;
  }

  placeBet(amount) {
    this.bet = amount;
    this.stack -= amount;
  }

  winHand(amount) {
    this.bet = amount;
    this.stack += amount;
    this.turn = false;
    this.lastAction = WINNER;
  }
}

module.exports = Seat;
