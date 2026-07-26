const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const db = require('../db/init');

// Read and parse the CSV
const csvPath = path.join(__dirname,'data/raw' , 'games.csv');
const fileContent = fs.readFileSync(csvPath, 'utf8');

const records = parse(fileContent, {
  columns: true,       // use first row as column names
  skip_empty_lines: true,
  trim: true
});

// Helper: convert empty strings to null (SQLite-friendly)
function toNull(val) {
  return val === '' || val === undefined ? null : val;
}

const insertGame = db.prepare(`
  INSERT INTO games (date,gameweek,roundid,hometeamid,awayteamid,status)
  VALUES (@date, @matchday , 1 , @hometeamid , @awayteamid , @status)
`);

const insertMany = db.transaction((rows) => {
  for (const row of rows) {
    insertGame.run({
      date: row.date,
      matchday: Number(row.matchday),
      hometeamid: Number(row.hometeamid),
      awayteamid: Number(row.awayteamid),
      status: row.status,
    });
  }
});

insertMany(records);

console.log(`Imported ${records.length} games successfully.`);