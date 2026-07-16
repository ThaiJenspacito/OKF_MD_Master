const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');

// Verzeichnisse definieren
const AGENTS_DIR = path.join(__dirname, '../.agents');
const INCOMING_DIR = path.join(AGENTS_DIR, 'skills/incoming');
const LOG_FILE = path.join(AGENTS_DIR, 'scout_activity.log');

// 🛠️ Sicherstellen, dass die OKF-Ordnerstruktur existiert
const folders = [
    INCOMING_DIR,
    path.join(AGENTS_DIR, 'skills/active/local'),
    path.join(AGENTS_DIR, 'skills/active/git')
];
folders.forEach(folder => fs.mkdirSync(folder, { recursive: true }));

/**
 * Schreibt einen Eintrag in das gläserne Logbuch
 */
function logActivity(sourcePath, filename, status, description) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const logLine = `| ${timestamp} | ${sourcePath} | ${filename} | ${status} | ${description} |\n`;
    
    if (!fs.existsSync(LOG_FILE)) {
        // Tabellen-Header erstellen, falls das Log neu ist
        fs.writeFileSync(LOG_FILE, "| Zeitstempel | Ursprünglicher Pfad | Dateiname | Status | Beschreibung & Entscheidung |\n| :--- | :--- | :--- | :--- | :--- |\n");
    }
    fs.appendFileSync(LOG_FILE, logLine);
}

/**
 * Hauptfunktion des Scouts
 * @param {string} scanPath Der Ordner auf deinem PC, den du durchsuchen willst
 */
function scanForKnowledge(scanPath) {
    console.log(`🕵️‍♂️ Knowledge-Scout startet Scan in: ${scanPath}`);
    
    if (!fs.existsSync(scanPath)) {
        console.error(`❌ Pfad existiert nicht: ${scanPath}`);
        return;
    }

    // Suche alle .md-Dateien im Zielordner (inklusive Unterordner)
    const files = globSync(`${scanPath}/**/*.md`, { ignore: ['**/node_modules/**', '**/.git/**'] });

    let foundNewFiles = 0;

    files.forEach(file => {
        const filename = path.basename(file);
        const fileContent = fs.readFileSync(file, 'utf8');

        // EINFACHER FILTER-CHECK: Ist die Datei nützlich?
        // Wenn eine Datei weniger als 20 Zeichen hat oder nur Standard-Müll enthält, überspringen wir sie
        if (fileContent.trim().length < 20) {
            logActivity(path.dirname(file), filename, "🟡 IGNORIERT", "Datei ist zu kurz oder leer.");
            return;
        }

        const destPath = path.join(INCOMING_DIR, filename);

        // Kopiere die Datei als Read-Only-Kopie in den Incoming-Ordner für den OKF-Architect
        if (!fs.existsSync(destPath)) {
            fs.copyFileSync(file, destPath);
            logActivity(path.dirname(file), filename, "🟢 AKTIVIERT", "In Workspace-Sandbox kopiert. Bereit für OKF-Architect.");
            foundNewFiles++;
        }
    });

    console.log(`✅ Scan abgeschlossen. ${foundNewFiles} neue Wissens-Dateien im Workspace bereitgestellt.`);
}

// Ermöglicht den direkten Start via Terminal (z.B. node src/scout.js "C:/Users/Jensp/Documents")
const targetPath = process.argv[2] || path.join(__dirname, '../mock_documents');
scanForKnowledge(targetPath);