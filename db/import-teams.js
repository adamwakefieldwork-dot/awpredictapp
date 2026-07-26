const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const db = require('../db/init');

// Read and parse the CSV
const csvPath = path.join(__dirname,'data/raw' , 'teams.csv');
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
  INSERT INTO teams (name)
  VALUES (@teamname)
`);

const insertMany = db.transaction((rows) => {
  for (const row of rows) {
    insertGame.run({
      teamname: row.teamname,
    });
  }
});

insertMany(records);

console.log(`Imported ${records.length} games successfully.`);