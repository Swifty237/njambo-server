// Valeurs des rangs pour calculer les combinaisons
const RANK_VALUES = {
    '3': 3,
    '4': 4,
    '5': 5,
    '6': 6,
    '7': 7,
    '8': 8,
    '9': 9,
    '10': 10
};

// Vérifie si le joueur a un carré (4 cartes de même rang)
function hasFourOfAKind(hand) {
    const ranks = hand.map(card => card.rank);
    const rankCounts = {};

    ranks.forEach(rank => {
        rankCounts[rank] = (rankCounts[rank] || 0) + 1;
    });

    for (const rank in rankCounts) {
        if (rankCounts[rank] === 4) {
            return {
                type: 'FOUR_OF_A_KIND',
                rank: rank,
                value: 3 // Valeur la plus haute pour les combinaisons
            };
        }
    }
    return null;
}

// Vérifie si le joueur a trois 7
function hasThreeSevens(hand) {
    const sevens = hand.filter(card => card.rank === '7');
    if (sevens.length === 3) {
        return {
            type: 'THREE_SEVENS',
            value: 2 // Deuxième plus haute valeur
        };
    }
    return null;
}

// Vérifie si le joueur a un tia (somme des rangs < 21)
function hasTia(hand) {
    const sum = hand.reduce((total, card) => {
        return total + RANK_VALUES[card.rank];
    }, 0);

    if (sum < 21) {
        return {
            type: 'TIA',
            sum: sum,
            value: 1 // Valeur la plus basse
        };
    }
    return null;
}

// Trouve la meilleure combinaison dans une main
function findBestCombination(hand) {
    if (!hand || hand.length === 0) return null;

    // Vérifier dans l'ordre de priorité
    return hasFourOfAKind(hand) ||
        hasThreeSevens(hand) ||
        hasTia(hand) ||
        null;
}

// Compare deux combinaisons pour déterminer la meilleure
function compareCombinations(combo1, combo2) {
    if (!combo1 && !combo2) return 0;
    if (!combo1) return -1;
    if (!combo2) return 1;

    // D'abord comparer par valeur de combinaison
    if (combo1.value !== combo2.value) {
        return combo1.value - combo2.value;
    }

    // Si même type de combinaison, comparer les détails
    if (combo1.type === 'FOUR_OF_A_KIND') {
        return RANK_VALUES[combo1.rank] - RANK_VALUES[combo2.rank];
    }

    if (combo1.type === 'TIA') {
        return combo2.sum - combo1.sum; // Plus petite somme gagne
    }

    return 0;
}

module.exports = {
    findBestCombination,
    compareCombinations
};
