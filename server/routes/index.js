const path = require('path');

const configureRoutes = (app) => {
  app.use('/api/auth', require(path.join(__dirname, '/api/auth')));
  app.use('/api/users', require(path.join(__dirname, '/api/users')));
  app.use('/api/mails', require(path.join(__dirname, '/api/mails')));
  app.use('/api/chips', require(path.join(__dirname, '/api/chips')));

  // Default route
  app.use('/', (req, res) => {
    res.status(200).send('Welcome to Njambo!');
  });
};

module.exports = configureRoutes;
