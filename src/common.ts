export type ID = '' | string & {__isID: true};

// The prefix to all bot commands
export const prefix = process.env.PREFIX || '!';

/**
 * toID - Turns anything into an ID (string with only lowercase alphanumeric characters)
 */
export function toID(text: any): ID {
	if (text && text.id) return text.id
	if (typeof text !== 'string' && typeof text !== 'number') return '';
	return ('' + text).toLowerCase().replace(/[^a-z0-9]+/g, '') as ID;
}
