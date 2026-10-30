const Database = require('better-sqlite3');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../.env') });

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const API_URL = 'https://api.football-data.org/v4/competitions/PL/matches';
const DB_PATH = path.join(__dirname, 'data', 'app.db');

if (!API_KEY) {
    console.error('Error: FOOTBALL_DATA_API_KEY is not defined in .env');
    process.exit(1);
}

// Connect to SQLite database.
// IMPORTANT: this connection is opened ONCE at module load time and reused
// for every fetchAndSync() call (cron-scheduled or manual), because require()
// caches this module. It must stay open for the life of the process — do NOT
// call db.close() inside fetchAndSync(), or every run after the first will
// fail silently (db.prepare() throws "database connection is not open").
const db = new Database(DB_PATH);

// Enable Foreign Key support
db.pragma('foreign_keys = ON');

async function fetchAndSync() {
    console.log('Fetching data from Football-Data.org...');

    // Guard against a hung network request blocking the scheduler forever.
    // Without this, a stalled fetch() never resolves or rejects, so the
    // scheduled sync silently never completes and calculateScores() never runs.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout

    try {
        const response = await fetch(API_URL, {
            headers: { 'X-Auth-Token': API_KEY },
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status} - ${response.statusText}`);
        }

        const data = await response.json();
        const matches = data.matches;

        console.log(`Fetched ${matches.length} matches. Syncing with app.db...`);

        // Prepare SQL Statements with UPSERT logic (No underscores in column names)

        const insertArea = db.prepare(`
            INSERT INTO areas (id, name, code, flag)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                code = excluded.code,
                flag = excluded.flag
        `);

        const insertCompetition = db.prepare(`
            INSERT INTO competitions (id, name, code, type, emblem)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                code = excluded.code,
                type = excluded.type,
                emblem = excluded.emblem
        `);

        const insertSeason = db.prepare(`
            INSERT INTO seasons (id, startdate, enddate, currentmatchday, winner)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                startdate = excluded.startdate,
                enddate = excluded.enddate,
                currentmatchday = excluded.currentmatchday,
                winner = excluded.winner
        `);

        const insertTeam = db.prepare(`
            INSERT INTO teams (id, name, shortname, tla, crest)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                shortname = excluded.shortname,
                tla = excluded.tla,
                crest = excluded.crest
        `);

        // Match Upsert: Only updates if excluded.lastupdated > games.lastupdated
        const insertMatch = db.prepare(`
            INSERT INTO games (
                id, areaid, competitionid, seasonid, utcdate, status, matchday, 
                stage, matchgroup, lastupdated, hometeamid, awayteamid, 
                scorewinner, scoreduration, scorefulltimehome, scorefulltimeaway, 
                scorehalftimehome, scorehalftimeaway
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                utcdate = excluded.utcdate,
                hometeamid = excluded.hometeamid,
                awayteamid = excluded.awayteamid,
                status = excluded.status,
                matchday = excluded.matchday,
                stage = excluded.stage,
                matchgroup = excluded.matchgroup,
                lastupdated = excluded.lastupdated,
                scorewinner = excluded.scorewinner,
                scoreduration = excluded.scoreduration,
                scorefulltimehome = excluded.scorefulltimehome,
                scorefulltimeaway = excluded.scorefulltimeaway,
                scorehalftimehome = excluded.scorehalftimehome,
                scorehalftimeaway = excluded.scorehalftimeaway
            WHERE excluded.lastupdated > games.lastupdated OR games.lastupdated IS NULL
        `);

        // Wrap operations in a single transaction for performance
        const syncTransaction = db.transaction((matchesList) => {
            let insertedOrUpdated = 0;

            for (const match of matchesList) {
                // 1. Insert/Update Area
                if (match.area) {
                    insertArea.run(match.area.id, match.area.name, match.area.code, match.area.flag);
                }

                // 2. Insert/Update Competition
                if (match.competition) {
                    insertCompetition.run(
                        match.competition.id,
                        match.competition.name,
                        match.competition.code,
                        match.competition.type,
                        match.competition.emblem
                    );
                }

                // 3. Insert/Update Season
                if (match.season) {
                    insertSeason.run(
                        match.season.id,
                        match.season.startDate,
                        match.season.endDate,
                        match.season.currentMatchday,
                        match.season.winner ? JSON.stringify(match.season.winner) : null
                    );
                }

                // 4. Insert/Update Home & Away Teams
                if (match.homeTeam) {
                    insertTeam.run(match.homeTeam.id, match.homeTeam.name, match.homeTeam.shortName, match.homeTeam.tla, match.homeTeam.crest);
                }
                if (match.awayTeam) {
                    insertTeam.run(match.awayTeam.id, match.awayTeam.name, match.awayTeam.shortName, match.awayTeam.tla, match.awayTeam.crest);
                }

                // 5. Insert/Update Match
                const result = insertMatch.run(
                    match.id,
                    match.area?.id || null,
                    match.competition?.id || null,
                    match.season?.id || null,
                    match.utcDate,
                    match.status,
                    match.matchday,
                    match.stage,
                    match.group,
                    match.lastUpdated,
                    match.homeTeam.id,
                    match.awayTeam.id,
                    match.score?.winner || null,
                    match.score?.duration || null,
                    match.score?.fullTime?.home ?? null,
                    match.score?.fullTime?.away ?? null,
                    match.score?.halfTime?.home ?? null,
                    match.score?.halfTime?.away ?? null
                );

                if (result.changes > 0) {
                    insertedOrUpdated++;
                }
            }

            return insertedOrUpdated;
        });

        const updatedCount = syncTransaction(matches);
        console.log(`Sync complete! Records inserted/updated: ${updatedCount}`);

    } catch (error) {
        console.error('Error syncing match data:', error);
        // Re-throw so the caller (cron scheduler in server.js) knows this run
        // failed, rather than swallowing it and looking like success.
        throw error;
    } finally {
        clearTimeout(timeout);
        // NOTE: db.close() intentionally removed here.
        // `db` is a shared, module-level connection reused on every scheduled
        // run — closing it after the first run breaks every run after that.
        // The connection is closed once, on process shutdown, below instead.
    }
}

// Close the shared connection cleanly when the process actually exits
// (e.g. PM2 stop/restart, server shutdown) — not after every sync.
process.on('exit', () => {
    try {
        db.close();
    } catch (err) {
        // ignore — already closed or never opened
    }
});

// Only auto-run when this file is executed directly (e.g. `node import-football.js`).
// When it's require()'d from server.js instead, this block is skipped — server.js
// calls fetchAndSync() itself, on its own schedule.
if (require.main === module) {
    fetchAndSync()
        .then(() => console.log('Manual sync finished.'))
        .catch((err) => console.error('Manual sync failed:', err));
}

module.exports = { fetchAndSync };