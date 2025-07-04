const jwt = require('jsonwebtoken');
const config = require('../config');

const validateToken = (req, res, next) => {
  const token = req.header('x-auth-token');

  if (!token) {
    return res.status(401).json({ msg: 'Unauthorized request!' });
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);

    // Vérifier que l'objet user existe dans le token décodé
    if (!decoded.user || !decoded.user.id) {
      console.error('Token décodé mais user ou user.id manquant:', decoded);
      return res.status(401).json({ msg: 'Invalid token structure!' });
    }

    req.user = decoded.user;
    next();
  } catch (err) {
    console.error('Token verification failed:', err.message);
    res.status(401).json({ msg: 'Unauthorized request!' });
  }
};

module.exports = validateToken;