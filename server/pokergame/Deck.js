const lodash = require('lodash');
class Deck {
  constructor() {
    this.suits = ['s', 'h', 'd', 'c'];
    this.ranks = [
      // 'A',
      // 'K',
      // 'Q',
      // 'J',
      '10',
      '9',
      '8',
      '7',
      '6',
      '5',
      '4',
      '3',
      // '2',
    ];
    console.log("Initializing deck...");
    this.cards = this.createDeckAndShuffle();
    console.log(`Deck created with ${this.cards.length} cards`);
  }

  createDeckAndShuffle() {
    let cards = [];
    console.log("Creating cards...");

    this.suits.forEach((suit) => {
      this.ranks.forEach((rank) => {
        cards.push({ suit, rank });
      });
    });

    console.log(`Created ${cards.length} cards before shuffle`);
    cards = lodash.shuffle(cards);
    console.log("Cards shuffled");

    return cards;
  }

  count() {
    return this.cards.length;
  }

  draw() {
    const count = this.count();
    if (count > 0)
      return this.cards.splice(Math.floor(Math.random() * count), 1)[0];
    else return null;
  }
}

module.exports = Deck;
