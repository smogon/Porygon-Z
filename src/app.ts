/**
 *              Porygon-Z
 * The Bot for the Official Smogon Discord
 *      https://discord.gg/smogon
 *
 * Main File - app.ts
 * This is file you start the bot with.
 */
import {updateDatabase} from './database_version_control';
import {onError, client} from './client';

// Ensure database properly setup
void updateDatabase();

// Load other client events
require('./events');

process.on('uncaughtException', err => void onError(err));
process.on('unhandledRejection', err => void onError(err));

// Login
void (async () => client.login(process.env.TOKEN).catch(e => console.error(e)))();
