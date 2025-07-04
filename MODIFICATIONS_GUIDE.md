# Guide des Modifications pour la Gestion par userId

## Résumé des Problèmes
1. **Timer désynchronisé** : Quand un joueur recharge sa page, le timer repart à zéro pour lui mais continue pour les autres
2. **Perte de données** : Quand un joueur recharge pendant son tour, les cartes et l'état du jeu sont perdus
3. **Identification par socketId** : Le serveur utilise `socketId` qui change à chaque reconnexion

## Solution : Identification par userId

### 1. Remplacer le fichier `server/socket/index.js`
```bash
cp server/socket/index_modified.js server/socket/index.js
```

**Changements principaux :**
- Utilisation de `userId` au lieu de `socketId` pour identifier les joueurs
- Mapping `socketToUser` pour associer socket et utilisateur
- Gestion de la reconnexion sans perte d'état
- Préservation des timers et de l'état du jeu

### 2. Remplacer le fichier `server/pokergame/Table.js`
```bash
cp server/pokergame/Table_modified.js server/pokergame/Table.js
```

**Nouvelles méthodes ajoutées :**
- `removePlayerByUserId(userId)` : Supprimer un joueur par userId
- `findSeatByUserId(userId)` : Trouver un siège par userId
- `restorePlayerState(userId, socketId)` : Restaurer l'état d'un joueur
- Gestion des joueurs déconnectés dans `changeTurn()`

### 3. Remplacer le fichier `server/pokergame/Player.js`
```bash
cp server/pokergame/Player_modified.js server/pokergame/Player.js
```

**Nouvelles propriétés :**
- `userId` : Identifiant unique de l'utilisateur
- `disconnected` : Flag de déconnexion
- `lastSeen` : Timestamp de dernière activité

**Nouvelles méthodes :**
- `markDisconnected()` : Marquer comme déconnecté
- `reconnect(newSocketId)` : Reconnecter avec nouveau socket
- `isActive()` : Vérifier si le joueur est actif

### 4. Remplacer le fichier `server/pokergame/Seat.js`
```bash
cp server/pokergame/Seat_modified.js server/pokergame/Seat.js
```

**Nouvelles propriétés :**
- `disconnectedAt` : Timestamp de déconnexion
- `reconnectedAt` : Timestamp de reconnexion

**Nouvelles méthodes :**
- `markPlayerDisconnected()` : Marquer la déconnexion
- `markPlayerReconnected(newSocketId)` : Marquer la reconnexion
- `isPlayerConnected()` : Vérifier la connexion
- `getDisconnectionTime()` : Obtenir le temps de déconnexion

## Fonctionnalités Ajoutées

### 1. Reconnexion Transparente
- Les joueurs gardent leur siège et leurs cartes lors du rechargement
- Le timer continue normalement pour tous les joueurs
- L'état du jeu est préservé

### 2. Gestion des Déconnexions
- Les joueurs déconnectés peuvent jouer automatiquement
- Sauvegarde de l'état des joueurs déconnectés
- Restauration complète lors de la reconnexion

### 3. Synchronisation des Timers
- Un seul timer par table, partagé par tous les joueurs
- Pas de désynchronisation lors des reconnexions
- Gestion automatique des tours pour les joueurs déconnectés

## Tests à Effectuer

### Test 1 : Reconnexion Normale
1. Joueur 1 rejoint une table
2. Joueur 2 rejoint la table
3. Une main commence
4. Joueur 1 recharge sa page pendant que ce n'est pas son tour
5. ✅ Vérifier que Joueur 1 retrouve ses cartes et son état
6. ✅ Vérifier que le timer continue normalement pour Joueur 2

### Test 2 : Reconnexion Pendant Son Tour
1. Joueur 1 rejoint une table
2. Joueur 2 rejoint la table
3. Une main commence
4. Joueur 2 recharge sa page pendant son tour
5. ✅ Vérifier que Joueur 2 retrouve ses cartes
6. ✅ Vérifier que le timer continue ou reprend correctement
7. ✅ Vérifier que le jeu continue normalement

### Test 3 : Déconnexion Prolongée
1. Joueur 1 rejoint une table
2. Joueur 2 rejoint la table
3. Une main commence
4. Joueur 1 ferme son navigateur
5. ✅ Vérifier que le jeu continue avec jeu automatique pour Joueur 1
6. Joueur 1 revient après quelques tours
7. ✅ Vérifier qu'il retrouve son état mis à jour

## Commandes pour Appliquer les Modifications

```bash
# Se placer dans le répertoire serveur
cd ../njambo-server

# Sauvegarder les fichiers originaux
cp server/socket/index.js server/socket/index_backup.js
cp server/pokergame/Table.js server/pokergame/Table_backup.js
cp server/pokergame/Player.js server/pokergame/Player_backup.js
cp server/pokergame/Seat.js server/pokergame/Seat_backup.js

# Appliquer les modifications
cp server/socket/index_modified.js server/socket/index.js
cp server/pokergame/Table_modified.js server/pokergame/Table.js
cp server/pokergame/Player_modified.js server/pokergame/Player.js
cp server/pokergame/Seat_modified.js server/pokergame/Seat.js

# Redémarrer le serveur
npm restart
```

## Logs de Debug

Les nouveaux logs ajoutés permettront de suivre :
- `🔌 [Socket] Nouvelle connexion avec auth:` - Connexions avec authentification
- `🔄 [Socket] Reconnexion détectée pour userId:` - Reconnexions détectées
- `🪑 [Socket] Siège trouvé pour la reconnexion:` - Restauration de siège
- `👤 [Socket] FETCH_LOBBY_INFO pour userId:` - Authentification lobby

Ces logs aideront à diagnostiquer les problèmes de reconnexion.
