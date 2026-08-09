const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data', 'app.db'));

db.exec(`
 UPDATE playersscore
    SET leaguescore = (
        SELECT
            CASE
                WHEN playersscore.hometeamscore IS NULL
                     OR playersscore.awayteamscore IS NULL
                THEN 0

                WHEN playersscore.wildcardused = 'yes' THEN
                    CASE
                        WHEN (
                            (playersscore.hometeamscore > playersscore.awayteamscore AND games.hometeamscore > games.awayteamscore)
                            OR (playersscore.hometeamscore < playersscore.awayteamscore AND games.hometeamscore < games.awayteamscore)
                            OR (playersscore.hometeamscore = playersscore.awayteamscore AND games.hometeamscore = games.awayteamscore)
                        )
                        THEN leagues.wildcardwinscore
                        ELSE leagues.wildcardlosescore
                    END

                ELSE
                    CASE
                        WHEN playersscore.hometeamscore = games.hometeamscore
                             AND playersscore.awayteamscore = games.awayteamscore
                        THEN leagues.perfectscore

                        WHEN (
                            (playersscore.hometeamscore > playersscore.awayteamscore AND games.hometeamscore > games.awayteamscore)
                            OR (playersscore.hometeamscore < playersscore.awayteamscore AND games.hometeamscore < games.awayteamscore)
                            OR (playersscore.hometeamscore = playersscore.awayteamscore AND games.hometeamscore = games.awayteamscore)
                        )
                        THEN leagues.winscore

                        ELSE leagues.losescore
                    END
            END
        FROM games, leagues
        WHERE games.id = playersscore.gameid
          AND leagues.id = playersscore.leagueid
    )
    where leaguescore is null
`);
