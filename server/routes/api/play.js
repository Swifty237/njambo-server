const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const Table = require('../../pokergame/Table');
const Player = require('../../pokergame/Player');
const config = require('../../config');
const router = express.Router();

// Variables globales partagées avec socket
let tables = {};
let players = {};

// Fonction utilitaire pour obtenir les tables actuelles
function getCurrentTables() {
    return Object.values(tables).map((table) => ({
        id: table.id,
        name: table.name,
        seats: table.seats,
        players: table.players,
        bet: table.bet,
        callAmount: table.callAmount,
        pot: table.pot,
        winMessages: table.winMessages,
        button: table.button,
        handOver: table.handOver,
        isPrivate: table.isPrivate,
        createdAt: table.createdAt,
        demandedSuit: table.demandedSuit,
        currentRoundCards: table.currentRoundCards,
        roundNumber: table.roundNumber,
        chatRoom: table.chatRoom,
        link: table.link,
    }));
}

// Fonction utilitaire pour obtenir les joueurs actuels
function getCurrentPlayers() {
    return Object.values(players)
        .filter(player => player && player.socketId && player.id && player.name)
        .map((player) => ({
            socketId: player.socketId,
            id: player.id,
            name: player.name,
        }));
}

// Route GET /api/play - Rejoindre une table via des paramètres
router.get('/', async (req, res) => {
    try {
        const { tableId, name, bet, isPrivate, link } = req.query;
        const betAmount = parseFloat(bet);

        // Vérifier que tous les paramètres requis sont présents et valides
        if (!tableId || !name || isNaN(betAmount) || isPrivate === undefined || !link) {
            return res.status(400).json({
                success: false,
                message: 'Paramètres manquants: tableId, name, bet, isPrivate et link sont requis'
            });
        }

        // Extraire le token JWT des headers
        const token = req.header('Authorization')?.replace('Bearer ', '') || req.header('x-auth-token');

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Token d\'authentification manquant'
            });
        }

        // Vérifier le token JWT
        let user;
        try {
            const decoded = jwt.verify(token, config.JWT_SECRET);
            user = decoded.user;

            if (!user || !user.id) {
                return res.status(401).json({
                    success: false,
                    message: 'Token d\'authentification invalide - données utilisateur manquantes'
                });
            }
        } catch (err) {
            console.error('Erreur de vérification JWT:', err);
            return res.status(401).json({
                success: false,
                message: 'Token d\'authentification invalide'
            });
        }

        // Retourner directement les informations reçues
        res.status(200).json({
            id: tableId,
            name,
            bet: betAmount,
            isPrivate: isPrivate === 'true',
            link,
            userInfo: {
                id: user.id,
                name: user.name
            }
        });

    } catch (error) {
        console.error('Erreur lors de la connexion à la table:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route POST /api/play - Créer ou rejoindre une table
router.post('/', async (req, res) => {
    try {
        const { tableId, name, bet, isPrivate, link } = req.body;

        // Vérifier que tous les paramètres requis sont présents
        if (!tableId || !name || bet === undefined || isPrivate === undefined || !link) {
            return res.status(400).json({
                success: false,
                message: 'Paramètres manquants: tableId, name, bet, isPrivate et link sont requis'
            });
        }

        // Extraire le token JWT des headers
        const token = req.header('Authorization')?.replace('Bearer ', '') || req.header('x-auth-token');

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Token d\'authentification manquant'
            });
        }

        // Vérifier le token JWT
        let user;
        try {
            const decoded = jwt.verify(token, config.JWT_SECRET);
            user = decoded.user;

            // Vérifier que l'objet user et son id existent
            if (!user || !user.id) {
                return res.status(401).json({
                    success: false,
                    message: 'Token d\'authentification invalide - données utilisateur manquantes'
                });
            }
        } catch (err) {
            console.error('Erreur de vérification JWT:', err);
            return res.status(401).json({
                success: false,
                message: 'Token d\'authentification invalide'
            });
        }

        // Retourner directement les informations reçues
        res.status(200).json({
            id: tableId,
            name,
            bet,
            isPrivate,
            link,
            userInfo: {
                id: user.id,
                name: user.name
            }
        });

    } catch (error) {
        console.error('Erreur lors de la création/jointure de table:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Route POST /api/play/leave - Déconnecter un joueur de la table
router.post('/leave', async (req, res) => {
    try {
        const { tableId, seatId } = req.body;

        // Vérifier que les paramètres requis sont fournis
        if (!tableId || !seatId) {
            return res.status(400).json({
                success: false,
                message: 'tableId et seatId sont requis'
            });
        }

        // Extraire le token JWT des headers
        const token = req.header('Authorization')?.replace('Bearer ', '') || req.header('x-auth-token');

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Token d\'authentification manquant'
            });
        }

        // Vérifier le token JWT
        let user;
        try {
            const decoded = jwt.verify(token, config.JWT_SECRET);
            user = decoded.user;

            if (!user || !user.id) {
                return res.status(401).json({
                    success: false,
                    message: 'Token d\'authentification invalide - données utilisateur manquantes'
                });
            }
        } catch (err) {
            console.error('Erreur de vérification JWT:', err);
            return res.status(401).json({
                success: false,
                message: 'Token d\'authentification invalide'
            });
        }

        // Vérifier si la table existe
        const table = tables[tableId];
        if (!table) {
            return res.status(404).json({
                success: false,
                message: 'Table non trouvée'
            });
        }

        // Récupérer les informations utilisateur
        const userInfo = await User.findById(user.id).select('-password');
        if (!userInfo) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        // Trouver le siège du joueur
        const seat = table.seats[seatId];
        if (!seat || !seat.player || seat.player.id !== userInfo._id) {
            return res.status(404).json({
                success: false,
                message: 'Siège non trouvé ou vous n\'êtes pas assis à ce siège'
            });
        }

        // Rembourser les jetons du joueur s'il en a
        if (seat.stack > 0) {
            try {
                const user = await User.findById(userInfo._id);
                if (user) {
                    user.chipsAmount += seat.stack;
                    await user.save();
                    console.log(`Remboursement de ${seat.stack} jetons à ${userInfo.name}`);
                }
            } catch (error) {
                console.error('Erreur lors du remboursement:', error);
            }
        }

        // Retirer le joueur de la table
        const playerSocketId = seat.player.socketId;
        table.standPlayer(playerSocketId);

        // Supprimer le joueur de la liste des joueurs connectés
        if (playerSocketId && players[playerSocketId]) {
            delete players[playerSocketId];
        }

        // Supprimer la table si elle est vide
        if (table.players.length === 0) {
            delete tables[tableId];
            console.log(`Table ${tableId} supprimée car vide`);
        }

        console.log(`Joueur ${userInfo.name} déconnecté de la table ${tableId}, siège ${seatId}`);

        res.status(200).json({
            success: true,
            message: 'Déconnexion réussie'
        });

    } catch (error) {
        console.error('Erreur lors de la déconnexion:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur'
        });
    }
});

// Fonction pour obtenir les tables (pour usage externe)
function getTablesReference() {
    return tables;
}

// Fonction pour obtenir les joueurs (pour usage externe)
function getPlayersReference() {
    return players;
}

// Fonction pour définir les références (pour la synchronisation avec socket)
function setReferences(tablesRef, playersRef) {
    tables = tablesRef;
    players = playersRef;
}

module.exports = router;
module.exports.getTablesReference = getTablesReference;
module.exports.getPlayersReference = getPlayersReference;
module.exports.setReferences = setReferences;
module.exports.getCurrentTables = getCurrentTables;
module.exports.getCurrentPlayers = getCurrentPlayers;
