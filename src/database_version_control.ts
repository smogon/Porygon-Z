import Postgrator = require('postgrator');

const postgrator = new Postgrator({
	migrationDirectory: __dirname + '/../src/migrations',
	driver: 'pg',
	host: process.env.PGHOST,
	port: process.env.PGPORT,
	database: process.env.PGDATABASE,
	username: process.env.PGUSER,
	password: process.env.PGPASS,
});

postgrator.on('migration-started', m => {
	const action = m.action === 'do' ? 'migration to' : 'rollback from';
	console.log(`Database ${action} version ${m.version} started.`);
});

postgrator.on('migration-finished', m => {
	const action = m.action === 'do' ? 'migration to' : 'rollback from';
	console.log(`Database ${action} version ${m.version} finished.`);
});

// Migrate to latest version of database
// this can be changed to a version if an explicit rollback is needed
postgrator.migrate('max');
