const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: process.env.POSTGRES_URL && process.env.POSTGRES_URL.includes('vercel') ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
    console.error('PostgreSQL hatası:', err.message);
});

// SQLite uyumlu wrapper fonksiyonları
pool.get = function(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    if (!params) params = [];
    let i = 1; 
    const pgSql = sql.replace(/\?/g, () => `$${i++}`);
    this.query(pgSql, params)
        .then(res => { if (callback) callback(null, res.rows[0]); })
        .catch(err => { if (callback) callback(err, null); });
    return this;
};

pool.all = function(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    if (!params) params = [];
    let i = 1; 
    const pgSql = sql.replace(/\?/g, () => `$${i++}`);
    this.query(pgSql, params)
        .then(res => { if (callback) callback(null, res.rows); })
        .catch(err => { if (callback) callback(err, null); });
    return this;
};

pool.run = function(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    if (!params) params = [];
    
    // SQLite transaction komutlarını yok say
    if (sql.toUpperCase() === "BEGIN TRANSACTION" || sql.toUpperCase() === "COMMIT") {
        if (callback) callback.call({ lastID: 0, changes: 0 }, null);
        return this;
    }
    
    let i = 1; 
    const pgSql = sql.replace(/\?/g, () => `$${i++}`);
    this.query(pgSql, params)
        .then(res => { if (callback) callback.call({ lastID: 0, changes: res.rowCount }, null); })
        .catch(err => { if (callback) callback(err); });
    return this;
};

pool.serialize = function(cb) {
    cb();
    return this;
};

pool.prepare = function(sql) {
    let pgSql = sql;
    // SQLite'a özel INSERT OR REPLACE komutunu PostgreSQL UPSERT yapısına çevir
    if (sql.includes("INSERT OR REPLACE INTO")) {
        pgSql = sql.replace("INSERT OR REPLACE INTO", "INSERT INTO");
        if (pgSql.includes("settings (key, value)")) {
            pgSql += " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value";
        }
    }
    const self = this;
    return {
        run: function(...args) {
            let callback;
            if (args.length > 0 && typeof args[args.length - 1] === 'function') {
                callback = args.pop();
            }
            let i = 1;
            const finalSql = pgSql.replace(/\?/g, () => `$${i++}`);
            self.query(finalSql, args)
                .then(res => { if (callback) callback.call({ changes: res.rowCount }, null); })
                .catch(err => { if (callback) callback(err); });
        },
        finalize: function() {}
    };
};

const initDB = async () => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS categories (id SERIAL PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY, category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT, image_url TEXT, material TEXT, standard TEXT, tech_table_json TEXT)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS page_views (date TEXT PRIMARY KEY, views INTEGER DEFAULT 0)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, fullname TEXT, email TEXT, phone TEXT, subject TEXT, message TEXT, is_read INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS chatbot_qa (id SERIAL PRIMARY KEY, question TEXT, keywords TEXT, answer TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS quotes (id SERIAL PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, phone TEXT, products TEXT, is_read INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS gallery (id SERIAL PRIMARY KEY, title TEXT, image_url TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS references_table (id SERIAL PRIMARY KEY, title TEXT, image_url TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS certificates (id SERIAL PRIMARY KEY, title TEXT, image_url TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS blogs (id SERIAL PRIMARY KEY, title TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, content TEXT NOT NULL, image_url TEXT, views INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);

        const userCountRes = await pool.query("SELECT COUNT(*) FROM users");
        if (parseInt(userCountRes.rows[0].count) === 0) {
            const hash = await bcrypt.hash('admin123', 10);
            await pool.query(`INSERT INTO users (username, password) VALUES ($1, $2)`, ['admin', hash]);
            console.log("Varsayılan admin kullanıcısı oluşturuldu.");
        }

        const settingsCountRes = await pool.query("SELECT COUNT(*) FROM settings");
        if (parseInt(settingsCountRes.rows[0].count) === 0) {
            const initialSettings = [
                ['theme', 'light'], ['phone', '+90 500 123 45 67'], ['email', 'info@akfuzyon.com'],
                ['whatsapp', '905001234567'], ['address', 'Malatya, Türkiye'], ['working_hours', 'Pzt - Cmt: 08:00 - 18:00']
            ];
            for (const setting of initialSettings) {
                await pool.query("INSERT INTO settings (key, value) VALUES ($1, $2)", [setting[0], setting[1]]);
            }
        }
    } catch (err) { console.error("DB Init error:", err); }
};

if (process.env.POSTGRES_URL) initDB();

pool.getSettings = async () => {
    try {
        const { rows } = await pool.query("SELECT key, value FROM settings");
        const settings = {};
        if (rows) rows.forEach(row => { settings[row.key] = row.value; });
        return settings;
    } catch (err) { return {}; }
};

module.exports = pool;
