const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('./db/init');
const cron = require('node-cron');
const { fetchAndSync } = require('./db/import-football');
const { calculateScores } = require('./db/calcscores');


const app = express();
const PORT = 3000;

require('dotenv').config();

const ALLOW_LEAGUE_CREATION = process.env.ALLOW_LEAGUE_CREATION !== 'false';

app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// ─────────────────────────────────────────────
// GATEKEEPER for PAGES — redirects to /signin if not logged in.
// ─────────────────────────────────────────────
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/signin');
  }
  next();
}

// ─────────────────────────────────────────────
// GATEKEEPER for API ROUTES — sends a JSON error instead of redirecting.
// ─────────────────────────────────────────────
function requireLoginApi(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  next();
}

// ─────────────────────────────────────────────
// GATEKEEPER for "must belong to a league" — runs AFTER requireLogin.
// If the session already has a currentleague picked, nothing more to
// check. Otherwise, look up whether this user is a member of ANY
// league at all. If so, silently pick the first one as the default.
// If they belong to NO leagues whatsoever, they're forced onto the
// join-league page — nothing else in the app is reachable until then.
// ─────────────────────────────────────────────
function requireLeague(req, res, next) {
  if (req.session.currentleague) {
    return next();
  }

  const anyLeague = db.prepare(`
    SELECT leaguesid FROM leagueuser WHERE userid = ? ORDER BY leaguesid LIMIT 1
  `).get(req.session.userId);

  if (anyLeague) {
    req.session.currentleague = anyLeague.leaguesid;
    return next();
  }

  return res.redirect('/app/join-league.html');
}

// ─────────────────────────────────────────────
// Shared join-code generator — used by create-league. Keeps retrying
// until it lands on a code not already in use.
// ─────────────────────────────────────────────
function generateUniqueJoinCode() {
  const exists = db.prepare('SELECT 1 FROM leagues WHERE joinID = ?');
  let code;
  do {
    code = crypto.randomBytes(4).toString('hex').toUpperCase();
  } while (exists.get(code));
  return code;
}

app.get('/', (req, res) => {
  res.redirect('/signin');
});

// ---------------------------------------------------------------------------
// AUTH ROUTES
// ---------------------------------------------------------------------------

app.post('/api/signup', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const hashed = await bcrypt.hash(password, 10);

    const insert = db.prepare(
      'INSERT INTO users (username, name, email, passwordhashed, userroleid) VALUES (?, ?, ?, ?, 1)'
    );
    insert.run(username, username, email, hashed);

    // Not auto-logging in after signup — user goes back to /signin.
    res.json({ success: true });

  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      if (err.message.includes('username')) {
        return res.status(409).json({ error: 'Username already taken' });
      }
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/signin', async (req, res) => {
  const { email, password } = req.body;

  // Look the user up by EMAIL now, not username. Username still exists
  // in the users table (used for display everywhere — leaderboards,
  // the All Scores grid, etc.) but it's no longer how someone logs in.
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    // Same deliberately vague error as before — doesn't reveal whether
    // the email exists, standard practice to avoid leaking account info.
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const match = await bcrypt.compare(password, user.passwordhashed);
  if (!match) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  req.session.userId = user.id;
  res.json({ success: true });
});

app.post('/api/signout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// POST /api/forgot-password — generates a one-time token, emails a reset
// link. Always responds with the SAME generic message whether or not the
// email exists, so this endpoint can't be used to check who has an account.
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

  if (user) {
    // The raw token goes in the emailed link — the DATABASE only ever
    // stores a hash of it, same principle as passwordhashed. If the
    // database leaked, the stored hashes alone can't be used to reset
    // anyone's password.
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Token expires in 1 hour — stored as a plain millisecond timestamp,
    // simplest thing to compare against Date.now() later.
    const expiry = Date.now() + 60 * 60 * 1000;

    db.prepare(`
      UPDATE users SET resettoken = ?, resettokenexpiry = ? WHERE id = ?
    `).run(hashedToken, String(expiry), user.id);

    const resetLink = `https://www.awpredictions.uk/reset-password.html?token=${rawToken}`;

    try {
      await resend.emails.send({
        from: 'AWPredictApp <admin@awpredictions.uk>',
        to: email,
        subject: 'Reset your password',
        html: `
          <p>Someone requested a password reset for your AWPredictApp account.</p>
          <p><a href="${resetLink}">Click here to reset your password</a></p>
          <p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
        `
      });
    } catch (err) {
      // Log it, but still respond with the generic success message below —
      // we don't want a Resend outage to reveal whether the email exists.
      console.error('Failed to send reset email:', err);
    }
  }

  // Same response regardless of whether user was found above.
  res.json({ message: 'If that email is registered, a reset link has been sent.' });
});

