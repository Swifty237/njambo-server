const User = require('../models/User');

const handleFreeChips = async (req, res) => {
    try {
        const { userId, chipsAmountToAdd } = req.body;

        // Validation des paramètres
        if (!userId || !chipsAmountToAdd) {
            return res.status(400).json({
                success: false,
                message: 'userId et chipsAmountToAdd sont requis'
            });
        }

        if (typeof chipsAmountToAdd !== 'number' || chipsAmountToAdd <= 0) {
            return res.status(400).json({
                success: false,
                message: 'chipsAmountToAdd doit être un nombre positif'
            });
        }

        // Trouver l'utilisateur dans la base de données
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Utilisateur non trouvé'
            });
        }

        // Ajouter les jetons au montant existant
        user.chipsAmount += chipsAmountToAdd;
        await user.save();

        console.log(`Jetons ajoutés avec succès: ${chipsAmountToAdd} pour l'utilisateur ${userId}. Nouveau total: ${user.chipsAmount}`);

        res.status(200).json({
            success: true,
            message: 'Jetons ajoutés avec succès',
            data: {
                userId: user._id,
                previousAmount: user.chipsAmount - chipsAmountToAdd,
                chipsAdded: chipsAmountToAdd,
                newAmount: user.chipsAmount
            }
        });

    } catch (error) {
        console.error('Erreur lors de l\'ajout de jetons gratuits:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: error.message
        });
    }
};

module.exports = {
    handleFreeChips
};
