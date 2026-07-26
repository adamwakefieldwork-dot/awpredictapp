const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const db = require('./db/init');

const app = express();
const PORT = 3000;

require('dotenv').config();

// Lets Express read JSON bodies sent by fetch() from our HTML pages.
// Without this, req.body would be undefined in the routes below.
app.use(express.json());

// Sessions let the server "remember" a logged-in user across separate
// HTTP requests (each request is otherwise completely independent —
// the server has no memory of who you are between page loads unless
// something like this ties them together via a cookie).
app.use(session({
  secret: process.env.SESSION_SECRET, // used to sign the session cookie
  resave: false,
  saveUninitialized: false
}));

// ─────────────────────────────────────────────
// GATEKEEPER for PAGES — redirects to /signin if not logged in.
// Used for full page loads (browser navigation).
// ─────────────────────────────────────────────
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/signin');
  }
  next();
}
 
// ─────────────────────────────────────────────
// GATEKEEPER for API ROUTES — sends a JSON error instead of redirecting.
// A redirect doesn't make sense for a fetch() call the way it does for
// a full page navigation, so API routes get their own version.
// ─────────────────────────────────────────────
function requireLoginApi(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  next();
}

// Redirect root ("/") to /signin
app.get('/', (req, res) => {
  res.redirect('/signin');
});

// TEMPORARY: hardcoded until the league-picker dropdown is built.
const DEFAULT_LEAGUE_ID = 1;

// ---------------------------------------------------------------------------
// AUTH ROUTES
// These run ONLY on the server (this file), never in the browser.
// The matching fetch() calls live in signin.html / signup.html.
// Browser and server never share memory or call each other's functions
// directly — this HTTP request/response is the only connection between them.
// ---------------------------------------------------------------------------

app.post('/api/signup', async (req, res) => {
  // req.body is the JS object Express built by parsing the JSON text
  // that signup.html's fetch() call sent over.
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    // Never store plain-text passwords. bcrypt.hash() turns the password
    // into a one-way hash — even if the database file leaked, the original
    // passwords can't be recovered from it.
    const hashed = await bcrypt.hash(password, 10);

    const insert = db.prepare(
      'INSERT INTO users (username, name, email, password_hashed , userrole) VALUES (?, ?, ?, ? , 1)' // Hard set the role to be standard
    );
    // Using `username` for both the username and name columns for now,
    // since the signup form only collects one name-like field.
    const result = insert.run(username, username, email, hashed);

    // Mark this new user as logged in immediately, so signup.html can
    // redirect straight to the dashboard without a separate signin step.
    //req.session.userId = result.lastInsertRowid;

    // Send a plain success response — this is ALL the browser gets back.
    // The browser's own script decides what to do with it (see signup.html).
    res.json({ success: true });

  } catch (err) {
    // SQLite throws when a UNIQUE constraint (username or email) is violated.
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
  const { username, password } = req.body;

  // Look the user up by username. This only works because the database
  // file lives on the server's disk — the browser never sees it directly.
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    // Deliberately vague error (doesn't reveal whether the username
    // exists) — standard practice to avoid leaking account info.
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  // bcrypt.compare() re-hashes the submitted password with the same
  // parameters and checks it against the stored hash. This has to happen
  // server-side — the browser must never be trusted to decide "yes, this
  // password is correct" on its own.
  const match = await bcrypt.compare(password, user.password_hashed);
  if (!match) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  // Record that this browser session belongs to this user. Express-session
  // stores this server-side and gives the browser a cookie referencing it,
  // so future requests (e.g. loading dashboard.html) can identify the user
  // without re-sending their password.
  req.session.userId = user.id;
  res.json({ success: true });
});

