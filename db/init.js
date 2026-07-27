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
    password_hashed TEXT,
    userroleid INTEGER,
    FOREIGN KEY (userroleid) REFERENCES userrole(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS leagues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL ,
    joinID TEXT UNIQUE ,
    wildcardonoff INTEGER ,
    winscore INTEGER ,
    perfectscore INTEGER ,
    losescore INTEGER ,
    wildcardwinscore INTEGER ,
    wildcardlosescore INTEGER ,
    hidetime TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS leagueuser (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    leaguesid INTEGER ,
    userid INTEGER ,
    owner TEXT ,
    FOREIGN KEY (userid) REFERENCES users(id),
    FOREIGN KEY (leaguesid) REFERENCES leagues(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon BLOB 
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon BLOB 
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    gameweek INTEGER,
    roundid INTEGER,
    hometeamid INTEGER ,
    awayteamid INTEGER ,
    hometeamscore INTEGER ,
    awayteamscore INTEGER ,
    status text ,
    FOREIGN KEY (roundid) REFERENCES rounds(id),
    FOREIGN KEY (hometeamid) REFERENCES teams(id),
    FOREIGN KEY (awayteamid) REFERENCES teams(id)
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
    leaguepoint INTEGER ,
    FOREIGN KEY (userid) REFERENCES users(id),
    FOREIGN KEY (gameid) REFERENCES games(id),
    FOREIGN KEY (leagueid) REFERENCES leagues(id)
  )
`);


console.log('database opened successfully');

module.exports = db;

