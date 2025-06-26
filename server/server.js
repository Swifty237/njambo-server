const path = require('path');
const express = require('express');
const config = require('./config');
const connectDB = require('./config/db');
const configureMiddleware = require('./middleware');
const configureRoutes = require('./routes');
const socketio = require('socket.io');
const { init: gameSocketInit, restoreTablesFromDB } = require('./socket/index');

// Connect and get reference to mongodb instance
let db;

(async function () {
  db = await connectDB();

  // Restaurer les tables depuis MongoDB
  await restoreTablesFromDB();
  console.log('Server initialization complete');
})().catch(err => {
  console.error('Failed to initialize server:', err);
  process.exit(1);
});

// Init express app
const app = express();

// Config Express-Middleware
configureMiddleware(app);

// Set-up Routes
configureRoutes(app);

// Serve static assets and handle React routing
app.use(express.static(path.join(__dirname, 'public')));

// Handle React routing, return all requests to React app
app.get('*', (req, res, next) => {
  // Allow API routes to pass through
  if (req.url.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server and listen for connections
const server = app.listen(config.PORT, () => {
  console.log(
    `Server is running in ${config.NODE_ENV} mode and is listening on port ${config.PORT}...`,
  );
});

//  Handle real-time poker game logic with socket.io
const io = socketio(server);

io.on('connection', (socket) => gameSocketInit(socket, io));

// Error handling - close server
process.on('unhandledRejection', (err) => {
  db.disconnect();

  console.error(`Error: ${err.message}`);
  server.close(() => {
    process.exit(1);
  });
});
