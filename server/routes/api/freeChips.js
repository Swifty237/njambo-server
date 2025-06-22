const express = require('express');
const router = express.Router();
const { handleFreeChips } = require('../../controllers/freeChips');

// @route   POST api/free
// @desc    Add free chips to user
// @access  Public
router.post('/', handleFreeChips);

module.exports = router;
