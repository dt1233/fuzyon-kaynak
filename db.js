const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Veritabanına bağlanılamadı:', err.message);
    } else {
        console.log('SQLite veritabanına bağlanıldı.');
    }
});

db.serialize(() => {
    // Settings table
    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);

    // Categories table
    db.run(`CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL
    )`);

    // Products table
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        description TEXT,
        image_url TEXT,
        material TEXT,
        standard TEXT,
        tech_table_json TEXT,
        FOREIGN KEY (category_id) REFERENCES categories (id)
    )`);

    // Page views table
    db.run(`CREATE TABLE IF NOT EXISTS page_views (
        date TEXT PRIMARY KEY,
        views INTEGER DEFAULT 0
    )`);

    // Messages table
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fullname TEXT,
        email TEXT,
        phone TEXT,
        subject TEXT,
        message TEXT,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Chatbot QA table
    db.run(`CREATE TABLE IF NOT EXISTS chatbot_qa (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question TEXT,
        keywords TEXT,
        answer TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Quotes table
    db.run(`CREATE TABLE IF NOT EXISTS quotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT,
        last_name TEXT,
        email TEXT,
        phone TEXT,
        products TEXT,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )`);

    // Gallery table
    db.run(`CREATE TABLE IF NOT EXISTS gallery (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        image_url TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Blogs table
    db.run(`CREATE TABLE IF NOT EXISTS blogs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL,
        image_url TEXT,
        views INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Seed admin user
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (row && row.count === 0) {
            const salt = bcrypt.genSaltSync(10);
            const hash = bcrypt.hashSync('admin123', salt);
            db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, ['admin', hash]);
            console.log("Varsayılan admin kullanıcısı oluşturuldu. (admin / admin123)");
        }
    });

    // Seed default settings
    db.get("SELECT COUNT(*) as count FROM settings", (err, row) => {
        if (row && row.count === 0) {
            const initialSettings = [
                ['theme', 'light'],
                ['phone', '+90 500 123 45 67'],
                ['email', 'info@akfuzyon.com'],
                ['whatsapp', '905001234567'],
                ['address', 'Malatya, Türkiye'],
                ['working_hours', 'Pzt - Cmt: 08:00 - 18:00']
            ];
            const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
            initialSettings.forEach(setting => stmt.run(setting));
            stmt.finalize();
            console.log("Varsayılan ayarlar veritabanına eklendi.");
        }
    });
});

// Helper function to get all settings as an object
db.getSettings = () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT key, value FROM settings", (err, rows) => {
            if (err) reject(err);
            const settings = {};
            if (rows) {
                rows.forEach(row => {
                    settings[row.key] = row.value;
                });
            }
            resolve(settings);
        });
    });
};

module.exports = db;
