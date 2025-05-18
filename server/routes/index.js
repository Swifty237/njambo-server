const path = require('path');

const configureRoutes = (app) => {
  app.use('/api/auth', require(path.join(__dirname, 'routes/api/auth')));
  app.use('/api/users', require(path.join(__dirname, 'routes/api/users')));
  app.use('/api/mails', require(path.join(__dirname, 'routes/api/mails')));
  app.use('/api/chips', require(path.join(__dirname, 'routes/api/chips')));

  // Default route
  app.use('/', (req, res) => {
    res.status(200).send('Welcome to Njambo!');
  });
};

module.exports = configureRoutes;