app.post('/api/signout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ---------------------------------------------------------------------------
// LEAGUE HEADER API — powers the "League Settings" page
// ---------------------------------------------------------------------------

app.get('/api/leagues', requireLoginApi, (req, res) => {
  const userId = req.session.userId;

  //Prepare the sql to get
  const userLeagues = db.prepare(`
    SELECT 
    leagues.id, 
    leagues.name 
    FROM leagues 
    JOIN leagueuser on leagues.id = leagueuser.leaguesid
    join users on users.id = leagueuser.userid
    where users.id = ?
    order by leagues.id
    `).all(userId)
    
  if (userLeagues.length  === 0)
  { //If they are in no leagues
    return res.json({ leagues: userLeagues });
  }

  if (!req.session.currentleague) {
      //checks current sessions and if it already exists
      //stops overriding
      req.session.currentleague = userLeagues[0].id;
  }

  res.json({ leagues: userLeagues });

});

// ---------------------------------------------------------------------------
// SCORES API — powers the "Your Scores" page
// ---------------------------------------------------------------------------
 
// GET /api/scores            → server picks a default gameweek
// GET /api/scores?gameweek=3 → a specific gameweek
app.get('/api/scores', requireLoginApi, (req, res) => {
  const userId = req.session.userId;
 
  // Work out the full range of gameweeks that exist in the games table,
  // so the frontend knows when to grey out the prev/next arrows.
  const range = db.prepare('SELECT MIN(gameweek) AS min, MAX(gameweek) AS max FROM games').get();
 
  if (range.min === null) {
    // No games in the database at all yet.
    return res.json({ gameweek: null, minGameweek: null, maxGameweek: null, games: [] });
  }
 
  let gameweek;
 
  if (req.query.gameweek) {
    // A specific gameweek was requested (user clicked an arrow).
    gameweek = Number(req.query.gameweek);
  } else {
    // No gameweek specified (first page load) — default to the earliest
    // gameweek that still has a game with status "Not Played". Falls
    // back to the very first gameweek if everything's already played.
    const nextUnplayed = db.prepare(`
      SELECT MIN(gameweek) AS gw FROM games WHERE status = 'Not Played'
    `).get();
    gameweek = nextUnplayed.gw ?? range.min;
  }
 
  // Fetch every game in this gameweek, joining in the actual team names
  // (games only stores hometeamid/awayteamid, not names) — same JOIN
  // pattern used elsewhere in this app.
  const games = db.prepare(`
    SELECT
      games.id,
      games.date,
      games.status,
      hometeam.name AS hometeamname,
      awayteam.name AS awayteamname
    FROM games
    JOIN teams AS hometeam ON games.hometeamid = hometeam.id
    JOIN teams AS awayteam ON games.awayteamid = awayteam.id
    WHERE games.gameweek = ?
    ORDER BY games.date
  `).all(gameweek);
 
  // For each game, check if THIS user already saved a prediction for it,
  // so the frontend can pre-fill the input boxes instead of showing blanks.
  const existingScore = db.prepare(`
    SELECT hometeamscore, awayteamscore FROM playersscore
    WHERE userid = ? AND gameid = ? AND leagueid = ?
  `);
 
  const gamesWithPredictions = games.map((game) => {
    const existing = existingScore.get(userId, game.id, DEFAULT_LEAGUE_ID);
    return {
      ...game,
      predictedHomeScore: existing ? existing.hometeamscore : null,
      predictedAwayScore: existing ? existing.awayteamscore : null
    };
  });
 
  res.json({
    gameweek,
    minGameweek: range.min,
    maxGameweek: range.max,
    games: gamesWithPredictions
  });
});

// POST /api/scores — save (insert or update) a batch of predictions
app.post('/api/scores', requireLoginApi, (req, res) => {
  const userId = req.session.userId;
  const currentleague = req.session.currentleague
  const { predictions } = req.body;
 
  if (!Array.isArray(predictions) || predictions.length === 0) {
    return res.status(400).json({ error: 'No predictions provided' });
  }
 
  // Prepared statements, reused for every row in the loop below —
  // compiled once here, rather than re-compiling the SQL on every iteration.
  const getGame = db.prepare('SELECT status FROM games WHERE id = ?');
  const findExisting = db.prepare(`
    SELECT id FROM playersscore WHERE userid = ? AND gameid = ? AND leagueid = ?
  `);
  const updateScore = db.prepare(`
    UPDATE playersscore SET hometeamscore = ?, awayteamscore = ? WHERE id = ?
  `);
  const insertScore = db.prepare(`
    INSERT INTO playersscore (userid, leagueid, gameid, hometeamscore, awayteamscore)
    VALUES (?, ?, ?, ?, ?)
  `);
 
  // Wrapping everything in one transaction: either all predictions in
  // this batch save successfully, or none do — avoids leaving the
  // database half-updated if something fails partway through.
  const saveAll = db.transaction((predictionList) => {
    for (const p of predictionList) {
      // SERVER-SIDE enforcement of "only editable while Not Played".
      // The frontend already disables the input, but that's just UI —
      // this check is what actually stops a bypassed request from
      // overwriting a prediction for a game that's already kicked off.
      const game = getGame.get(p.gameId);
 
      if (!game) {
        throw new Error(`Game ${p.gameId} does not exist`);
      }
      if (game.status !== 'Not Played') {
        throw new Error(`Game ${p.gameId} is no longer editable`);
      }
 
      const existing = findExisting.get(userId, p.gameId, currentleague);
 
      if (existing) {
        updateScore.run(p.hometeamscore, p.awayteamscore, existing.id);
      } else {
        insertScore.run(userId, currentleague, p.gameId, p.hometeamscore, p.awayteamscore);
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
// LEAGUE SETTINGS API — powers the "League Settings" page
// ---------------------------------------------------------------------------

app.get('/api/leaguesettings', requireLoginApi, (req, res) => {
  const userId = req.session.userId;

  //Prep the sessions
  const games = db.prepare(`
    select 
      name ,
      joinid,
      wildcardonoff,
      winscore ,
      perfectscore ,
      losescore ,
      wildcardwinscore ,
      wildcardlosescore ,
      hidetime
    from leagues
    join leagueowner on leagues.id = leagueowner.leaguesid
    join users on users.id = leagueowner.userid
    where users.id = ?
    and leaguesid = ?
  `).all(gameweek);

});

// :page captures whatever comes after /app/ in the URL — e.g.
// /app/dashboard.html sets req.params.page to "dashboard.html"
// --- PROTECTED PAGES — gatekeeper plugged in here ---
app.get('/app/:page', requireLogin, (req, res) => {
  const requested = path.basename(req.params.page);
  const filePath = path.join(__dirname, 'protected', requested);
  res.sendFile(filePath, (err) => {
    if (err) res.status(404).send('Page not found');
  });
});

// Serve static files from "public" folder.
// { extensions: ['html'] } lets /signin match signin.html automatically.
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`awpredictapp running on port ${PORT}`);
});