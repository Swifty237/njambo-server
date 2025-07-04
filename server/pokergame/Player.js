class Player {
  constructor(socketId, playerId, playerName, chipsAmount) {
    this.socketId = socketId;
    this.id = playerId;
    this.playerId = playerId;  // Ajout pour compatibilité client
    this.name = playerName;
    this.playerName = playerName;  // Ajout pour compatibilité client
    this.bankroll = chipsAmount;
  }
}

module.exports = Player;
