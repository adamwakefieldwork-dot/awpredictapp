const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data', 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');


db.exec(`
  CREATE TABLE IF NOT EXISTS userrole (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE
  )
`);

db.exec(`
  INSERT OR IGNORE INTO userrole (name)
  VALUES ('STANDARD');
`);

db.exec(`
  INSERT OR IGNORE INTO userrole (name)
  VALUES ('ADMIN');
`);

db.exec(`
  INSERT OR IGNORE INTO userrole (name)
  VALUES ('SITE ADMIN');
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    passwordhashed TEXT,
    userroleid INTEGER,
    resettoken TEXT,
    resettokenexpiry TEXT,
    FOREIGN KEY (userroleid) REFERENCES userrole(id)
  )
`);

db.exec(`
CREATE TABLE IF NOT EXISTS areas (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT,
    flag TEXT
  )
`);


db.exec(`
CREATE TABLE IF NOT EXISTS competitions (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT,
    type TEXT,
    emblem TEXT
  )
`);


db.exec(`
CREATE TABLE IF NOT EXISTS seasons (
    id INTEGER PRIMARY KEY,
    startdate TEXT,
    enddate TEXT,
    currentmatchday INTEGER,
    winner TEXT
  )
`);


db.exec(`
CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    shortname TEXT,
    tla TEXT,
    crest TEXT
  )
`);


db.exec(`
CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY,
    areaid INTEGER,
    competitionid INTEGER,
    seasonid INTEGER,
    utcdate TEXT,
    status TEXT,
    matchday INTEGER,
    stage TEXT,
    matchgroup TEXT,
    lastupdated TEXT,
    
    -- Team Foreign Keys
    hometeamid INTEGER NOT NULL,
    awayteamid INTEGER NOT NULL,
    
    -- Score Data
    scorewinner TEXT,
    scoreduration TEXT,
    scorefulltimehome INTEGER,
    scorefulltimeaway INTEGER,
    scorehalftimehome INTEGER,
    scorehalftimeaway INTEGER,
    
    -- Foreign Key Constraints
    FOREIGN KEY (areaid) REFERENCES areas(id),
    FOREIGN KEY (competitionid) REFERENCES competitions(id),
    FOREIGN KEY (seasonid) REFERENCES seasons(id),
    FOREIGN KEY (hometeamid) REFERENCES teams(id),
    FOREIGN KEY (awayteamid) REFERENCES teams(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS leagues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    joinID TEXT UNIQUE,
    seasonid INTEGER,
    competitionid INTEGER,
    wildcardonoff INTEGER,
    winscore INTEGER,
    perfectscore INTEGER,
    losescore INTEGER,
    wildcardwinscore INTEGER,
    wildcardlosescore INTEGER,
    hidetime TEXT,
    updatedatetime TEXT,
    FOREIGN KEY (competitionid) REFERENCES competitions(id),
    FOREIGN KEY (seasonid) REFERENCES seasons(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS leagueuser (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    leaguesid INTEGER,
    userid INTEGER,
    owner INTEGER DEFAULT 0,
    FOREIGN KEY (userid) REFERENCES users(id),
    FOREIGN KEY (leaguesid) REFERENCES leagues(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS playersscore (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userid INTEGER ,
    leagueid INTEGER ,
    gameid INTEGER ,
    hometeamscore INTEGER,
    awayteamscore INTEGER,
    wildcardused TEXT,
    leaguescore INTEGER ,
    updatedatetime TEXT,
    FOREIGN KEY (userid) REFERENCES users(id),
    FOREIGN KEY (gameid) REFERENCES games(id),
    FOREIGN KEY (leagueid) REFERENCES leagues(id)
  )
`);


console.log('database opened successfully');

module.exports = db;

