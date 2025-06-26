const mongoose = require('mongoose');

// Sous-schéma pour les cartes
const CardSchema = new mongoose.Schema({
    suit: String,
    rank: String
}, { _id: false });

// Sous-schéma pour les messages du chat
const ChatMessageSchema = new mongoose.Schema({
    message: String,
    sender: {
        id: String,
        name: String
    },
    timestamp: Date
}, { _id: false });

// Sous-schéma pour la ChatRoom
const ChatRoomSchema = new mongoose.Schema({
    chatMessages: [ChatMessageSchema]
}, { _id: false });

// Sous-schéma pour les joueurs
const PlayerSchema = new mongoose.Schema({
    socketId: String,
    id: String,
    name: String,
    bankroll: Number
}, { _id: false });

// Sous-schéma pour les sièges
const SeatSchema = new mongoose.Schema({
    id: Number,
    player: PlayerSchema,
    buyin: Number,
    stack: Number,
    hand: [CardSchema],
    playedHand: [CardSchema],
    bet: { type: Number, default: 0 },
    turn: { type: Boolean, default: false },
    checked: { type: Boolean, default: true },
    folded: { type: Boolean, default: false },
    lastAction: String,
    sittingOut: { type: Boolean, default: false },
    wantsSitout: { type: Boolean, default: false },
    wantsSitin: { type: Boolean, default: false },
    showingCards: { type: Boolean, default: false }
}, { _id: false });

// Sous-schéma pour l'historique
const HistoryEntrySchema = new mongoose.Schema({
    pot: Number,
    seats: mongoose.Schema.Types.Mixed,
    button: Number,
    turn: Number,
    winMessages: [String]
}, { _id: false });

// Schéma principal de la table
const TableSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    bet: { type: Number, required: true },
    isPrivate: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    maxPlayers: { type: Number, default: 4 },
    players: [PlayerSchema],
    seats: {
        type: Map,
        of: SeatSchema
    },
    button: Number,
    turn: Number,
    lastWinningSeat: Number,
    lastRoundWinner: Number,
    pot: { type: Number, default: 0 },
    callAmount: Number,
    handOver: { type: Boolean, default: true },
    handCompleted: { type: Boolean, default: false },
    winMessages: [String],
    gameNotifications: [String],
    history: [HistoryEntrySchema],
    demandedSuit: String,
    currentRoundCards: [{
        seatId: Number,
        card: CardSchema
    }],
    roundNumber: { type: Number, default: 1 },
    countHand: { type: Number, default: 0 },
    handParticipants: [Number],
    wonByCombination: { type: Boolean, default: false },
    chatRoom: ChatRoomSchema
}, {
    timestamps: true
});

// Méthode pour convertir l'instance mongoose en objet Table
TableSchema.methods.toTableInstance = function () {
    const tableData = this.toObject();
    // Convertir la Map des sièges en objet standard
    if (tableData.seats instanceof Map) {
        tableData.seats = Object.fromEntries(tableData.seats);
    }
    return tableData;
};

module.exports = mongoose.model('Table', TableSchema);
