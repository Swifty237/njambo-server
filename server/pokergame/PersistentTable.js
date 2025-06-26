const Table = require('./Table');
const TableModel = require('../models/Table');
const debounce = require('lodash/debounce');

class PersistentTable extends Table {
    constructor(id, name, bet, isPrivate, createdAt) {
        super(id, name, bet, isPrivate, createdAt);
        this.setupPersistence();
    }

    // Configuration du système de persistance
    setupPersistence() {
        // Debounce la sauvegarde pour éviter trop d'appels à MongoDB
        this.debouncedSave = debounce(this.save.bind(this), 100);

        // Créer un proxy pour intercepter les modifications d'attributs
        return new Proxy(this, {
            set: (target, property, value) => {
                const result = Reflect.set(target, property, value);
                // Déclencher la sauvegarde si la propriété n'est pas privée
                if (!property.startsWith('_') && property !== 'debouncedSave') {
                    this.debouncedSave();
                }
                return result;
            }
        });
    }

    // Méthode de sauvegarde dans MongoDB
    async save() {
        try {
            const tableData = this.toMongoDocument();
            await TableModel.findOneAndUpdate(
                { id: this.id },
                tableData,
                { upsert: true, new: true }
            );
            console.log(`Table ${this.id} saved to MongoDB`);
        } catch (error) {
            console.error(`Error saving table ${this.id}:`, error);
        }
    }

    // Convertir l'instance Table en document MongoDB
    toMongoDocument() {
        const tableData = {
            id: this.id,
            name: this.name,
            bet: this.bet,
            isPrivate: this.isPrivate,
            createdAt: this.createdAt,
            maxPlayers: this.maxPlayers,
            players: this.players,
            seats: this.seats,
            button: this.button,
            turn: this.turn,
            lastWinningSeat: this.lastWinningSeat,
            lastRoundWinner: this.lastRoundWinner,
            pot: this.pot,
            callAmount: this.callAmount,
            handOver: this.handOver,
            handCompleted: this.handCompleted,
            winMessages: this.winMessages,
            gameNotifications: this.gameNotifications,
            history: this.history,
            demandedSuit: this.demandedSuit,
            currentRoundCards: this.currentRoundCards,
            roundNumber: this.roundNumber,
            countHand: this.countHand,
            handParticipants: this.handParticipants,
            wonByCombination: this.wonByCombination,
            chatRoom: this.chatRoom
        };

        // Convertir les sièges en Map pour MongoDB
        if (this.seats) {
            tableData.seats = new Map(Object.entries(this.seats));
        }

        return tableData;
    }

    // Méthodes statiques pour la gestion des tables
    static async loadTable(id) {
        try {
            const tableDoc = await TableModel.findOne({ id });
            if (!tableDoc) return null;

            const tableData = tableDoc.toTableInstance();
            const table = new PersistentTable(
                tableData.id,
                tableData.name,
                tableData.bet,
                tableData.isPrivate,
                tableData.createdAt
            );

            // Restaurer l'état de la table
            Object.assign(table, tableData);
            return table;
        } catch (error) {
            console.error(`Error loading table ${id}:`, error);
            return null;
        }
    }

    static async loadAllTables() {
        try {
            const tableDocs = await TableModel.find({});
            return tableDocs.map(doc => {
                const tableData = doc.toTableInstance();
                const table = new PersistentTable(
                    tableData.id,
                    tableData.name,
                    tableData.bet,
                    tableData.isPrivate,
                    tableData.createdAt
                );
                Object.assign(table, tableData);
                return table;
            });
        } catch (error) {
            console.error('Error loading all tables:', error);
            return [];
        }
    }

    // Surcharge des méthodes critiques pour assurer la persistance
    async startHand() {
        super.startHand();
        await this.save();
    }

    async changeTurn(lastTurn) {
        super.changeTurn(lastTurn);
        await this.save();
    }

    async endHand() {
        super.endHand();
        await this.save();
    }

    async determinePotWinner() {
        super.determinePotWinner();
        await this.save();
    }

    async sitPlayer(player, seatId, amount) {
        super.sitPlayer(player, seatId, amount);
        await this.save();
    }

    async standPlayer(socketId) {
        super.standPlayer(socketId);
        await this.save();
    }
}

module.exports = PersistentTable;
