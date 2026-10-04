const { createDb } = require('../src/db');
const { createApp } = require('../src/server');

createApp(createDb(':memory:')).listen(3088, '127.0.0.1');
