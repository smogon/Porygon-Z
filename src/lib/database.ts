/**
 * Database access code.
 *
 * Porygon-Z currently uses PostgreSQL as its database of choice.
 * However, it can run using either an external Postgres server, or an in-memory Postgres database provided by pg-mem.
 * The latter does not support 100% of Postgres' features;
 * code depending on SQL queries which are incompatible with pg-mem can't be unit tested,
 * but should theoretically run in production environments (with a real Postgres database).
 *
 * Porygon-Z does not currently plan to support other databases, but if it ever does, the code would go here.
 *
 * @author Annika
 */
import type {Pool} from 'pg';
import type {IMemoryDb} from 'pg-mem';

import {escape as escapeSQL} from 'sqlutils/pg';

interface Query {
	statement: string;
	args?: any[];
}

export interface Database {
	/** executes a query that doesn't return results */
	query(statement: string, args?: any[]): Promise<void>;

	/** executes a query that returns results */
	queryWithResults(statement: string, args?: any[]): Promise<any[]>;

	/**
	 * Executes several queries sequentially within a transaction.
	 *
	 * @returns true on success and false if an error occurs (in which case the transaction will be rolled back)
	 */
	withinTransaction(queries: Query[]): Promise<boolean>;

	destroy(): Promise<void>;
}

export class ExternalPostgresDatabase implements Database {
	private pool: Pool;

	constructor(pool: Pool) {
		this.pool = pool;
	}

	async query(statement: string, args?: any[]) {
		try {
			await this.pool.query(statement, args);
		} catch (e) {
			throw new Error(`Error while quering database: ${e.message}\n` +
				`Query: ${statement}\nArgs: ${args}\n`);
		}
	}

	async queryWithResults(statement: string, args?: any[]) {
		try {
			const result = await this.pool.query(statement, args);
			return result.rows;
		} catch (e) {
			throw new Error(`Error while quering database: ${e.message}\n` +
				`Query: ${statement}\nArgs: ${args}\n`);
		}
	}

	async withinTransaction(queries: Query[]) {
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			for (const query of queries) {
				await client.query(query.statement, query.args);
			}
			await client.query('COMMIT');

			return true;
		} catch (e) {
			await client.query('ROLLBACK');
			return false;
		} finally {
			client.release();
		}
	}

	async destroy() {
		return this.pool.end();
	}
}

export class MemoryPostgresDatabase implements Database {
	private db: IMemoryDb;

	constructor(db: IMemoryDb) {
		this.db = db;
	}


	query(statement: string, args?: any[]): Promise<void> {
		this.db.public.none(this.stringifyQuery(statement, args));
		return Promise.resolve();
	}

	queryWithResults(statement: string, args?: any[]): Promise<any[]> {
		return Promise.resolve(this.db.public.many(this.stringifyQuery(statement, args)));
	}

	async withinTransaction(queries: Query[]) {
		try {
			await this.query('BEGIN');
			for (const query of queries) {
				await this.query(query.statement, query.args);
			}
			await this.query('COMMIT');

			return true;
		} catch (e) {
			await this.query('ROLLBACK');
			return false;
		}
	}

	destroy() {
		return Promise.resolve();
	}

	/**
	 * Converts a Query (representing a parameterized statement) to a string.
	 * Ideally we wouldn't need to do this, but it shouldn't present too great of a security risk,
	 * since MemoryPostgresDatabase is only used for unit tests, not in production.
	 *
	 * This can be removed when https://github.com/oguimbal/pg-mem/issues/101 is fixed.
	 */
	stringifyQuery(statement: string, args?: any[]) {
		if (!args?.length) return statement;

		// this is a fairly hacky solution - if only pg-mem had built-in parameterization...
		// basically, we assume any instance of whitespace-"$"-digits is a parameter, and
		// replace it with the given argument (sanitized, of course!).
		return statement.replace(/(\s)\$(\d+)/g, (_, precedingWhitespace, indexString) => {
			const index = parseInt(indexString);
			if (isNaN(index) || index <= 0 || index > args.length) {
				throw new Error(`Invalid index for parameterized statement: ${indexString}`);
			}

			// SQL parameters start as $1, but array indices in JS start at arr[0], so we subtract 1
			return precedingWhitespace + escapeSQL(args[index - 1].toString());
		});
	}

	backup() {
		return this.db.backup();
	}
}
