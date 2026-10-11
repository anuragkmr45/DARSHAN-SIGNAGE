const TEST_DATABASE_NAME = /(?:^|_)test(?:_[a-z0-9]+)*$/i;
export class TestDatabaseSafetyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TestDatabaseSafetyError';
    }
}
export function parseDatabaseName(connectionString) {
    let parsed;
    try {
        parsed = new URL(connectionString);
    }
    catch {
        throw new TestDatabaseSafetyError('DATABASE_URL must be a valid PostgreSQL connection URL.');
    }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
        throw new TestDatabaseSafetyError('DATABASE_URL must use the postgres or postgresql protocol.');
    }
    const databaseName = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
    if (!databaseName || databaseName.includes('/')) {
        throw new TestDatabaseSafetyError('DATABASE_URL must include exactly one database name.');
    }
    return databaseName;
}
export function assertDedicatedTestDatabase(connectionString, context = 'Test runtime') {
    const databaseName = parseDatabaseName(connectionString);
    if (!TEST_DATABASE_NAME.test(databaseName)) {
        throw new TestDatabaseSafetyError(`${context} refuses DATABASE_URL for "${databaseName}". Use a dedicated database whose name ends in _test (for example darshan_test).`);
    }
    return databaseName;
}
export function assertTestRuntimeDatabase(nodeEnv, connectionString) {
    if (nodeEnv === 'test') {
        assertDedicatedTestDatabase(connectionString);
    }
}
