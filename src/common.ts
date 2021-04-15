import PG = require('pg');

export type ID = '' | string & {__isID: true};

// The prefix to all bot commands
export const prefix = process.env.PREFIX || '$';

export const pgPool = new PG.Pool();

/**
 * toID - Turns anything into an ID (string with only lowercase alphanumeric characters)
 */
export function toID(text: any): ID {
	// This is a premature optimization of sorts, but optional chaining in ID conversion is perhaps too slow.
	if (text && text.id) return text.id; // eslint-disable-line @typescript-eslint/prefer-optional-chain
	if (typeof text !== 'string' && typeof text !== 'number') return '';
	return ('' + text).toLowerCase().replace(/[^a-z0-9]+/g, '') as ID;
}
