const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data', 'app.db'));

function calculateScores() {
    console.log('Calculating league scores...');

    const result = db.exec(`
     UPDATE playersscore
        SET leaguescore = (
            SELECT
                CASE
                    WHEN playersscore.hometeamscore IS NULL
                         OR playersscore.awayteamscore IS NULL
                    THEN 0

                    -- Game hasn't been played yet (no final score synced in),
                    -- so there's nothing to judge the prediction against.
                    -- Leave leaguescore NULL rather than defaulting to a loss —
                    -- this also means the WHERE clause at the bottom will pick
                    -- this row up again next run, once the result is in.
                    WHEN games.scorefulltimehome IS NULL
                         OR games.scorefulltimeaway IS NULL
                    THEN NULL

                    WHEN playersscore.wildcardused = 'yes' THEN
                        CASE
                            WHEN (
                                (playersscore.hometeamscore > playersscore.awayteamscore AND games.scorefulltimehome > games.scorefulltimeaway)
                                OR (playersscore.hometeamscore < playersscore.awayteamscore AND games.scorefulltimehome < games.scorefulltimeaway)
                                OR (playersscore.hometeamscore = playersscore.awayteamscore AND games.scorefulltimehome = games.scorefulltimeaway)
                            )
                            THEN leagues.wildcardwinscore
                            ELSE leagues.wildcardlosescore
                        END

                    ELSE
                        CASE
                            WHEN playersscore.hometeamscore = games.scorefulltimehome
                                 AND playersscore.awayteamscore = games.scorefulltimeaway
                            THEN leagues.perfectscore

                            WHEN (
                                (playersscore.hometeamscore > playersscore.awayteamscore AND games.scorefulltimehome > games.scorefulltimeaway)
                                OR (playersscore.hometeamscore < playersscore.awayteamscore AND games.scorefulltimehome < games.scorefulltimeaway)
                                OR (playersscore.hometeamscore = playersscore.awayteamscore AND games.scorefulltimehome = games.scorefulltimeaway)
                            )
                            THEN leagues.winscore

                            ELSE leagues.losescore
                        END
                END
            FROM games, leagues
            WHERE games.id = playersscore.gameid
              AND leagues.id = playersscore.leagueid
        )
        WHERE leaguescore IS NULL
    `);

    console.log('League score calculation complete.');
    return result;
}

// Only auto-run when this file is executed directly (e.g. `node calcscores.js`).
// When it's require()'d from server.js instead, this block is skipped —
// server.js calls calculateScores() itself, on its own schedule.
if (require.main === module) {
    try {
        calculateScores();
    } catch (err) {
        console.error('Manual score calculation failed:', err);
    }
}

module.exports = { calculateScores };