// POST /api/reset-password — verifies the token (hash + expiry match),
// then sets a new password and clears the token so it can't be reused.
app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = db.prepare(`
    SELECT id, resettokenexpiry FROM users WHERE resettoken = ?
  `).get(hashedToken);

  if (!user) {
    return res.status(400).json({ error: 'Invalid or expired reset link' });
  }

  if (Date.now() > Number(user.resettokenexpiry)) {
    return res.status(400).json({ error: 'Invalid or expired reset link' });
  }

  const newHashed = await bcrypt.hash(newPassword, 10);

  // Clearing resettoken/resettokenexpiry means this exact link can never
  // be used a second time, even within its 1-hour window.
  db.prepare(`
    UPDATE users SET passwordhashed = ?, resettoken = NULL, resettokenexpiry = NULL
    WHERE id = ?
  `).run(newHashed, user.id);

  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// USER SETTINGS API — change username or password. Two separate routes
// since they're independent actions with different validation needs
// (uniqueness check vs. current-password verification).
// ---------------------------------------------------------------------------

app.post('/api/change-username', requireLoginApi, (req, res) => {
  const userId = req.session.userId;
  const { newUsername } = req.body;

  if (!newUsername) {
    return res.status(400).json({ error: 'Username required' });
  }

  try {
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(newUsername, userId);
    res.json({ success: true });
  } catch (err) {
    // Same UNIQUE-constraint pattern used in /api/signup — username
    // has a UNIQUE index, so a duplicate throws rather than silently
    // overwriting someone else's username.
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/change-password', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const userId = req.session.userId;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  // Must verify the CURRENT password before allowing a change —
  // otherwise anyone with a hijacked/logged-in session (e.g. someone
  // who walked up to an unlocked browser) could silently lock the
  // real owner out by setting a new password with no proof they know
  // the old one.
  const user = db.prepare('SELECT passwordhashed FROM users WHERE id = ?').get(userId);
  const match = await bcrypt.compare(currentPassword, user.passwordhashed);

  if (!match) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const newHashed = await bcrypt.hash(newPassword, 10);
  db.prepare('UPDATE users SET passwordhashed = ? WHERE id = ?').run(newHashed, userId);

  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// LEAGUES API — powers the header dropdown, and reports whether the
// logged-in user OWNS each league (used to hide "League Settings" for
// members who aren't owners).
// ---------------------------------------------------------------------------

app.get('/api/leagues', requireLoginApi, (req, res) => {
  const userId = req.session.userId;

  const userLeagues = db.prepare(`
    SELECT
      leagues.id,
      leagues.name,
      leagueuser.owner
    FROM leagues
    JOIN leagueuser ON leagues.id = leagueuser.leaguesid
    WHERE leagueuser.userid = ?
    ORDER BY leagues.id
  `).all(userId);

  if (userLeagues.length === 0) {
    return res.json({ leagues: userLeagues });
  }

  if (!req.session.currentleague) {
    req.session.currentleague = userLeagues[0].id;
  }

  res.json({ leagues: userLeagues, currentleague: req.session.currentleague });
});

// POST /api/join-league — looks up a league by its join code, adds the
// current user as a (non-owner) member if not already one, and makes
// it their currentleague for this session.
app.post('/api/join-league', requireLoginApi, (req, res) => {
  const userId = req.session.userId;
  const { joinCode } = req.body;

  if (!joinCode) {
    return res.status(400).json({ error: 'Join code required' });
  }

  const league = db.prepare('SELECT id FROM leagues WHERE joinID = ?').get(joinCode);

  if (!league) {
    return res.status(404).json({ error: 'Invalid join code' });
  }

  const alreadyMember = db.prepare(`
    SELECT id FROM leagueuser WHERE userid = ? AND leaguesid = ?
  `).get(userId, league.id);

  if (!alreadyMember) {
    db.prepare(`
      INSERT INTO leagueuser (leaguesid, userid, owner) VALUES (?, ?, 'no')
    `).run(league.id, userId);
  }

  req.session.currentleague = league.id;
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// COMPETITIONS / SEASONS API — powers the dropdowns on the create-league
// form. Only returns competitions/seasons that actually have games
// loaded against them, so the user can't pick something with no fixtures.
// ---------------------------------------------------------------------------

app.get('/api/competitions', requireLoginApi, (req, res) => {
  const competitions = db.prepare(`
    SELECT DISTINCT competitions.id, competitions.name, competitions.code, competitions.emblem
    FROM competitions
    JOIN games ON games.competitionid = competitions.id
    ORDER BY competitions.name
  `).all();

  res.json({ competitions });
});

app.get('/api/competitions/:competitionId/seasons', requireLoginApi, (req, res) => {
  const seasons = db.prepare(`
    SELECT DISTINCT seasons.id, seasons.startdate, seasons.enddate, seasons.winner
    FROM seasons
    JOIN games ON games.seasonid = seasons.id
    WHERE games.competitionid = ?
    ORDER BY seasons.startdate DESC
  `).all(req.params.competitionId);

  res.json({ seasons });
});

// POST /api/create-league — mirrors /api/join-league's shape: creates the
// league row, adds the creator as owner in leagueuser, and sets it as
// currentleague for this session so the next page load lands them in it.
app.post('/api/create-league', requireLoginApi, (req, res) => {
    if (!ALLOW_LEAGUE_CREATION) {
    return res.status(403).json({ error: 'League creation is currently disabled' });
  }
  const userId = req.session.userId;
  const { name, competitionId, seasonId } = req.body;

  if (!name || !competitionId || !seasonId) {
    return res.status(400).json({ error: 'Name, competition and season are required' });
  }

  // Confirm this competition/season pairing actually has games, same
  // check the dropdown endpoints rely on — protects against a tampered
  // request sending a mismatched pair.
  const validPair = db.prepare(`
    SELECT 1 FROM games WHERE competitionid = ? AND seasonid = ? LIMIT 1
  `).get(competitionId, seasonId);

  if (!validPair) {
    return res.status(400).json({ error: 'That season does not belong to that competition' });
  }

  const joinID = generateUniqueJoinCode();

  const insertLeague = db.prepare(`
    INSERT INTO leagues (
      name, joinID, seasonid, competitionid,
      wildcardonoff, winscore, perfectscore, losescore,
      wildcardwinscore, wildcardlosescore, updatedatetime
    ) VALUES (?, ?, ?, ?, 0, 1, 3, 0, 1, 0, CURRENT_TIMESTAMP)
  `);

  const insertOwner = db.prepare(`
    INSERT INTO leagueuser (leaguesid, userid, owner) VALUES (?, ?, 'yes')
  `);

  const createLeague = db.transaction(() => {
    const result = insertLeague.run(name, joinID, seasonId, competitionId);
    insertOwner.run(result.lastInsertRowid, userId);
    return result.lastInsertRowid;
  });

  try {
    const leagueId = createLeague();
    req.session.currentleague = leagueId;
    res.json({ success: true, leagueId, joinID });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// HIDING FLAG API— powers the "Your Scores" page
// ---------------------------------------------------------------------------

// GET /api/app-config — lets the frontend know which features are
// currently switched on, without needing a page reload to change.
app.get('/api/app-config', (req, res) => {
  res.json({ allowLeagueCreation: ALLOW_LEAGUE_CREATION });
});

// ---------------------------------------------------------------------------
// SCORES API — powers the "Your Scores" page
// ---------------------------------------------------------------------------

app.get('/api/scores', requireLoginApi, (req, res) => {
  const userId = req.session.userId;
  const currentleague = req.session.currentleague;

  if (!currentleague) {
    return res.status(400).json({ error: 'No league selected' });
  }

  const league = db.prepare('SELECT wildcardonoff FROM leagues WHERE id = ?').get(currentleague);

  const range = db.prepare('SELECT MIN(matchday) AS min, MAX(matchday) AS max FROM games').get();

  if (range.min === null) {
    return res.json({ gameweek: null, minGameweek: null, maxGameweek: null, wildcardEnabled: false, games: [] });
  }

  let gameweek;

  if (req.query.gameweek) {
    gameweek = Number(req.query.gameweek);
  } else {
    const nextUnplayed = db.prepare(`
      SELECT MIN(matchday) AS gw FROM games WHERE status != 'FINISHED'
    `).get();
    gameweek = nextUnplayed.gw ?? range.min;
  }

  const games = db.prepare(`
    SELECT
      games.id,
      games.utcdate AS date,
      games.status,
      hometeam.name AS hometeamname,
      hometeam.crest AS hometeamcrest,
      awayteam.name AS awayteamname,
      awayteam.crest AS awayteamcrest
    FROM games
    JOIN teams AS hometeam ON games.hometeamid = hometeam.id
    JOIN teams AS awayteam ON games.awayteamid = awayteam.id
    WHERE games.matchday = ?
    ORDER BY games.utcdate
  `).all(gameweek);

  const existingScore = db.prepare(`
    SELECT hometeamscore, awayteamscore, wildcardused FROM playersscore
    WHERE userid = ? AND gameid = ? AND leagueid = ?
  `);

  const gamesWithPredictions = games.map((game) => {
    const existing = existingScore.get(userId, game.id, currentleague);
    return {
      ...game,
      predictedHomeScore: existing ? existing.hometeamscore : null,
      predictedAwayScore: existing ? existing.awayteamscore : null,
      wildcardUsed: existing ? existing.wildcardused === 'yes' : false
    };
  });

  res.json({
    gameweek,
    minGameweek: range.min,
    maxGameweek: range.max,
    wildcardEnabled: !!league.wildcardonoff,
    games: gamesWithPredictions
  });
});

app.post('/api/scores', requireLoginApi, (req, res) => {
  const userId = req.session.userId;
  const currentleague = req.session.currentleague;
  const { predictions } = req.body;

  if (!currentleague) {
    return res.status(400).json({ error: 'No league selected' });
  }

  if (!Array.isArray(predictions) || predictions.length === 0) {
    return res.status(400).json({ error: 'No predictions provided' });
  }

  const getGame = db.prepare('SELECT status, matchday FROM games WHERE id = ?');
  const findExisting = db.prepare(`
    SELECT id FROM playersscore WHERE userid = ? AND gameid = ? AND leagueid = ?
  `);
  const updateScore = db.prepare(`
    UPDATE playersscore
    SET hometeamscore = ?, awayteamscore = ?, wildcardused = ?, updatedatetime = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const insertScore = db.prepare(`
    INSERT INTO playersscore (userid, leagueid, gameid, hometeamscore, awayteamscore, wildcardused, updatedatetime)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  // Counts how many wildcards this user already has active THIS
  // gameweek, across games NOT included in the current submission.
  // Needed because the incoming batch might only cover some of the
  // gameweek's games — without this, a user could tick a wildcard on
  // Game A, save, then separately tick one on Game B, save, and end up
  // with two active wildcards in the same gameweek.
  const countOtherWildcardsInMatchday = db.prepare(`
    SELECT COUNT(*) AS count
    FROM playersscore
    JOIN games ON games.id = playersscore.gameid
    WHERE playersscore.userid = ?
      AND playersscore.leagueid = ?
      AND games.matchday = ?
      AND playersscore.wildcardused = 'yes'
      AND playersscore.gameid != ?
  `);

  const saveAll = db.transaction((predictionList) => {
    // First pass: validate the ONE-WILDCARD-PER-GAMEWEEK rule across the
    // whole batch before writing anything, so a bad submission doesn't
    // save some rows and reject others halfway through.
    const wildcardCountByMatchday = {};

    for (const p of predictionList) {
      if (!p.wildcardUsed) continue;

      const game = getGame.get(p.gameId);
      if (!game) {
        throw new Error(`Game ${p.gameId} does not exist`);
      }

      wildcardCountByMatchday[game.matchday] = (wildcardCountByMatchday[game.matchday] || 0) + 1;

      // Also check against wildcards already saved for OTHER games in
      // this same gameweek that aren't part of this submission.
      const otherCount = countOtherWildcardsInMatchday.get(userId, currentleague, game.matchday, p.gameId).count;
      if (otherCount > 0) {
        throw new Error(`Only one wildcard can be used per gameweek (Gameweek ${game.matchday})`);
      }
    }

    for (const matchday in wildcardCountByMatchday) {
      if (wildcardCountByMatchday[matchday] > 1) {
        throw new Error(`Only one wildcard can be used per gameweek (Gameweek ${matchday})`);
      }
    }

    // Second pass: actually save, now that the batch is known to be valid.
    for (const p of predictionList) {
      const game = getGame.get(p.gameId);

      if (!game) {
        throw new Error(`Game ${p.gameId} does not exist`);
      }
      if (game.status === 'FINISHED') {
        throw new Error(`Game ${p.gameId} is no longer editable`);
      }

      const wildcardValue = p.wildcardUsed ? 'yes' : 'no';
      const existing = findExisting.get(userId, p.gameId, currentleague);

      if (existing) {
        updateScore.run(p.hometeamscore, p.awayteamscore, wildcardValue, existing.id);
      } else {
        insertScore.run(userId, currentleague, p.gameId, p.hometeamscore, p.awayteamscore, wildcardValue);
      }
    }
  });

  try {
    saveAll(predictions);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// ALL SCORES API — powers the "All Scores" grid page. Returns EVERY game
// across every gameweek (no gameweek filtering anymore), every member of
// the current league, and a flat list of predictions including the
// points (leaguescore) each one earned.
// ---------------------------------------------------------------------------

app.get('/api/all-scores', requireLoginApi, (req, res) => {
  const currentleague = req.session.currentleague;

  if (!currentleague) {
    return res.status(400).json({ error: 'No league selected' });
  }

  // Every game, across every gameweek — ordered so the frontend can
  // group consecutive rows into "Gameweek 1", "Gameweek 2", etc.
  // sections just by watching for when gameweek (matchday) changes as
  // it loops.
  const games = db.prepare(`
    SELECT
        games.id,
        games.utcdate AS date,
        games.matchday AS gameweek,
        games.status,
        games.scorefulltimehome AS hometeamscore,
        games.scorefulltimeaway AS awayteamscore,
        hometeam.name AS hometeamname,
        hometeam.crest AS hometeamcrest,
        awayteam.name AS awayteamname,
        awayteam.crest AS awayteamcrest
    FROM games
    JOIN teams AS hometeam ON games.hometeamid = hometeam.id
    JOIN teams AS awayteam ON games.awayteamid = awayteam.id
    ORDER BY games.matchday, games.utcdate
  `).all();

  // Every member of the current league — becomes the column list.
  const users = db.prepare(`
    SELECT users.id, users.username
    FROM leagueuser
    JOIN users ON users.id = leagueuser.userid
    WHERE leagueuser.leaguesid = ?
    ORDER BY users.username
  `).all(currentleague);

  // Every prediction in this league, across every game — no gameid
  // filtering needed now, since we want the full picture regardless
  // of gameweek. Includes leaguescore, which is what shows the points
  // earned per prediction (NULL until recalculate-league-scores has run
  // for that game).
  const predictions = db.prepare(`
    SELECT userid, gameid, hometeamscore, awayteamscore, wildcardused, leaguescore
    FROM playersscore
    WHERE leagueid = ?
  `).all(currentleague);

  res.json({ games, users, predictions });
});

// ---------------------------------------------------------------------------
// DASHBOARD API — league leaderboard: total points, prediction accuracy,
// perfect/correct/wrong counts, ranked. No gameweek breakdown — this is
// a single aggregate across the whole season so far.
// ---------------------------------------------------------------------------

app.get('/api/dashboard', requireLoginApi, (req, res) => {
  const currentleague = req.session.currentleague;

  if (!currentleague) {
    return res.status(400).json({ error: 'No league selected' });
  }

  // LEFT JOINs (not JOIN) are deliberate here — a league member who
  // hasn't predicted anything yet should still appear in the table,
  // with zeros, rather than being silently dropped from the leaderboard.
  //
  // perfectcount / correctcount are derived by comparing the prediction
  // directly against the game's actual result — NOT by inspecting
  // leaguescore's value, since that number depends on each league's own
  // configurable point settings and can't be trusted to identify WHICH
  // tier a prediction fell into.
  const leaderboard = db.prepare(`
    SELECT
      users.id,
      users.username,

      COALESCE(SUM(playersscore.leaguescore), 0) AS totalpoints,

      COUNT(CASE
        WHEN playersscore.hometeamscore IS NOT NULL
         AND playersscore.awayteamscore IS NOT NULL
        THEN 1
      END) AS predictionsmade,

      COUNT(CASE
        WHEN games.scorefulltimehome IS NOT NULL
         AND games.scorefulltimeaway IS NOT NULL
         AND playersscore.hometeamscore IS NOT NULL
         AND playersscore.awayteamscore IS NOT NULL
        THEN 1
      END) AS gamesplayedpredicted,

      COUNT(CASE
        WHEN games.scorefulltimehome = playersscore.hometeamscore
         AND games.scorefulltimeaway = playersscore.awayteamscore
        THEN 1
      END) AS perfectcount,

      COUNT(CASE
        WHEN games.scorefulltimehome IS NOT NULL
         AND playersscore.hometeamscore IS NOT NULL
         AND NOT (
             games.scorefulltimehome = playersscore.hometeamscore
             AND games.scorefulltimeaway = playersscore.awayteamscore
         )
         AND (
             (playersscore.hometeamscore > playersscore.awayteamscore AND games.scorefulltimehome > games.scorefulltimeaway)
             OR (playersscore.hometeamscore < playersscore.awayteamscore AND games.scorefulltimehome < games.scorefulltimeaway)
             OR (playersscore.hometeamscore = playersscore.awayteamscore AND games.scorefulltimehome = games.scorefulltimeaway)
         )
        THEN 1
      END) AS correctcount

    FROM leagueuser
    JOIN users ON users.id = leagueuser.userid
    LEFT JOIN playersscore
      ON playersscore.userid = users.id
     AND playersscore.leagueid = leagueuser.leaguesid
    LEFT JOIN games ON games.id = playersscore.gameid
    WHERE leagueuser.leaguesid = ?
    GROUP BY users.id, users.username
    ORDER BY totalpoints DESC, users.username ASC
  `).all(currentleague);

  res.json({ leaderboard });
});

// ---------------------------------------------------------------------------
// LEAGUE SETTINGS API — powers the "League Settings" page.
// Only the league's OWNER (leagueuser.owner = 'yes') can view or edit.
// ---------------------------------------------------------------------------

app.get('/api/leaguesettings', requireLoginApi, (req, res) => {
  const userId = req.session.userId;
  const currentleague = req.session.currentleague;

  if (!currentleague) {
    return res.status(400).json({ error: 'No league selected' });
  }

  const league = db.prepare(`
    SELECT
      leagues.name,
      leagues.joinID AS joinid,
      leagues.wildcardonoff,
      leagues.winscore,
      leagues.perfectscore,
      leagues.losescore,
      leagues.wildcardwinscore,
      leagues.wildcardlosescore,
      leagues.hidetime,
      competitions.name AS competitionname,
      seasons.startdate AS seasonstartdate,
      seasons.enddate AS seasonenddate
    FROM leagues
    JOIN leagueuser ON leagues.id = leagueuser.leaguesid
    JOIN competitions ON competitions.id = leagues.competitionid
    JOIN seasons ON seasons.id = leagues.seasonid
    WHERE leagueuser.userid = ?
      AND leagueuser.leaguesid = ?
      AND leagueuser.owner = 'yes'
  `).get(userId, currentleague);

  if (!league) {
    return res.status(403).json({ error: 'Not authorized to view this league' });
  }

  res.json({ league });
});

app.post('/api/leaguesettings', requireLoginApi, (req, res) => {
  const userId = req.session.userId;
  const currentleague = req.session.currentleague;

  const {
    name,
    wildcardonoff,
    winscore,
    perfectscore,
    losescore,
    wildcardwinscore,
    wildcardlosescore,
    hidetime
  } = req.body;

  if (!currentleague) {
    return res.status(400).json({ error: 'No league selected' });
  }

  const owns = db.prepare(`
    SELECT 1 FROM leagueuser WHERE userid = ? AND leaguesid = ? AND owner = 'yes'
  `).get(userId, currentleague);

  if (!owns) {
    return res.status(403).json({ error: 'Not authorized to edit this league' });
  }

  const update = db.prepare(`
    UPDATE leagues
    SET name = ?,
        wildcardonoff = ?,
        winscore = ?,
        perfectscore = ?,
        losescore = ?,
        wildcardwinscore = ?,
        wildcardlosescore = ?,
        hidetime = ?,
        updatedatetime = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  try {
    update.run(
      name,
      wildcardonoff ? 1 : 0,
      winscore,
      perfectscore,
      losescore,
      wildcardwinscore,
      wildcardlosescore,
      hidetime,
      currentleague
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// GAME RESULTS API — recalculates every player's leaguescore whenever
// the league's own settings have changed more recently than the scores
// were last touched.
// ---------------------------------------------------------------------------

app.post('/api/recalculate-league-scores', requireLoginApi, (req, res) => {
  const currentleague = req.session.currentleague;

  if (!currentleague) {
    return res.status(400).json({ error: 'No league selected' });
  }

  const leagueLastUpdate = db.prepare(`
    SELECT MAX(updatedatetime) AS lastupdatedatetime FROM leagues WHERE id = ?
  `).get(currentleague);

  const scoresLastUpdate = db.prepare(`
    SELECT MAX(updatedatetime) AS lastupdatedatetime FROM playersscore WHERE leagueid = ?
  `).get(currentleague);

  const leagueUpdatedAt = leagueLastUpdate.lastupdatedatetime
    ? new Date(leagueLastUpdate.lastupdatedatetime.replace(' ', 'T'))
    : null;
  const scoresUpdatedAt = scoresLastUpdate.lastupdatedatetime
    ? new Date(scoresLastUpdate.lastupdatedatetime.replace(' ', 'T'))
    : null;

  const needsRecalculation = !scoresUpdatedAt || (leagueUpdatedAt && leagueUpdatedAt > scoresUpdatedAt);

  if (!needsRecalculation) {
    return res.json({ recalculated: false });
  }

  const recalculate = db.prepare(`
    UPDATE playersscore
    SET leaguescore = (
        SELECT
            CASE
                WHEN playersscore.hometeamscore IS NULL OR playersscore.awayteamscore IS NULL THEN 0
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
                        WHEN playersscore.hometeamscore = games.scorefulltimehome AND playersscore.awayteamscore = games.scorefulltimeaway
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
        WHERE games.id = playersscore.gameid AND leagues.id = playersscore.leagueid
    )
    WHERE leagueid = ?
  `);

  try {
    const result = recalculate.run(currentleague);
    res.json({ recalculated: true, rowsUpdated: result.changes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// PROTECTED PAGES
// ---------------------------------------------------------------------------

// join-league.html gets ONLY requireLogin — deliberately skips
// requireLeague, since this is the one page someone with zero leagues
// must still be able to reach. Registered BEFORE the generic /app/:page
// route below, so Express matches this exact path first.
app.get('/app/join-league.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'protected', 'join-league.html'), (err) => {
    if (err) res.status(404).send('Page not found');
  });
});

// Every other protected page requires BOTH a valid login AND at least
// one league — requireLeague redirects to join-league.html if neither
// the session nor the database has a league for this user yet.
app.get('/app/:page', requireLogin, requireLeague, (req, res) => {
  const requested = path.basename(req.params.page);
  const filePath = path.join(__dirname, 'protected', requested);
  res.sendFile(filePath, (err) => {
    if (err) res.status(404).send('Page not found');
  });
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`awpredictapp running on port ${PORT}`);
});

// ---------------------------------------------------------------------------
// IMPORTING UPDATED SCORES
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`awpredictapp running on port ${PORT}`);

  // Run the API sync when the server boots up, THEN recalculate league
  // scores — always in that order, since scoring against a stale/missing
  // games table would produce wrong points.
  fetchAndSync()
    .then(() => {
      console.log('Initial Football API sync finished.');
      calculateScores();
    })
    .catch((err) => console.error('Initial sync/calculate failed:', err));
});

// ---------------------------------------------------------------------------
// SCHEDULED SYNC — runs at midnight and midday every day, keeping fixtures
// and league scores up to date without needing a server restart.
// Cron format: minute hour day month weekday — "0 0,12 * * *" fires at
// 00:00 and 12:00, every day, every month, any weekday.
// ---------------------------------------------------------------------------
cron.schedule('0 0,12 * * *', () => {
  console.log('Scheduled sync starting...');

  fetchAndSync()
    .then(() => {
      console.log('Scheduled Football API sync finished.');
      calculateScores();
    })
    .catch((err) => console.error('Scheduled sync/calculate failed:', err));
}, {
  timezone: 'Europe/London'
});